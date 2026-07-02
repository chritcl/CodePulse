import { spawn } from "node:child_process";
import { BrowserWindow, clipboard, ipcMain, shell } from "electron";
import { codePulseChannels } from "../../shared/ipc/channels";
import { toIpcFailure, toIpcSuccess } from "../../shared/ipc/schema";
import type { AgentActivity, AgentProvider, AgentTask } from "../../shared/types/agent";
import type { AppSettingsPatch } from "../../shared/types/settings";
import type { IslandMode } from "../../shared/types/window";
import type { NotificationManager } from "../notifications/NotificationManager";
import type { SettingsStore } from "../persistence/settingsStore";
import { getDisplays } from "../system/displays";
import type { AgentStateHub } from "../state/AgentStateHub";
import type { WindowManager } from "../windows/windowManager";
import { redactDiagnosticText } from "./redaction";
import {
  readHistoryLimit,
  readIslandMode,
  readOptionalProviderId,
  readOptionalTaskId,
  readPartialSettings,
  readProviderEnabled,
  readSnoozeUntil,
  readTaskId,
  toIpcError
} from "./validation";

export interface HistoryReader {
  getRecentTasks(limit?: number): AgentTask[];
  getTaskActivities(taskId: string, limit?: number): AgentActivity[];
  getRuntimeStatus?(): unknown;
}

const sendSnapshotToWindows = (snapshot: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(codePulseChannels.stateChanged, snapshot);
    }
  }
};

const wrap = async <T>(handler: () => Promise<T> | T) => {
  try {
    return toIpcSuccess(await handler());
  } catch (error) {
    const { code, message } = toIpcError(error);
    return toIpcFailure<T>(code, message);
  }
};

const statusLabels: Record<AgentTask["status"], string> = {
  idle: "空闲",
  detecting: "检测中",
  analyzing: "分析中",
  planning: "规划中",
  executing: "运行中",
  testing: "测试中",
  waiting: "等待确认",
  completed: "已完成",
  failed: "失败",
  disconnected: "已断开",
  stale: "数据过期",
  unknown: "未知"
};

