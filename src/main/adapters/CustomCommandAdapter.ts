import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  AgentAdapterEvent,
  AgentAdapterEventListener,
  AdapterDetectionResult,
  RuntimeConfigurableAgentAdapter
} from "../../shared/types/adapter";
import type {
  AgentConnectionStatus,
  AgentProgressType,
  AgentProvider,
  AgentTask,
  AgentTaskStatus,
  AgentWaitingAction,
  QuotaSnapshot
} from "../../shared/types/agent";
import { priorityFromTaskStatus } from "../../shared/constants/priority";

export interface CustomCommandConfig {
  enabled: boolean;
  authorized: boolean;
  commandPath: string | null;
  args: string[];
  workingDirectory: string | null;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface CustomCommandRunRequest {
  commandPath: string;
  args: string[];
  workingDirectory: string | null;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface CustomCommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CustomCommandRunner {
  run(request: CustomCommandRunRequest): Promise<CustomCommandRunResult>;
}

export interface CustomCommandAdapterOptions {
  config?: Partial<CustomCommandConfig>;
  runner?: CustomCommandRunner;
  now?: () => Date;
  scanIntervalMs?: number;
}

interface CustomCommandSnapshot {
  tasks: AgentTask[];
  quota: QuotaSnapshot;
  connectionStatus: AgentConnectionStatus;
  message: string;
}

interface CustomCommandErrorDetail {
  code: string;
  message: string;
}

const execFileAsync = promisify(execFile);
const defaultScanIntervalMs = 15_000;
const defaultTimeoutMs = 5000;
const defaultOutputLimitBytes = 256 * 1024;
const minTimeoutMs = 1000;
const maxTimeoutMs = 60_000;
const minOutputLimitBytes = 1024;
const maxOutputLimitBytes = 1024 * 1024;

const taskStatuses = new Set<AgentTaskStatus>([
  "idle",
  "detecting",
  "analyzing",
  "planning",
  "executing",
  "testing",
  "waiting",
  "completed",
  "failed",
  "disconnected",
  "stale",
  "unknown"
]);

const progressTypes = new Set<AgentProgressType>(["determinate", "staged", "indeterminate", "unavailable"]);
const blockedElevationExecutables = new Set(["runas", "runas.exe", "sudo", "pkexec"]);
const redactedPath = "%REDACTED_PATH%";
const redactedSecret = "%REDACTED_SECRET%";
const windowsPathPattern = /[A-Za-z]:(?:\\\\|\\)[^"',}\]\r\n]*/g;
const commandSecretPattern =
  /((?:--?|\/)(?:api[-_]?key|token|secret|password|authorization)(?:=|\s+))("[^"]*"|'[^']*'|[^\s"',}]+)/gi;
const envSecretPattern =
  /(\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)[A-Z0-9_]*\s*=\s*)([^\s"',}]+)/gi;
const authorizationPattern = /(\bAuthorization\s*[:=]\s*(?:Bearer\s+)?)([^\s"',}]+)/gi;
const jsonSecretPattern =
  /("[^"]*(?:api[_-]?key|token|secret|password|authorization)[^"]*"\s*:\s*")([^"]*)(")/gi;

const toIso = (date: Date): string => date.toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const redactSensitiveText = (text: string): string =>
  text
    .replace(jsonSecretPattern, `$1${redactedSecret}$3`)
    .replace(envSecretPattern, `$1${redactedSecret}`)
    .replace(commandSecretPattern, `$1${redactedSecret}`)
    .replace(authorizationPattern, `$1${redactedSecret}`)
    .replace(windowsPathPattern, redactedPath);

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const sanitizeOptionalString = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeConfig = (config: Partial<CustomCommandConfig> = {}): CustomCommandConfig => ({
  enabled: config.enabled === true,
  authorized: config.authorized === true,
  commandPath: sanitizeOptionalString(config.commandPath),
  args: Array.isArray(config.args)
    ? config.args.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [],
  workingDirectory: sanitizeOptionalString(config.workingDirectory),
  timeoutMs:
    typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs)
      ? clamp(config.timeoutMs, minTimeoutMs, maxTimeoutMs)
      : defaultTimeoutMs,
  outputLimitBytes:
    typeof config.outputLimitBytes === "number" && Number.isFinite(config.outputLimitBytes)
      ? clamp(config.outputLimitBytes, minOutputLimitBytes, maxOutputLimitBytes)
      : defaultOutputLimitBytes
});

const readRequiredString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error("自定义命令输出格式无法解析"), {
      code: "CUSTOM_COMMAND_PARSE_FAILED"
    });
  }

  return redactSensitiveText(value.trim());
};

const readOptionalString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw Object.assign(new Error("自定义命令输出格式无法解析"), {
      code: "CUSTOM_COMMAND_PARSE_FAILED"
    });
  }

