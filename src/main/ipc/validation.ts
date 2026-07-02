import { isRecord } from "../../shared/ipc/schema";
import type {
  AppSettings,
  AppSettingsPatch,
  CodexProviderSettings,
  CustomCommandProviderSettings,
  DisplaySettings,
  LogProviderSettings,
  MockProviderSettings,
  NotificationSettings,
  ProcessProviderSettings,
  ProviderSettings
} from "../../shared/types/settings";
import type { IslandMode, IslandPosition } from "../../shared/types/window";

export class IpcValidationError extends Error {
  readonly code = "IPC_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "IpcValidationError";
  }
}

export interface IpcErrorPayload {
  code: string;
  message: string;
}

const islandModes = new Set<IslandMode>(["hidden", "collapsed", "normal", "expanded", "persistent", "dragging"]);
const islandPositions = new Set<IslandPosition>(["topCenter", "topLeft", "topRight", "right", "free"]);
const providerIds = new Set(["codex", "process", "log", "custom-command", "mock-codex"]);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const toIpcError = (error: unknown): IpcErrorPayload => {
  if (error instanceof IpcValidationError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  return {
    code: "IPC_ERROR",
    message: error instanceof Error ? error.message : "未知错误"
  };
};

const readNonEmptyString = (value: unknown, message: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new IpcValidationError(message);
  }

  return value.trim();
};

const readOptionalNonEmptyString = (value: unknown, message: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return readNonEmptyString(value, message);
};

const readNullableNonEmptyString = (value: unknown, message: string): string | null => {
  if (value === null) {
    return null;
  }

  return readNonEmptyString(value, message);
};

const readBoolean = (value: unknown, message: string): boolean => {
  if (typeof value !== "boolean") {
    throw new IpcValidationError(message);
  }

  return value;
};

const readNumberInRange = (value: unknown, min: number, max: number, message: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new IpcValidationError(message);
  }

  return value;
};

const assertKnownKeys = (record: Record<string, unknown>, keys: Set<string>, message: string): void => {
  for (const key of Object.keys(record)) {
    if (!keys.has(key)) {
      throw new IpcValidationError(message);
    }
  }
};

export const readTaskId = (value: unknown): string => readNonEmptyString(value, "任务 ID 无效");

export const readOptionalTaskId = (value: unknown): string | undefined => readOptionalNonEmptyString(value, "任务 ID 无效");

export const readOptionalProviderId = (value: unknown): string | undefined =>
  readOptionalNonEmptyString(value, "数据源 ID 无效");

export const readHistoryLimit = (value: unknown): number => {
  if (value === undefined || value === null) {
    return 100;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 500) {
    throw new IpcValidationError("历史记录数量无效");
  }

  return value;
};

export const readIslandMode = (value: unknown): IslandMode => {
  if (typeof value !== "string" || !islandModes.has(value as IslandMode)) {
    throw new IpcValidationError("动态岛模式无效");
  }

  return value as IslandMode;
};

export const readSnoozeUntil = (value: unknown): string => {
  const until = readNonEmptyString(value, "稍后提醒时间无效");

  if (!Number.isFinite(new Date(until).getTime())) {
    throw new IpcValidationError("稍后提醒时间无效");
  }

  return until;
};

export const readProviderEnabled = (providerId: unknown, enabled: unknown): { providerId: string; enabled: boolean } => {
  const normalizedProviderId = readNonEmptyString(providerId, "数据源 ID 无效");

  if (!providerIds.has(normalizedProviderId)) {
    throw new IpcValidationError("数据源 ID 无效");
  }

  return {
    providerId: normalizedProviderId,
    enabled: readBoolean(enabled, "启用状态无效")
  };
};

const displaySettingKeys = new Set<keyof DisplaySettings>([
  "islandEnabled",
  "islandMode",
  "islandPosition",
  "islandCustomPosition",
  "targetDisplayId",
  "followActiveDisplay",
  "autoCollapseDelay",
  "alwaysOnTop",
  "mouseThrough",
  "hideInFullscreen",
  "trayEnabled",
  "taskbarPopupEnabled",
  "showQuota",
  "showTaskName",
  "showDuration",
  "opacity"
]);

const notificationSettingKeys = new Set<keyof NotificationSettings>([
  "enabled",
  "doNotDisturb",
  "quietHoursStart",
  "quietHoursEnd",
  "quotaWarningPercent",
  "staleMinutes"
]);

