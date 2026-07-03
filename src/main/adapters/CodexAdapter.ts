import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
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

export interface CodexProcessInfo {
  pid: number | null;
  name: string;
  commandLine: string;
}

export interface CodexProcessProbe {
  listProcesses(): Promise<CodexProcessInfo[]>;
}

export interface CodexStatusSource {
  readStatus(): Promise<unknown | null>;
}

export interface CodexLogSource {
  readEvents(): Promise<unknown[] | null>;
}

export interface CodexAdapterOptions {
  enabled?: boolean;
  processProbe?: CodexProcessProbe;
  statusSource?: CodexStatusSource;
  logSource?: CodexLogSource;
  statusFilePath?: string;
  logFilePath?: string;
  now?: () => Date;
  scanIntervalMs?: number;
}

const execFileAsync = promisify(execFile);
const defaultScanIntervalMs = 15_000;
const processOutputLimit = 1024 * 1024;
const processCommandTimeoutMs = 5000;
const statusFileLimit = 512 * 1024;
const logFileLimit = 1024 * 1024;

interface CodexSourceSnapshot {
  tasks: AgentTask[];
  quota: QuotaSnapshot;
  connectionStatus: AgentConnectionStatus;
  message: string;
}

const toIso = (date: Date): string => date.toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toStringValue = (value: unknown): string => (typeof value === "string" ? value : "");

const parseWindowsProcessList = (stdout: string): CodexProcessInfo[] => {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  const records = Array.isArray(parsed) ? parsed : [parsed];

  return records
    .filter((record): record is Record<string, unknown> => typeof record === "object" && record !== null)
    .map((record) => ({
      pid: toNumberOrNull(record.ProcessId),
      name: toStringValue(record.Name),
      commandLine: toStringValue(record.CommandLine)
    }));
};

const parsePosixProcessList = (stdout: string): CodexProcessInfo[] =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(\S+)\s*(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: toNumberOrNull(match[1]),
      name: match[2] ?? "",
      commandLine: match[3] ?? ""
    }));

class NativeCodexProcessProbe implements CodexProcessProbe {
  async listProcesses(): Promise<CodexProcessInfo[]> {
    if (process.platform === "win32") {
      const command =
        "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress";
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        {
          timeout: processCommandTimeoutMs,
          maxBuffer: processOutputLimit,
          windowsHide: true
        }
      );

      return parseWindowsProcessList(String(stdout));
    }

    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,comm=,args="], {
      timeout: processCommandTimeoutMs,
      maxBuffer: processOutputLimit
    });

    return parsePosixProcessList(String(stdout));
  }
}

class FileCodexStatusSource implements CodexStatusSource {
  constructor(private readonly filePath: string) {}

  async readStatus(): Promise<unknown | null> {
    const raw = await readFile(this.filePath, "utf8");

    if (Buffer.byteLength(raw, "utf8") > statusFileLimit) {
      throw new Error("状态源文件超过大小限制");
    }

    const trimmed = raw.trim();

    if (!trimmed) {
      return null;
    }

    return JSON.parse(trimmed) as unknown;
  }
}

class FileCodexLogSource implements CodexLogSource {
  constructor(private readonly filePath: string) {}

  async readEvents(): Promise<unknown[] | null> {
    const raw = await readFile(this.filePath, "utf8");

    if (Buffer.byteLength(raw, "utf8") > logFileLimit) {
      throw new Error("日志源文件超过大小限制");
    }

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return null;
    }

    return lines.map((line) => JSON.parse(line) as unknown);
  }
}

const codexProcessPatterns = [
  /(^|[\\/\s"'])codex(\.exe)?($|[\s"'])/i,
  /@openai[\\/]codex/i,
  /openai-codex/i
];

const isCodexProcess = (processInfo: CodexProcessInfo): boolean => {
  const searchableText = `${processInfo.name} ${processInfo.commandLine}`;
  return codexProcessPatterns.some((pattern) => pattern.test(searchableText));
};

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : "进程检测失败");

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

const connectionStatuses = new Set<AgentConnectionStatus>([
  "unknown",
  "detecting",
  "connected",
  "disconnected",
  "error",
  "permissionDenied",
  "notFound",
  "notRunning",
  "stale"
]);

const readRequiredString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("状态源数据格式无法解析");
  }

  return value.trim();
};