  return redactSensitiveText(value);
};

const readOptionalNumber = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw Object.assign(new Error("自定义命令输出格式无法解析"), {
      code: "CUSTOM_COMMAND_PARSE_FAILED"
    });
  }

  return value;
};

const readTaskStatus = (record: Record<string, unknown>): AgentTaskStatus => {
  const status = readRequiredString(record, "status") as AgentTaskStatus;

  if (!taskStatuses.has(status)) {
    throw Object.assign(new Error("自定义命令输出格式无法解析"), {
      code: "CUSTOM_COMMAND_PARSE_FAILED"
    });
  }

  return status;
};

const readProgressType = (record: Record<string, unknown>): AgentProgressType => {
  const value = record.progressType;

  if (value === undefined || value === null) {
    return "unavailable";
  }

  if (typeof value !== "string" || !progressTypes.has(value as AgentProgressType)) {
    throw Object.assign(new Error("自定义命令输出格式无法解析"), {
      code: "CUSTOM_COMMAND_PARSE_FAILED"
    });
  }

  return value as AgentProgressType;
};

const readOptionalIso = (record: Record<string, unknown>, key: string, fallback: string): string => {
  const value = readOptionalString(record, key);

  if (!value) {
    return fallback;
  }

  if (!Number.isFinite(new Date(value).getTime())) {
    throw Object.assign(new Error("自定义命令输出格式无法解析"), {
      code: "CUSTOM_COMMAND_PARSE_FAILED"
    });
  }

  return value;
};

const readOptionalNullableIso = (record: Record<string, unknown>, key: string): string | null => {
  const value = readOptionalString(record, key);

  if (!value) {
    return null;
  }

  if (!Number.isFinite(new Date(value).getTime())) {
    throw Object.assign(new Error("自定义命令输出格式无法解析"), {
      code: "CUSTOM_COMMAND_PARSE_FAILED"
    });
  }

  return value;
};

const readWaitingAction = (value: unknown): AgentWaitingAction | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw Object.assign(new Error("自定义命令输出格式无法解析"), {
      code: "CUSTOM_COMMAND_PARSE_FAILED"
    });
  }

  return {
    label: readRequiredString(value, "label"),
    description: readRequiredString(value, "description"),
    actionId: readRequiredString(value, "actionId")
  };
};

const sanitizePercent = (value: number | null): number | null => {
  if (value === null) {
    return null;
  }

  return clamp(value, 0, 100);
};

const getErrorDetail = (error: unknown): CustomCommandErrorDetail => {
  const code = error instanceof Error ? (error as { code?: unknown }).code : null;

  if (code === "ETIMEDOUT" || code === "CUSTOM_COMMAND_TIMEOUT") {
    return {
      code: "CUSTOM_COMMAND_TIMEOUT",
      message: "自定义命令执行超时"
    };
  }

  if (code === "CUSTOM_COMMAND_PARSE_FAILED" || error instanceof SyntaxError) {
    return {
      code: "CUSTOM_COMMAND_PARSE_FAILED",
      message: "自定义命令输出格式无法解析"
    };
  }

  if (code === "CUSTOM_COMMAND_VALIDATION_FAILED") {
    return {
      code: "CUSTOM_COMMAND_VALIDATION_FAILED",
      message: error instanceof Error ? error.message : "自定义命令配置无效"
    };
  }

  return {
    code: "CUSTOM_COMMAND_FAILED",
    message: error instanceof Error ? redactSensitiveText(error.message) : "自定义命令执行失败"
  };
};

class NativeCustomCommandRunner implements CustomCommandRunner {
  async run(request: CustomCommandRunRequest): Promise<CustomCommandRunResult> {
    const { stdout, stderr } = await execFileAsync(request.commandPath, request.args, {
      cwd: request.workingDirectory ?? undefined,
      timeout: request.timeoutMs,
      maxBuffer: request.outputLimitBytes,
      windowsHide: true,
      shell: false
    });

    return {
      stdout: String(stdout),
      stderr: String(stderr),
      exitCode: 0
    };
  }
}