const codexProviderSettingKeys = new Set<keyof CodexProviderSettings>(["enabled", "statusFilePath", "logFilePath"]);
const processProviderSettingKeys = new Set<keyof ProcessProviderSettings>(["enabled"]);
const logProviderSettingKeys = new Set<keyof LogProviderSettings>(["enabled", "logFilePath"]);
const mockProviderSettingKeys = new Set<keyof MockProviderSettings>(["enabled"]);
const customCommandProviderSettingKeys = new Set<keyof CustomCommandProviderSettings>([
  "enabled",
  "authorized",
  "commandPath",
  "args",
  "workingDirectory",
  "timeoutMs",
  "outputLimitBytes"
]);
const providerSettingKeys = new Set<keyof ProviderSettings>(["codex", "process", "log", "mock", "customCommand"]);
const settingKeys = new Set<keyof AppSettings>(["display", "notifications", "providers", "paused"]);
type ProviderSettingsPatch = NonNullable<AppSettingsPatch["providers"]>;

const readIslandPosition = (value: unknown): IslandPosition => {
  if (typeof value !== "string" || !islandPositions.has(value as IslandPosition)) {
    throw new IpcValidationError("动态岛位置无效");
  }

  return value as IslandPosition;
};

const readIslandCustomPosition = (value: unknown): DisplaySettings["islandCustomPosition"] => {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new IpcValidationError("动态岛自定义位置无效");
  }

  assertKnownKeys(value, new Set(["displayId", "x", "y"]), "动态岛自定义位置字段无效");

  if (!("x" in value) || !("y" in value)) {
    throw new IpcValidationError("动态岛自定义位置无效");
  }

  return {
    displayId:
      "displayId" in value ? readNullableNonEmptyString(value.displayId, "动态岛自定义位置无效") : null,
    x: readNumberInRange(value.x, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "动态岛自定义位置无效"),
    y: readNumberInRange(value.y, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "动态岛自定义位置无效")
  };
};

const readQuietHour = (value: unknown): string | null => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !timePattern.test(value)) {
    throw new IpcValidationError("勿扰时间格式无效");
  }

  return value;
};

const readDisplaySettings = (value: unknown): Partial<DisplaySettings> => {
  if (!isRecord(value)) {
    throw new IpcValidationError("显示设置无效");
  }

  assertKnownKeys(value, displaySettingKeys, "显示设置字段无效");
  const settings: Partial<DisplaySettings> = {};

  for (const [key, item] of Object.entries(value)) {
    if (key === "islandMode") {
      settings.islandMode = readIslandMode(item);
    } else if (key === "islandPosition") {
      settings.islandPosition = readIslandPosition(item);
    } else if (key === "islandCustomPosition") {
      settings.islandCustomPosition = readIslandCustomPosition(item);
    } else if (key === "targetDisplayId") {
      settings.targetDisplayId = readNullableNonEmptyString(item, "显示器 ID 无效");
    } else if (key === "autoCollapseDelay") {
      settings.autoCollapseDelay = readNumberInRange(item, 0, 300_000, "自动收起时间无效");
    } else if (key === "opacity") {
      settings.opacity = readNumberInRange(item, 0, 1, "透明度必须在 0 到 1 之间");
    } else {
      settings[
        key as keyof Omit<
          DisplaySettings,
          "islandMode" | "islandPosition" | "islandCustomPosition" | "targetDisplayId" | "autoCollapseDelay" | "opacity"
        >
      ] = readBoolean(item, "显示设置布尔值无效");
    }
  }

  return settings;
};

const readNotificationSettings = (value: unknown): Partial<NotificationSettings> => {
  if (!isRecord(value)) {
    throw new IpcValidationError("通知设置无效");
  }

  assertKnownKeys(value, notificationSettingKeys, "通知设置字段无效");
  const settings: Partial<NotificationSettings> = {};

  for (const [key, item] of Object.entries(value)) {
    if (key === "quietHoursStart" || key === "quietHoursEnd") {
      settings[key] = readQuietHour(item);
    } else if (key === "quotaWarningPercent") {
      settings.quotaWarningPercent = readNumberInRange(item, 1, 100, "额度提醒阈值无效");
    } else if (key === "staleMinutes") {
      settings.staleMinutes = readNumberInRange(item, 1, 1440, "过期时间无效");
    } else {
      settings[key as keyof Omit<NotificationSettings, "quietHoursStart" | "quietHoursEnd" | "quotaWarningPercent" | "staleMinutes">] =
        readBoolean(item, "通知设置布尔值无效");
    }
  }

  return settings;
};

const readCodexProviderSettings = (value: unknown): Partial<CodexProviderSettings> => {
  if (!isRecord(value)) {
    throw new IpcValidationError("Codex 数据源设置无效");
  }

  assertKnownKeys(value, codexProviderSettingKeys, "Codex 数据源设置字段无效");
  const settings: Partial<CodexProviderSettings> = {};

  if ("enabled" in value) {
    settings.enabled = readBoolean(value.enabled, "Codex 数据源启用状态无效");
  }

  if ("statusFilePath" in value) {
    settings.statusFilePath = readNullableNonEmptyString(value.statusFilePath, "Codex 状态源路径无效");
  }

  if ("logFilePath" in value) {
    settings.logFilePath = readNullableNonEmptyString(value.logFilePath, "Codex 日志源路径无效");
  }

  return settings;
};