const readOptionalString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("状态源数据格式无法解析");
  }

  return value;
};

const readOptionalIdentityString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("状态源数据格式无法解析");
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readFirstIdentityString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = readOptionalIdentityString(record, key);

    if (value) {
      return value;
    }
  }

  return null;
};

const directTaskIdentityKeys = ["id", "taskId", "task_id"];
const directSessionIdentityKeys = [
  "sessionId",
  "session_id",
  "codexSessionId",
  "codex_session_id",
  "conversationId",
  "conversation_id",
  "threadId",
  "thread_id"
];
const nestedIdentityKeys = ["session", "conversation", "thread"];
const nestedSessionIdentityKeys = [
  "id",
  "sessionId",
  "session_id",
  "codexSessionId",
  "codex_session_id",
  "conversationId",
  "conversation_id",
  "threadId",
  "thread_id"
];

const readNestedSessionIdentity = (record: Record<string, unknown>): string | null => {
  for (const key of nestedIdentityKeys) {
    const value = record[key];

    if (value === undefined || value === null) {
      continue;
    }

    if (!isRecord(value)) {
      throw new Error("状态源数据格式无法解析");
    }

    const sessionId = readFirstIdentityString(value, nestedSessionIdentityKeys);

    if (sessionId) {
      return sessionId;
    }
  }

  return null;
};

const readTaskIdentity = (record: Record<string, unknown>): { id: string; sessionId: string } => {
  const id = readFirstIdentityString(record, directTaskIdentityKeys);
  const sessionId =
    readFirstIdentityString(record, directSessionIdentityKeys) ?? readNestedSessionIdentity(record) ?? id;

  if (!id && !sessionId) {
    throw new Error("状态源数据格式无法解析");
  }

  const resolvedId = id ?? sessionId;
  const resolvedSessionId = sessionId ?? resolvedId;

  if (!resolvedId || !resolvedSessionId) {
    throw new Error("状态源数据格式无法解析");
  }

  return {
    id: resolvedId,
    sessionId: resolvedSessionId
  };
};

const readOptionalNumber = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("状态源数据格式无法解析");
  }

  return value;
};

const readTaskStatus = (record: Record<string, unknown>): AgentTaskStatus => {
  const status = readRequiredString(record, "status") as AgentTaskStatus;

  if (!taskStatuses.has(status)) {
    throw new Error("状态源数据格式无法解析");
  }

  return status;
};

const readProgressType = (record: Record<string, unknown>): AgentProgressType => {
  const value = record.progressType;

  if (value === undefined || value === null) {
    return "unavailable";
  }

  if (typeof value !== "string" || !progressTypes.has(value as AgentProgressType)) {
    throw new Error("状态源数据格式无法解析");
  }

  return value as AgentProgressType;
};

const readWaitingAction = (value: unknown): AgentWaitingAction | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("状态源数据格式无法解析");
  }

  return {
    label: readRequiredString(value, "label"),
    description: readRequiredString(value, "description"),
    actionId: readRequiredString(value, "actionId")
  };
};

const readOptionalIso = (record: Record<string, unknown>, key: string, fallback: string): string => {
  const value = readOptionalString(record, key);

  if (!value) {
    return fallback;
  }

  if (!Number.isFinite(new Date(value).getTime())) {
    throw new Error("状态源数据格式无法解析");
  }

  return value;
};

const readOptionalNullableIso = (record: Record<string, unknown>, key: string): string | null => {
  const value = readOptionalString(record, key);

  if (!value) {
    return null;
  }

  if (!Number.isFinite(new Date(value).getTime())) {
    throw new Error("状态源数据格式无法解析");
  }

  return value;
};