export class CustomCommandAdapter implements AgentAdapter, RuntimeConfigurableAgentAdapter {
  readonly provider: AgentProvider;

  private readonly listeners = new Set<AgentAdapterEventListener>();
  private config: CustomCommandConfig;
  private readonly runner: CustomCommandRunner;
  private readonly now: () => Date;
  private readonly scanIntervalMs: number;
  private connectionStatus: AgentConnectionStatus = "unknown";
  private currentTasks: AgentTask[] = [];
  private currentQuota: QuotaSnapshot | null = null;
  private running = false;
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CustomCommandAdapterOptions = {}) {
    this.config = normalizeConfig(options.config);
    this.runner = options.runner ?? new NativeCustomCommandRunner();
    this.now = options.now ?? (() => new Date());
    this.scanIntervalMs = options.scanIntervalMs ?? defaultScanIntervalMs;
    this.provider = {
      id: "custom-command",
      name: "自定义命令 Agent",
      icon: "terminal-square",
      adapterType: "customCommand",
      enabled: this.config.enabled,
      connectionStatus: "unknown",
      lastConnectedAt: null,
      lastErrorAt: null,
      capabilities: [
        {
          id: "commandExecution",
          label: "命令执行",
          enabled: this.config.enabled && this.config.authorized
        },
        {
          id: "quota",
          label: "额度状态",
          enabled: false
        }
      ]
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.refresh();

    if (this.scanIntervalMs > 0) {
      this.scanTimer = setInterval(() => {
        void this.refresh();
      }, this.scanIntervalMs);
      this.scanTimer.unref?.();
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  async detect(): Promise<AdapterDetectionResult> {
    const occurredAt = toIso(this.now());

    try {
      const snapshot = await this.readCommandSnapshot(occurredAt);
      this.connectionStatus = snapshot.connectionStatus;
      this.currentTasks = snapshot.tasks;
      this.currentQuota = snapshot.quota;

      return {
        provider: this.buildProviderSnapshot(occurredAt),
        detected: snapshot.connectionStatus === "connected",
        message: snapshot.message
      };
    } catch (error) {
      const detail = getErrorDetail(error);
      this.connectionStatus = "error";
      this.currentTasks = [];
      this.currentQuota = null;

      return {
        provider: this.buildProviderSnapshot(occurredAt),
        detected: false,
        message: detail.message
      };
    }
  }

  async refresh(): Promise<void> {
    const occurredAt = toIso(this.now());

    try {
      const snapshot = await this.readCommandSnapshot(occurredAt);
      this.currentTasks = snapshot.tasks;
      this.currentQuota = snapshot.quota;
      this.updateConnection(snapshot.connectionStatus, snapshot.message, occurredAt);
      this.emit({
        type: "tasks:updated",
        providerId: this.provider.id,
        tasks: this.currentTasks,
        occurredAt
      });
      this.emit({
        type: "quota:updated",
        providerId: this.provider.id,
        quota: await this.getQuota(),
        occurredAt
      });
    } catch (error) {
      const detail = getErrorDetail(error);
      this.currentTasks = [];
      this.currentQuota = null;
      this.updateConnection("error", detail.message, occurredAt);
      this.emit({
        type: "tasks:updated",
        providerId: this.provider.id,
        tasks: [],
        occurredAt
      });
      this.emit({
        type: "error:raised",
        providerId: this.provider.id,
        code: detail.code,
        message: detail.message,
        occurredAt
      });
    }
  }

  subscribe(listener: AgentAdapterEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async getCurrentTasks(): Promise<AgentTask[]> {
    return this.currentTasks;
  }

  async getQuota(): Promise<QuotaSnapshot> {
    if (this.currentQuota) {
      return this.currentQuota;
    }

    return this.buildUnavailableQuota(toIso(this.now()));
  }

  async getConnectionStatus(): Promise<AgentConnectionStatus> {
    return this.connectionStatus;
  }

  async updateRuntimeConfig(config: unknown): Promise<void> {
    if (!isRecord(config)) {
      return;
    }

    const nextConfig = normalizeConfig({
      ...this.config,
      ...config,
      enabled: typeof config.enabled === "boolean" ? config.enabled : this.provider.enabled
    });
    this.config = nextConfig;
    this.provider.enabled = nextConfig.enabled;
    this.provider.capabilities = this.buildCapabilities();
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.listeners.clear();
    this.currentTasks = [];
    this.currentQuota = null;
  }

  private async readCommandSnapshot(occurredAt: string): Promise<CustomCommandSnapshot> {
    const inactiveSnapshot = this.getInactiveSnapshot(occurredAt);

    if (inactiveSnapshot) {
      return inactiveSnapshot;
    }

    this.assertCommandAllowed();

    const result = await this.runner.run({
      commandPath: this.config.commandPath as string,
      args: this.config.args,
      workingDirectory: this.config.workingDirectory,
      timeoutMs: this.config.timeoutMs,
      outputLimitBytes: this.config.outputLimitBytes
    });

    if (result.exitCode !== 0) {
      throw Object.assign(new Error(redactSensitiveText(result.stderr || "自定义命令执行失败")), {
        code: "CUSTOM_COMMAND_FAILED"
      });
    }

    return this.parseCommandOutput(result.stdout, occurredAt);
  }

  private getInactiveSnapshot(occurredAt: string): CustomCommandSnapshot | null {
    if (!this.provider.enabled) {
      return {
        tasks: [],
        quota: this.buildUnavailableQuota(occurredAt),
        connectionStatus: "notFound",
        message: "自定义命令未启用"
      };
    }

    if (!this.config.authorized) {
      return {
        tasks: [],
        quota: this.buildUnavailableQuota(occurredAt),
        connectionStatus: "permissionDenied",
        message: "自定义命令未授权"
      };
    }

    if (!this.config.commandPath) {
      return {
        tasks: [],
        quota: this.buildUnavailableQuota(occurredAt),
        connectionStatus: "notFound",
        message: "自定义命令未配置"
      };
    }

    return null;
  }

  private assertCommandAllowed(): void {
    const executableName = path.basename(this.config.commandPath as string).toLowerCase();

    if (blockedElevationExecutables.has(executableName)) {
      throw Object.assign(new Error("自定义命令不得以管理员权限运行"), {
        code: "CUSTOM_COMMAND_VALIDATION_FAILED"
      });
    }

    const joinedArgs = this.config.args.join(" ").toLowerCase();

    if (executableName.includes("powershell") && /start-process/.test(joinedArgs) && /-verb\s+runas/.test(joinedArgs)) {
      throw Object.assign(new Error("自定义命令不得以管理员权限运行"), {
        code: "CUSTOM_COMMAND_VALIDATION_FAILED"
      });
    }
  }

  private parseCommandOutput(stdout: string, occurredAt: string): CustomCommandSnapshot {
    const trimmed = stdout.trim();

    if (!trimmed) {
      return {
        tasks: [],
        quota: this.buildUnavailableQuota(occurredAt),
        connectionStatus: "notRunning",
        message: "自定义命令未返回状态"
      };
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error("自定义命令输出格式无法解析"), {
        code: "CUSTOM_COMMAND_PARSE_FAILED"
      });
    }

    if (!isRecord(parsed)) {
      throw Object.assign(new Error("自定义命令输出格式无法解析"), {
        code: "CUSTOM_COMMAND_PARSE_FAILED"
      });
    }

    const rawTasks = parsed.tasks;

    if (rawTasks !== undefined && !Array.isArray(rawTasks)) {
      throw Object.assign(new Error("自定义命令输出格式无法解析"), {
        code: "CUSTOM_COMMAND_PARSE_FAILED"
      });
    }

    const tasks = (rawTasks ?? []).map((task, index) => this.normalizeCommandTask(task, index, occurredAt));
    const quota = this.normalizeCommandQuota(parsed.quota, occurredAt);

    return {
      tasks,
      quota,
      connectionStatus: tasks.length > 0 || parsed.quota ? "connected" : "notRunning",
      message: "已读取自定义命令状态"
    };
  }

  private normalizeCommandTask(rawTask: unknown, index: number, occurredAt: string): AgentTask {
    if (!isRecord(rawTask)) {
      throw Object.assign(new Error("自定义命令输出格式无法解析"), {
        code: "CUSTOM_COMMAND_PARSE_FAILED"
      });
    }

    const id = readRequiredString(rawTask, "id");
    const status = readTaskStatus(rawTask);
    const progressType = readProgressType(rawTask);
    const progressValue = progressType === "determinate" ? sanitizePercent(readOptionalNumber(rawTask, "progressValue")) : null;
    const updatedAt = readOptionalIso(rawTask, "updatedAt", occurredAt);
    const startedAt = readOptionalIso(rawTask, "startedAt", updatedAt);

    return {
      id: `custom-command-${id}`,
      providerId: this.provider.id,
      sessionId: readOptionalString(rawTask, "sessionId") ?? id,
      title: readOptionalString(rawTask, "title") ?? "自定义命令任务",
      projectName: readOptionalString(rawTask, "projectName") ?? "自定义 Agent",
      projectPath: readOptionalString(rawTask, "projectPath"),
      status,
      stage: readOptionalString(rawTask, "stage") ?? "命令同步",
      priority: priorityFromTaskStatus(status),
      startedAt,
      updatedAt,
      completedAt: readOptionalNullableIso(rawTask, "completedAt"),
      lastActivityAt: readOptionalIso(rawTask, "lastActivityAt", updatedAt),
      lastActivityText: readOptionalString(rawTask, "lastActivityText") ?? "已读取自定义命令状态",
      progressType,
      progressValue,
      completedSteps: readOptionalNumber(rawTask, "completedSteps"),
      totalSteps: readOptionalNumber(rawTask, "totalSteps"),
      waitingAction: readWaitingAction(rawTask.waitingAction),
      errorCode: readOptionalString(rawTask, "errorCode"),
      errorMessage: readOptionalString(rawTask, "errorMessage"),
      sourceId: readOptionalString(rawTask, "sourceId") ?? `custom-command-${index}`
    };
  }

  private normalizeCommandQuota(rawQuota: unknown, occurredAt: string): QuotaSnapshot {
    const fallback = this.buildUnavailableQuota(occurredAt);

    if (rawQuota === undefined || rawQuota === null) {
      return fallback;
    }

    if (!isRecord(rawQuota)) {
      throw Object.assign(new Error("自定义命令输出格式无法解析"), {
        code: "CUSTOM_COMMAND_PARSE_FAILED"
      });
    }

    return {
      id: readOptionalString(rawQuota, "id") ?? "custom-command-quota",
      providerId: this.provider.id,
      total: readOptionalNumber(rawQuota, "total"),
      used: readOptionalNumber(rawQuota, "used"),
      remaining: readOptionalNumber(rawQuota, "remaining"),
      remainingPercent: sanitizePercent(readOptionalNumber(rawQuota, "remainingPercent")),
      resetAt: readOptionalNullableIso(rawQuota, "resetAt"),
      capturedAt: readOptionalIso(rawQuota, "capturedAt", occurredAt),
      expiresAt: readOptionalIso(rawQuota, "expiresAt", toIso(new Date(this.now().getTime() + 5 * 60 * 1000))),
      isEstimated: rawQuota.isEstimated === true,
      source: readOptionalString(rawQuota, "source") ?? "custom-command",
      errorMessage: readOptionalString(rawQuota, "errorMessage")
    };
  }

  private buildUnavailableQuota(capturedAt: string): QuotaSnapshot {
    return {
      id: "custom-command-quota-unavailable",
      providerId: this.provider.id,
      total: null,
      used: null,
      remaining: null,
      remainingPercent: null,
      resetAt: null,
      capturedAt,
      expiresAt: toIso(new Date(this.now().getTime() + 5 * 60 * 1000)),
      isEstimated: false,
      source: "custom-command",
      errorMessage: "额度暂不可用"
    };
  }

  private updateConnection(status: AgentConnectionStatus, message: string, occurredAt: string): void {
    this.connectionStatus = status;
    this.emit({
      type: "connection:changed",
      providerId: this.provider.id,
      status,
      message,
      occurredAt
    });
    this.emit({
      type: "provider:updated",
      provider: this.buildProviderSnapshot(occurredAt),
      occurredAt
    });
  }

  private buildProviderSnapshot(occurredAt: string): AgentProvider {
    return {
      ...this.provider,
      capabilities: this.buildCapabilities(),
      connectionStatus: this.connectionStatus,
      lastConnectedAt: this.connectionStatus === "connected" ? occurredAt : this.provider.lastConnectedAt,
      lastErrorAt: this.connectionStatus === "connected" ? this.provider.lastErrorAt : occurredAt
    };
  }

  private buildCapabilities(): AgentProvider["capabilities"] {
    return this.provider.capabilities.map((capability) =>
      capability.id === "commandExecution"
        ? {
            ...capability,
            enabled: this.provider.enabled && this.config.authorized
          }
        : capability
    );
  }

  private emit(event: AgentAdapterEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
