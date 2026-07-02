import { readFile } from "node:fs/promises";
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

export interface LogEventSource {
  readEvents(): Promise<unknown[] | null>;
}

export interface LogAdapterOptions {
  enabled?: boolean;
  logSource?: LogEventSource;
  logFilePath?: string;
  now?: () => Date;
  scanIntervalMs?: number;
}

interface LogSourceSnapshot {
  tasks: AgentTask[];
  quota: QuotaSnapshot;
  connectionStatus: AgentConnectionStatus;
  message: string;
}

const defaultScanIntervalMs = 15_000;
const logFileLimit = 1024 * 1024;

const toIso = (date: Date): string => date.toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

const getErrorMessage = (error: unknown): string => {
  if (error instanceof SyntaxError) {
    return "日志源数据格式无法解析";
  }

  if (error instanceof Error) {
    const fileErrorCode = (error as { code?: unknown }).code;

    if (fileErrorCode === "ENOENT") {
      return "日志文件不存在";
    }

    if (fileErrorCode === "EACCES" || fileErrorCode === "EPERM") {
      return "日志文件无权限";
    }

    return error.message || "日志源读取失败";
  }

  return "日志源读取失败";
};

const readRequiredString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("日志源数据格式无法解析");
  }

  return value.trim();
};

const readOptionalString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("日志源数据格式无法解析");
  }

  return value;
};

const readOptionalNumber = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("日志源数据格式无法解析");
  }

  return value;
};

const readTaskStatus = (record: Record<string, unknown>): AgentTaskStatus => {
  const status = readRequiredString(record, "status") as AgentTaskStatus;

  if (!taskStatuses.has(status)) {
    throw new Error("日志源数据格式无法解析");
  }

  return status;
};

const readProgressType = (record: Record<string, unknown>): AgentProgressType => {
  const value = record.progressType;

  if (value === undefined || value === null) {
    return "unavailable";
  }

  if (typeof value !== "string" || !progressTypes.has(value as AgentProgressType)) {
    throw new Error("日志源数据格式无法解析");
  }

  return value as AgentProgressType;
};

const readWaitingAction = (value: unknown): AgentWaitingAction | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("日志源数据格式无法解析");
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
    throw new Error("日志源数据格式无法解析");
  }

  return value;
};

const readOptionalNullableIso = (record: Record<string, unknown>, key: string): string | null => {
  const value = readOptionalString(record, key);

  if (!value) {
    return null;
  }

  if (!Number.isFinite(new Date(value).getTime())) {
    throw new Error("日志源数据格式无法解析");
  }

  return value;
};

const sanitizePercent = (value: number | null): number | null => {
  if (value === null) {
    return null;
  }

  return Math.min(Math.max(value, 0), 100);
};