const readProcessProviderSettings = (value: unknown): Partial<ProcessProviderSettings> => {
  if (!isRecord(value)) {
    throw new IpcValidationError("本机进程数据源设置无效");
  }

  assertKnownKeys(value, processProviderSettingKeys, "本机进程数据源设置字段无效");
  const settings: Partial<ProcessProviderSettings> = {};

  if ("enabled" in value) {
    settings.enabled = readBoolean(value.enabled, "本机进程数据源启用状态无效");
  }

  return settings;
};

const readLogProviderSettings = (value: unknown): Partial<LogProviderSettings> => {
  if (!isRecord(value)) {
    throw new IpcValidationError("通用日志数据源设置无效");
  }

  assertKnownKeys(value, logProviderSettingKeys, "通用日志数据源设置字段无效");
  const settings: Partial<LogProviderSettings> = {};

  if ("enabled" in value) {
    settings.enabled = readBoolean(value.enabled, "通用日志数据源启用状态无效");
  }

  if ("logFilePath" in value) {
    settings.logFilePath = readNullableNonEmptyString(value.logFilePath, "通用日志源路径无效");
  }

  return settings;
};

const readMockProviderSettings = (value: unknown): Partial<MockProviderSettings> => {
  if (!isRecord(value)) {
    throw new IpcValidationError("模拟数据源设置无效");
  }

  assertKnownKeys(value, mockProviderSettingKeys, "模拟数据源设置字段无效");
  const settings: Partial<MockProviderSettings> = {};

  if ("enabled" in value) {
    settings.enabled = readBoolean(value.enabled, "模拟数据源启用状态无效");
  }

  return settings;
};

const readCustomCommandArgs = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 20) {
    throw new IpcValidationError("自定义命令参数无效");
  }

  return value.map((item) => readNonEmptyString(item, "自定义命令参数无效"));
};

const readCustomCommandProviderSettings = (value: unknown): Partial<CustomCommandProviderSettings> => {
  if (!isRecord(value)) {
    throw new IpcValidationError("自定义命令数据源设置无效");
  }

  assertKnownKeys(value, customCommandProviderSettingKeys, "自定义命令数据源设置字段无效");
  const settings: Partial<CustomCommandProviderSettings> = {};

  if ("enabled" in value) {
    settings.enabled = readBoolean(value.enabled, "自定义命令启用状态无效");
  }

  if ("authorized" in value) {
    settings.authorized = readBoolean(value.authorized, "自定义命令授权状态无效");
  }

  if ("commandPath" in value) {
    settings.commandPath = readNullableNonEmptyString(value.commandPath, "自定义命令路径无效");
  }

  if ("args" in value) {
    settings.args = readCustomCommandArgs(value.args);
  }

  if ("workingDirectory" in value) {
    settings.workingDirectory = readNullableNonEmptyString(value.workingDirectory, "自定义命令工作目录无效");
  }

  if ("timeoutMs" in value) {
    settings.timeoutMs = readNumberInRange(value.timeoutMs, 1000, 60_000, "自定义命令超时时间无效");
  }

  if ("outputLimitBytes" in value) {
    settings.outputLimitBytes = readNumberInRange(value.outputLimitBytes, 1024, 1024 * 1024, "自定义命令输出限制无效");
  }

  return settings;
};

const readProviderSettings = (value: unknown): ProviderSettingsPatch => {
  if (!isRecord(value)) {
    throw new IpcValidationError("数据源设置无效");
  }

  assertKnownKeys(value, providerSettingKeys, "数据源设置字段无效");
  const providers: ProviderSettingsPatch = {};

  if ("codex" in value) {
    providers.codex = readCodexProviderSettings(value.codex);
  }

  if ("process" in value) {
    providers.process = readProcessProviderSettings(value.process);
  }

  if ("log" in value) {
    providers.log = readLogProviderSettings(value.log);
  }

  if ("mock" in value) {
    providers.mock = readMockProviderSettings(value.mock);
  }

  if ("customCommand" in value) {
    providers.customCommand = readCustomCommandProviderSettings(value.customCommand);
  }

  return providers;
};

export const readPartialSettings = (value: unknown): AppSettingsPatch => {
  if (!isRecord(value)) {
    throw new IpcValidationError("设置参数无效");
  }

  assertKnownKeys(value, settingKeys, "设置字段无效");
  const settings: AppSettingsPatch = {};

  if ("display" in value) {
    settings.display = readDisplaySettings(value.display);
  }

  if ("notifications" in value) {
    settings.notifications = readNotificationSettings(value.notifications);
  }

  if ("providers" in value) {
    settings.providers = readProviderSettings(value.providers);
  }

  if ("paused" in value) {
    settings.paused = readBoolean(value.paused, "暂停状态无效");
  }

  return settings;
};