const readConnectionStatus = (value: unknown, fallback: AgentConnectionStatus): AgentConnectionStatus => {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "string" || !connectionStatuses.has(value as AgentConnectionStatus)) {
    throw new Error("状态源数据格式无法解析");
  }

  return value as AgentConnectionStatus;
};

const sanitizePercent = (value: number | null): number | null => {
  if (value === null) {
    return null;
  }

  return Math.min(Math.max(value, 0), 100);
};

const sanitizeConfigPath = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const createStatusSourceFromPath = (filePath: string | null): CodexStatusSource | null =>
  filePath ? new FileCodexStatusSource(filePath) : null;

const createLogSourceFromPath = (filePath: string | null): CodexLogSource | null =>
  filePath ? new FileCodexLogSource(filePath) : null;

export class CodexAdapter implements AgentAdapter, RuntimeConfigurableAgentAdapter {
  readonly provider: AgentProvider = {
    id: "codex",
    name: "Codex CLI",
    icon: "terminal",
    adapterType: "codex",
    enabled: true,
    connectionStatus: "unknown",
    lastConnectedAt: null,
    lastErrorAt: null,
    capabilities: [
      {
        id: "processDetection",
        label: "进程检测",
        enabled: true
      },
      {
        id: "quota",
        label: "额度状态",
        enabled: false
      }
    ]
  };