class FileLogEventSource implements LogEventSource {
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

const sanitizeConfigPath = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const createLogSourceFromPath = (filePath: string | null): LogEventSource | null =>
  filePath ? new FileLogEventSource(filePath) : null;

export class LogAdapter implements AgentAdapter, RuntimeConfigurableAgentAdapter {
  readonly provider: AgentProvider = {
    id: "log",
    name: "通用日志 Agent",
    icon: "file-text",
    adapterType: "log",
    enabled: true,
    connectionStatus: "unknown",
    lastConnectedAt: null,
    lastErrorAt: null,
    capabilities: [
      {
        id: "logSource",
        label: "日志源",
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
  private logSource: LogEventSource | null;
  private readonly now: () => Date;
  private readonly scanIntervalMs: number;
  private connectionStatus: AgentConnectionStatus = "unknown";
  private currentTasks: AgentTask[] = [];
  private currentQuota: QuotaSnapshot | null = null;
  private running = false;
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: LogAdapterOptions = {}) {
    this.provider.enabled = options.enabled ?? true;
    this.logSource =
      options.logSource ??
      createLogSourceFromPath(options.logFilePath ?? process.env.CODEPULSE_AGENT_LOG_FILE ?? null);
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
      const sourceSnapshot = await this.readLogSnapshot(occurredAt);
      this.connectionStatus = sourceSnapshot.connectionStatus;
      this.currentTasks = sourceSnapshot.tasks;
      this.currentQuota = sourceSnapshot.quota;

      return {
        provider: this.buildProviderSnapshot(occurredAt),
        detected: sourceSnapshot.connectionStatus === "connected",
        message: sourceSnapshot.message
      };
    } catch (error) {
      const message = getErrorMessage(error);
      this.connectionStatus = "error";
      this.currentTasks = [];
      this.currentQuota = null;

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
      const sourceSnapshot = await this.readLogSnapshot(occurredAt);
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
        code: "LOG_SOURCE_READ_FAILED",
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

    return this.buildUnavailableQuota(toIso(this.now()));
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

    if ("logFilePath" in config) {
      this.logSource = createLogSourceFromPath(sanitizeConfigPath(config.logFilePath));
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.listeners.clear();
    this.currentTasks = [];
    this.currentQuota = null;
  }

  private async readLogSnapshot(occurredAt: string): Promise<LogSourceSnapshot> {
    if (!this.logSource) {
      return {
        tasks: [],
        quota: this.buildUnavailableQuota(occurredAt),
        connectionStatus: "notFound",
        message: "日志源未配置"
      };
    }

    const rawEvents = await this.logSource.readEvents();

    if (rawEvents === null) {
      return {
        tasks: [],
        quota: this.buildUnavailableQuota(occurredAt),
        connectionStatus: "notRunning",
        message: "日志源暂无状态事件"
      };
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
        taskEvents.set(readRequiredString(rawEvent, "id"), rawEvent);
      } else if (isQuotaEvent) {
        quotaEvent = rawEvent;
      }
    }

    if (taskEvents.size === 0 && quotaEvent === null) {
      return {
        tasks: [],
        quota: this.buildUnavailableQuota(occurredAt),
        connectionStatus: "notRunning",
        message: "日志源暂无状态事件"
      };
    }

    return {
      tasks: Array.from(taskEvents.values()).map((task, index) => this.normalizeLogTask(task, index, occurredAt)),
      quota: this.normalizeLogQuota(quotaEvent, occurredAt),
      connectionStatus: "connected",
      message: "已读取通用日志源"
    };
  }

  private normalizeLogTask(rawTask: unknown, index: number, occurredAt: string): AgentTask {
    if (!isRecord(rawTask)) {
      throw new Error("日志源数据格式无法解析");
    }

    const id = readRequiredString(rawTask, "id");
    const status = readTaskStatus(rawTask);
    const progressType = readProgressType(rawTask);
    const progressValue = progressType === "determinate" ? sanitizePercent(readOptionalNumber(rawTask, "progressValue")) : null;
    const updatedAt = readOptionalIso(rawTask, "updatedAt", occurredAt);
    const startedAt = readOptionalIso(rawTask, "startedAt", updatedAt);

    return {
      id: `log-${id}`,
      providerId: this.provider.id,
      sessionId: readOptionalString(rawTask, "sessionId") ?? id,
      title: readOptionalString(rawTask, "title") ?? "Agent 日志任务",
      projectName: readOptionalString(rawTask, "projectName") ?? "通用 Agent",
      projectPath: readOptionalString(rawTask, "projectPath"),
      status,
      stage: readOptionalString(rawTask, "stage") ?? "日志同步",
      priority: priorityFromTaskStatus(status),
      startedAt,
      updatedAt,
      completedAt: readOptionalNullableIso(rawTask, "completedAt"),
      lastActivityAt: readOptionalIso(rawTask, "lastActivityAt", updatedAt),
      lastActivityText: readOptionalString(rawTask, "lastActivityText") ?? "已读取 Agent 日志源",
      progressType,
      progressValue,
      completedSteps: readOptionalNumber(rawTask, "completedSteps"),
      totalSteps: readOptionalNumber(rawTask, "totalSteps"),
      waitingAction: readWaitingAction(rawTask.waitingAction),
      errorCode: readOptionalString(rawTask, "errorCode"),
      errorMessage: readOptionalString(rawTask, "errorMessage"),
      sourceId: readOptionalString(rawTask, "sourceId") ?? `log-${index}`
    };
  }

  private normalizeLogQuota(rawQuota: unknown, occurredAt: string): QuotaSnapshot {
    const fallback = this.buildUnavailableQuota(occurredAt);

    if (rawQuota === undefined || rawQuota === null) {
      return fallback;
    }

    if (!isRecord(rawQuota)) {
      throw new Error("日志源数据格式无法解析");
    }

    return {
      id: readOptionalString(rawQuota, "id") ?? "log-quota",
      providerId: this.provider.id,
      total: readOptionalNumber(rawQuota, "total"),
      used: readOptionalNumber(rawQuota, "used"),
      remaining: readOptionalNumber(rawQuota, "remaining"),
      remainingPercent: sanitizePercent(readOptionalNumber(rawQuota, "remainingPercent")),
      resetAt: readOptionalNullableIso(rawQuota, "resetAt"),
      capturedAt: readOptionalIso(rawQuota, "capturedAt", occurredAt),
      expiresAt: readOptionalIso(rawQuota, "expiresAt", toIso(new Date(this.now().getTime() + 5 * 60 * 1000))),
      isEstimated: rawQuota.isEstimated === true,
      source: readOptionalString(rawQuota, "source") ?? "log",
      errorMessage: readOptionalString(rawQuota, "errorMessage")
    };
  }

  private buildUnavailableQuota(capturedAt: string): QuotaSnapshot {
    return {
      id: "log-quota-unavailable",
      providerId: this.provider.id,
      total: null,
      used: null,
      remaining: null,
      remainingPercent: null,
      resetAt: null,
      capturedAt,
      expiresAt: toIso(new Date(this.now().getTime() + 5 * 60 * 1000)),
      isEstimated: false,
      source: "log",
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