const buildTaskSummary = (task: AgentTask, provider?: AgentProvider): string =>
  [
    `任务：${task.title}`,
    `Agent：${provider?.name ?? task.providerId}`,
    `项目：${task.projectName}`,
    `状态：${statusLabels[task.status]}`,
    `阶段：${task.stage}`,
    `最近活动：${task.lastActivityText}`,
    task.waitingAction ? `等待处理：${task.waitingAction.description}` : null,
    task.errorMessage ? `错误：${task.errorMessage}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

const findTaskOrThrow = (tasks: AgentTask[], taskId: string): AgentTask => {
  const task = tasks.find((item) => item.id === taskId);

  if (!task) {
    throw new Error("任务不存在");
  }

  return task;
};

const findTaskFromSnapshotOrHistory = (tasks: AgentTask[], taskId: string, historyStore?: HistoryReader): AgentTask => {
  const task = tasks.find((item) => item.id === taskId);

  if (task) {
    return task;
  }

  const historyTask = historyStore?.getRecentTasks(500).find((item) => item.id === taskId);

  if (!historyTask) {
    throw new Error("任务不存在");
  }

  return historyTask;
};

type AgentOpenStrategy = "codexCli" | "projectDirectory";

const resolveAgentOpenStrategy = (task: AgentTask, providers: AgentProvider[]): AgentOpenStrategy => {
  const provider = providers.find((item) => item.id === task.providerId);

  if (provider?.adapterType === "codex" || task.providerId === "codex") {
    return "codexCli";
  }

  if (provider) {
    return "projectDirectory";
  }

  throw new Error("该任务暂不支持打开 Agent");
};

const buildProviderEnabledPatch = (providerId: string, enabled: boolean): AppSettingsPatch => {
  if (providerId === "codex") {
    return {
      providers: {
        codex: {
          enabled
        }
      }
    };
  }

  if (providerId === "process") {
    return {
      providers: {
        process: {
          enabled
        }
      }
    };
  }

  if (providerId === "log") {
    return {
      providers: {
        log: {
          enabled
        }
      }
    };
  }

  if (providerId === "custom-command") {
    return {
      providers: {
        customCommand: {
          enabled
        }
      }
    };
  }

  if (providerId === "mock-codex") {
    return {
      providers: {
        mock: {
          enabled
        }
      }
    };
  }

  throw new Error("数据源 ID 无效");
};

const applyProviderEnabledSettings = async (hub: AgentStateHub, settings: AppSettingsPatch): Promise<void> => {
  const providers = settings.providers;

  if (!providers) {
    return;
  }

  const updates: Array<[string, boolean]> = [];

  if (typeof providers.codex?.enabled === "boolean") {
    updates.push(["codex", providers.codex.enabled]);
  }

  if (typeof providers.process?.enabled === "boolean") {
    updates.push(["process", providers.process.enabled]);
  }

  if (typeof providers.log?.enabled === "boolean") {
    updates.push(["log", providers.log.enabled]);
  }

  if (typeof providers.customCommand?.enabled === "boolean") {
    updates.push(["custom-command", providers.customCommand.enabled]);
  }

  if (typeof providers.mock?.enabled === "boolean") {
    updates.push(["mock-codex", providers.mock.enabled]);
  }

  for (const [providerId, enabled] of updates) {
    await hub.setProviderEnabled(providerId, enabled);
  }
};

const applyProviderRuntimeSettings = async (hub: AgentStateHub, settings: AppSettingsPatch): Promise<void> => {
  const codexSettings = settings.providers?.codex;
  const logSettings = settings.providers?.log;
  const customCommandSettings = settings.providers?.customCommand;

  if (codexSettings) {
    await hub.updateProviderRuntimeConfig("codex", codexSettings);
  }

  if (logSettings) {
    await hub.updateProviderRuntimeConfig("log", logSettings);
  }

  if (customCommandSettings) {
    await hub.updateProviderRuntimeConfig("custom-command", customCommandSettings);
  }
};

const openCodexAgent = (task: AgentTask): void => {
  if (process.platform !== "win32") {
    throw new Error("当前系统暂不支持打开 Agent");
  }

  if (!task.projectPath?.trim()) {
    throw new Error("Agent 启动目录暂不可用");
  }

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NoExit", "-Command", "Set-Location -LiteralPath $args[0]; codex", task.projectPath],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }
  );
  child.unref();
};

const openTaskProjectDirectory = async (task: AgentTask): Promise<void> => {
  if (!task.projectPath?.trim()) {
    throw new Error("任务项目目录暂不可用");
  }

  const openError = await shell.openPath(task.projectPath);

  if (openError) {
    throw new Error(`项目目录打开失败：${openError}`);
  }
};

const openAgentProjectDirectory = async (task: AgentTask): Promise<void> => {
  if (!task.projectPath?.trim()) {
    throw new Error("Agent 项目目录暂不可用");
  }

  const openError = await shell.openPath(task.projectPath);

  if (openError) {
    throw new Error(`Agent 项目目录打开失败：${openError}`);
  }
};

export const registerIpc = (
  hub: AgentStateHub,
  settingsStore: SettingsStore,
  windows: WindowManager,
  notifications?: NotificationManager,
  historyStore?: HistoryReader
): (() => void) => {
  const unsubscribeHub = hub.subscribe((snapshot) => {
    sendSnapshotToWindows(snapshot);
  });

  ipcMain.handle(codePulseChannels.stateGetSnapshot, () => wrap(() => hub.getSnapshot()));
  ipcMain.handle(codePulseChannels.stateRefresh, (_event, providerId?: string) =>
    wrap(() => hub.refresh(readOptionalProviderId(providerId)))
  );
  ipcMain.handle(codePulseChannels.tasksOpen, (_event, taskId: string) =>
    wrap(async () => {
      const task = findTaskFromSnapshotOrHistory(hub.getSnapshot().tasks, readTaskId(taskId), historyStore);

      await openTaskProjectDirectory(task);
      return true;
    })
  );
  ipcMain.handle(codePulseChannels.tasksOpenAgent, (_event, taskId: string) =>
    wrap(async () => {
      const snapshot = hub.getSnapshot();
      const task = findTaskFromSnapshotOrHistory(snapshot.tasks, readTaskId(taskId), historyStore);
      const strategy = resolveAgentOpenStrategy(task, snapshot.providers);

      if (strategy === "codexCli") {
        openCodexAgent(task);
        return true;
      }

      await openAgentProjectDirectory(task);
      return true;
    })
  );
  ipcMain.handle(codePulseChannels.tasksCopySummary, (_event, taskId: string) =>
    wrap(() => {
      const normalizedTaskId = readTaskId(taskId);
      const snapshot = hub.getSnapshot();
      const task = findTaskFromSnapshotOrHistory(snapshot.tasks, normalizedTaskId, historyStore);
      const provider = snapshot.providers.find((item) => item.id === task.providerId);
      const summary = buildTaskSummary(task, provider);
      clipboard.writeText(summary);
      return summary;
    })
  );
  ipcMain.handle(codePulseChannels.tasksListHistory, (_event, limit?: number) =>
    wrap(() => {
      if (!historyStore) {
        throw new Error("历史记录暂不可用");
      }

      return historyStore.getRecentTasks(readHistoryLimit(limit));
    })
  );
  ipcMain.handle(codePulseChannels.tasksGetHistoryActivities, (_event, taskId: string, limit?: number) =>
    wrap(() => {
      if (!historyStore) {
        throw new Error("历史记录暂不可用");
      }

      return historyStore.getTaskActivities(readTaskId(taskId), readHistoryLimit(limit));
    })
  );
  ipcMain.handle(codePulseChannels.tasksSnooze, (_event, taskId: string, until: string) =>
    wrap(() => {
      const normalizedTaskId = readTaskId(taskId);
      findTaskOrThrow(hub.getSnapshot().tasks, normalizedTaskId);
      notifications?.snooze(normalizedTaskId, readSnoozeUntil(until));
      return true;
    })
  );
  ipcMain.handle(codePulseChannels.tasksMarkViewed, (_event, taskId: string) =>
    wrap(() => {
      findTaskOrThrow(hub.getSnapshot().tasks, readTaskId(taskId));
      return true;
    })
  );
  ipcMain.handle(codePulseChannels.providersList, () => wrap(() => hub.getProviders()));
  ipcMain.handle(codePulseChannels.providersDetect, () => wrap(() => hub.detectProviders()));
  ipcMain.handle(codePulseChannels.providersSetEnabled, (_event, providerId: string, enabled: boolean) =>
    wrap(async () => {
      const normalized = readProviderEnabled(providerId, enabled);
      await hub.setProviderEnabled(normalized.providerId, normalized.enabled);
      const settings = await settingsStore.update(buildProviderEnabledPatch(normalized.providerId, normalized.enabled));
      windows.updateSettings(settings);
      notifications?.updateSettings(settings);
      return true;
    })
  );
  ipcMain.handle(codePulseChannels.settingsGet, () => wrap(() => settingsStore.get()));
  ipcMain.handle(codePulseChannels.settingsUpdate, (_event, partialSettings: AppSettingsPatch) =>
    wrap(async () => {
      const normalizedSettings = readPartialSettings(partialSettings);
      await applyProviderEnabledSettings(hub, normalizedSettings);
      await applyProviderRuntimeSettings(hub, normalizedSettings);
      const settings = await settingsStore.update(normalizedSettings);
      windows.updateSettings(settings);
      notifications?.updateSettings(settings);
      return settings;
    })
  );
  ipcMain.handle(codePulseChannels.windowsOpenTaskCenter, (_event, taskId?: string) =>
    wrap(async () => {
      await windows.openTaskCenter(readOptionalTaskId(taskId));
      return true;
    })
  );
  ipcMain.handle(codePulseChannels.windowsOpenSettings, () =>
    wrap(async () => {
      await windows.openSettings();
      return true;
    })
  );
  ipcMain.handle(codePulseChannels.windowsSetIslandMode, (_event, mode: IslandMode) =>
    wrap(() => {
      windows.setIslandMode(readIslandMode(mode));
      return true;
    })
  );
  ipcMain.handle(codePulseChannels.windowsClosePopup, () =>
    wrap(() => {
      windows.closePopup();
      return true;
    })
  );
  ipcMain.handle(codePulseChannels.systemGetDisplays, () => wrap(() => getDisplays()));
  ipcMain.handle(codePulseChannels.systemGetConnectionStatus, () => wrap(() => hub.getSnapshot().summary.label));
  ipcMain.handle(codePulseChannels.diagnosticsExportRedacted, () =>
    wrap(() =>
      redactDiagnosticText(
        JSON.stringify(
          {
            snapshot: hub.getSnapshot(),
            notifications: notifications?.getRuntimeStatus() ?? null,
            history: historyStore?.getRuntimeStatus?.() ?? null
          },
          null,
          2
        )
      )
    )
  );

  return () => {
    unsubscribeHub();
    for (const channel of Object.values(codePulseChannels)) {
      ipcMain.removeHandler(channel);
    }
  };
};