  private readonly listeners = new Set<AgentAdapterEventListener>();
  private readonly processProbe: CodexProcessProbe;
  private statusSource: CodexStatusSource | null;
  private logSource: CodexLogSource | null;
  private readonly now: () => Date;
  private readonly scanIntervalMs: number;
  private readonly firstSeenAtByProcessKey = new Map<string, string>();
  private connectionStatus: AgentConnectionStatus = "unknown";
  private currentTasks: AgentTask[] = [];
  private currentQuota: QuotaSnapshot | null = null;
  private running = false;
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CodexAdapterOptions = {}) {
    this.provider.enabled = options.enabled ?? true;
    this.processProbe = options.processProbe ?? new NativeCodexProcessProbe();
    this.statusSource =
      options.statusSource ??
      createStatusSourceFromPath(options.statusFilePath ?? process.env.CODEPULSE_CODEX_STATUS_FILE ?? null);
    this.logSource =
      options.logSource ??
      createLogSourceFromPath(options.logFilePath ?? process.env.CODEPULSE_CODEX_LOG_FILE ?? null);
    this.now = options.now ?? (() => new Date());
    this.scanIntervalMs = options.scanIntervalMs ?? defaultScanIntervalMs;
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
      const sourceSnapshot = await this.readConfiguredSnapshot(occurredAt);

      if (sourceSnapshot) {
        this.connectionStatus = sourceSnapshot.connectionStatus;
        this.currentTasks = sourceSnapshot.tasks;
        this.currentQuota = sourceSnapshot.quota;

        return {
          provider: this.buildProviderSnapshot(occurredAt),
          detected: sourceSnapshot.tasks.length > 0 || sourceSnapshot.connectionStatus === "connected",
          message: sourceSnapshot.message
        };
      }

      const processes = await this.readCodexProcesses();
      const detected = processes.length > 0;
      this.connectionStatus = detected ? "connected" : "notRunning";
      this.currentTasks = this.buildTasks(processes, occurredAt);

      return {
        provider: this.buildProviderSnapshot(occurredAt),
        detected,
        message: detected ? "已检测到 Codex 进程" : "未发现正在运行的 Codex 进程"
      };
    } catch (error) {
      const message = getErrorMessage(error);
      this.connectionStatus = "error";
      this.currentTasks = [];

      return {
        provider: this.buildProviderSnapshot(occurredAt),
        detected: false,
        message
      };
    }
  }

  async refresh(): Promise<void> {
    const occurredAt = toIso(this.now());

    try {
      const sourceSnapshot = await this.readConfiguredSnapshot(occurredAt);

      if (sourceSnapshot) {
        this.currentTasks = sourceSnapshot.tasks;
        this.currentQuota = sourceSnapshot.quota;
        this.updateConnection(sourceSnapshot.connectionStatus, sourceSnapshot.message, occurredAt);
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
        return;
      }

      const processes = await this.readCodexProcesses();
      const nextStatus: AgentConnectionStatus = processes.length > 0 ? "connected" : "notRunning";
      this.currentTasks = this.buildTasks(processes, occurredAt);
      this.currentQuota = null;
      this.updateConnection(nextStatus, nextStatus === "connected" ? "Codex 进程运行中" : "Codex 未运行", occurredAt);
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
      const message = getErrorMessage(error);
      this.currentTasks = [];
      this.currentQuota = null;
      this.updateConnection("error", message, occurredAt);
      this.emit({
        type: "tasks:updated",
        providerId: this.provider.id,
        tasks: [],
        occurredAt
      });
      this.emit({
        type: "error:raised",
        providerId: this.provider.id,
        code: "CODEX_PROCESS_DETECT_FAILED",
        message,
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

    const capturedAt = toIso(this.now());

    return {
      id: "codex-quota-unavailable",
      providerId: this.provider.id,
      total: null,
      used: null,
      remaining: null,
      remainingPercent: null,
      resetAt: null,
      capturedAt,
      expiresAt: toIso(new Date(this.now().getTime() + 5 * 60 * 1000)),
      isEstimated: false,
      source: "codex",
      errorMessage: "额度暂不可用"
    };
  }

  async getConnectionStatus(): Promise<AgentConnectionStatus> {
    return this.connectionStatus;
  }

  async updateRuntimeConfig(config: unknown): Promise<void> {
    if (!isRecord(config)) {
      return;
    }

    if (typeof config.enabled === "boolean") {
      this.provider.enabled = config.enabled;
    }

    if ("statusFilePath" in config) {
      this.statusSource = createStatusSourceFromPath(sanitizeConfigPath(config.statusFilePath));
    }

    if ("logFilePath" in config) {
      this.logSource = createLogSourceFromPath(sanitizeConfigPath(config.logFilePath));
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.listeners.clear();
    this.currentTasks = [];
    this.currentQuota = null;
    this.firstSeenAtByProcessKey.clear();
  }

  private async readConfiguredSnapshot(occurredAt: string): Promise<CodexSourceSnapshot | null> {
    const statusSnapshot = await this.readStatusSnapshot(occurredAt);

    if (statusSnapshot) {
      return statusSnapshot;
    }

    return this.readLogSnapshot(occurredAt);
  }

  private async readStatusSnapshot(occurredAt: string): Promise<CodexSourceSnapshot | null> {
    if (!this.statusSource) {
      return null;
    }

    const rawStatus = await this.statusSource.readStatus();

    if (rawStatus === null) {
      return null;
    }

    if (!isRecord(rawStatus)) {
      throw new Error("状态源数据格式无法解析");
    }

    const rawTasks = rawStatus.tasks;

    if (rawTasks !== undefined && !Array.isArray(rawTasks)) {
      throw new Error("状态源数据格式无法解析");
    }

    const tasks = (rawTasks ?? []).map((task, index) => this.normalizeStatusTask(task, index, occurredAt));
    const quota = this.normalizeStatusQuota(rawStatus.quota, occurredAt);
    const connectionStatus = readConnectionStatus(rawStatus.connectionStatus, tasks.length > 0 ? "connected" : "notRunning");

    return {
      tasks,
      quota,
      connectionStatus,
      message: "已读取 Codex 状态源"
    };
  }

  private normalizeStatusTask(rawTask: unknown, index: number, occurredAt: string): AgentTask {
    return this.normalizeSourceTask(rawTask, index, occurredAt, {
      idPrefix: "codex-status",
      sourceIdPrefix: "codex-status",
      defaultActivityText: "已读取 Codex 状态源"
    });
  }

  private normalizeLogTask(rawTask: unknown, index: number, occurredAt: string): AgentTask {
    return this.normalizeSourceTask(rawTask, index, occurredAt, {
      idPrefix: "codex-log",
      sourceIdPrefix: "codex-log",
      defaultActivityText: "已读取 Codex 日志源"
    });
  }

  private normalizeSourceTask(
    rawTask: unknown,
    index: number,
    occurredAt: string,
    source: {
      idPrefix: string;
      sourceIdPrefix: string;
      defaultActivityText: string;
    }
  ): AgentTask {
    if (!isRecord(rawTask)) {
      throw new Error("状态源数据格式无法解析");
    }

    const identity = readTaskIdentity(rawTask);
    const status = readTaskStatus(rawTask);
    const progressType = readProgressType(rawTask);
    const progressValue = progressType === "determinate" ? sanitizePercent(readOptionalNumber(rawTask, "progressValue")) : null;
    const completedSteps = readOptionalNumber(rawTask, "completedSteps");
    const totalSteps = readOptionalNumber(rawTask, "totalSteps");
    const updatedAt = readOptionalIso(rawTask, "updatedAt", occurredAt);
    const startedAt = readOptionalIso(rawTask, "startedAt", updatedAt);

    return {
      id: `${source.idPrefix}-${identity.id}`,
      providerId: this.provider.id,
      sessionId: identity.sessionId,
      title: readOptionalString(rawTask, "title") ?? "Codex 会话",
      projectName: readOptionalString(rawTask, "projectName") ?? "Codex",
      projectPath: readOptionalString(rawTask, "projectPath"),
      status,
      stage: readOptionalString(rawTask, "stage") ?? "状态同步",
      priority: priorityFromTaskStatus(status),
      startedAt,
      updatedAt,
      completedAt: readOptionalNullableIso(rawTask, "completedAt"),
      lastActivityAt: readOptionalIso(rawTask, "lastActivityAt", updatedAt),
      lastActivityText: readOptionalString(rawTask, "lastActivityText") ?? source.defaultActivityText,
      progressType,
      progressValue,
      completedSteps,
      totalSteps,
      waitingAction: readWaitingAction(rawTask.waitingAction),
      errorCode: readOptionalString(rawTask, "errorCode"),
      errorMessage: readOptionalString(rawTask, "errorMessage"),
      sourceId: readOptionalString(rawTask, "sourceId") ?? `${source.sourceIdPrefix}-${index}`
    };
  }

  private normalizeStatusQuota(rawQuota: unknown, occurredAt: string): QuotaSnapshot {
    return this.normalizeSourceQuota(rawQuota, occurredAt, "codex-status", "codex-quota-status");
  }

  private normalizeLogQuota(rawQuota: unknown, occurredAt: string): QuotaSnapshot {
    return this.normalizeSourceQuota(rawQuota, occurredAt, "codex-log", "codex-quota-log");
  }

  private normalizeSourceQuota(rawQuota: unknown, occurredAt: string, source: string, fallbackId: string): QuotaSnapshot {
    const fallback = {
      id: "codex-quota-unavailable",
      providerId: this.provider.id,
      total: null,
      used: null,
      remaining: null,
      remainingPercent: null,
      resetAt: null,
      capturedAt: occurredAt,
      expiresAt: toIso(new Date(this.now().getTime() + 5 * 60 * 1000)),
      isEstimated: false,
      source,
      errorMessage: "额度暂不可用"
    } satisfies QuotaSnapshot;

    if (rawQuota === undefined || rawQuota === null) {
      return fallback;
    }

    if (!isRecord(rawQuota)) {
      throw new Error("状态源数据格式无法解析");
    }

    const remainingPercent = sanitizePercent(readOptionalNumber(rawQuota, "remainingPercent"));

    return {
      id: readOptionalString(rawQuota, "id") ?? fallbackId,
      providerId: this.provider.id,
      total: readOptionalNumber(rawQuota, "total"),
      used: readOptionalNumber(rawQuota, "used"),
      remaining: readOptionalNumber(rawQuota, "remaining"),
      remainingPercent,
      resetAt: readOptionalNullableIso(rawQuota, "resetAt"),
      capturedAt: readOptionalIso(rawQuota, "capturedAt", occurredAt),
      expiresAt: readOptionalIso(rawQuota, "expiresAt", toIso(new Date(this.now().getTime() + 5 * 60 * 1000))),
      isEstimated: rawQuota.isEstimated === true,
      source: readOptionalString(rawQuota, "source") ?? source,
      errorMessage: readOptionalString(rawQuota, "errorMessage")
    };
  }

  private async readLogSnapshot(occurredAt: string): Promise<CodexSourceSnapshot | null> {
    if (!this.logSource) {
      return null;
    }

    const rawEvents = await this.logSource.readEvents();

    if (rawEvents === null) {
      return null;
    }

    const taskEvents = new Map<string, Record<string, unknown>>();
    let quotaEvent: Record<string, unknown> | null = null;

    for (const rawEvent of rawEvents) {
      if (!isRecord(rawEvent)) {
        throw new Error("日志源数据格式无法解析");
      }

      const eventType = readOptionalString(rawEvent, "type") ?? readOptionalString(rawEvent, "event") ?? readOptionalString(rawEvent, "kind");
      const isTaskEvent = eventType === "task" || (!eventType && "status" in rawEvent);
      const isQuotaEvent = eventType === "quota";

      if (isTaskEvent) {
        const identity = readTaskIdentity(rawEvent);
        taskEvents.set(identity.sessionId, rawEvent);
      } else if (isQuotaEvent) {
        quotaEvent = rawEvent;
      }
    }

    if (taskEvents.size === 0 && quotaEvent === null) {
      return null;
    }

    const tasks = Array.from(taskEvents.values()).map((task, index) => this.normalizeLogTask(task, index, occurredAt));
    const quota = this.normalizeLogQuota(quotaEvent, occurredAt);
    const connectionStatus: AgentConnectionStatus = tasks.length > 0 || quotaEvent ? "connected" : "notRunning";

    return {
      tasks,
      quota,
      connectionStatus,
      message: "已读取 Codex 日志源"
    };
  }

  private async readCodexProcesses(): Promise<CodexProcessInfo[]> {
    const processes = await this.processProbe.listProcesses();
    return processes.filter(isCodexProcess);
  }

  private buildTasks(processes: CodexProcessInfo[], occurredAt: string): AgentTask[] {
    const activeKeys = new Set<string>();
    const tasks = processes.map((processInfo, index) => {
      const processKey = this.getProcessKey(processInfo, index);
      activeKeys.add(processKey);
      const startedAt = this.firstSeenAtByProcessKey.get(processKey) ?? occurredAt;
      this.firstSeenAtByProcessKey.set(processKey, startedAt);
      const pidText = processInfo.pid === null ? "" : ` · PID ${processInfo.pid}`;

      return {
        id: `codex-${processKey}`,
        providerId: this.provider.id,
        sessionId: `codex-${processKey}`,
        title: "Codex 会话运行中",
        projectName: "本机 Codex",
        projectPath: null,
        status: "executing",
        stage: "进程运行",
        priority: priorityFromTaskStatus("executing"),
        startedAt,
        updatedAt: occurredAt,
        completedAt: null,
        lastActivityAt: occurredAt,
        lastActivityText: `检测到 Codex CLI 进程${pidText}`,
        progressType: "indeterminate",
        progressValue: null,
        completedSteps: null,
        totalSteps: null,
        waitingAction: null,
        errorCode: null,
        errorMessage: null,
        sourceId: "codex-process"
      } satisfies AgentTask;
    });

    for (const processKey of this.firstSeenAtByProcessKey.keys()) {
      if (!activeKeys.has(processKey)) {
        this.firstSeenAtByProcessKey.delete(processKey);
      }
    }

    return tasks;
  }

  private getProcessKey(processInfo: CodexProcessInfo, index: number): string {
    if (processInfo.pid !== null) {
      return `pid-${processInfo.pid}`;
    }

    return `unknown-${index}`;
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
      connectionStatus: this.connectionStatus,
      lastConnectedAt: this.connectionStatus === "connected" ? occurredAt : this.provider.lastConnectedAt,
      lastErrorAt: this.connectionStatus === "connected" ? this.provider.lastErrorAt : occurredAt
    };
  }

  private emit(event: AgentAdapterEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
