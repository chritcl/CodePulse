import { ipcRenderer } from "electron";
import { codePulseChannels } from "../shared/ipc/channels";
import type { IpcResult } from "../shared/ipc/schema";
import type { AdapterDetectionResult } from "../shared/types/adapter";
import type { AgentActivity, AgentProvider, AgentStateSnapshot, AgentTask } from "../shared/types/agent";
import type { AppSettings, AppSettingsPatch } from "../shared/types/settings";
import type { DisplayLike, IslandMode } from "../shared/types/window";

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;

  if (!result.ok || result.error) {
    throw new Error(result.error?.message ?? "IPC 调用失败");
  }

  return result.data as T;
};

const isFreezable = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const deepFreeze = <T extends object>(value: T): Readonly<T> => {
  for (const nestedValue of Object.values(value)) {
    if (isFreezable(nestedValue) && !Object.isFrozen(nestedValue)) {
      deepFreeze(nestedValue);
    }
  }

  return Object.freeze(value);
};

export const codePulseApi = deepFreeze({
  state: {
    getSnapshot: () => invoke<AgentStateSnapshot>(codePulseChannels.stateGetSnapshot),
    refresh: (providerId?: string) => invoke<AgentStateSnapshot>(codePulseChannels.stateRefresh, providerId),
    subscribe: (listener: (snapshot: AgentStateSnapshot) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: AgentStateSnapshot): void => {
        listener(snapshot);
      };

      ipcRenderer.on(codePulseChannels.stateChanged, handler);

      return () => {
        ipcRenderer.removeListener(codePulseChannels.stateChanged, handler);
      };
    }
  },
  tasks: {
    open: (taskId: string) => invoke<boolean>(codePulseChannels.tasksOpen, taskId),
    openAgent: (taskId: string) => invoke<boolean>(codePulseChannels.tasksOpenAgent, taskId),
    copySummary: (taskId: string) => invoke<string>(codePulseChannels.tasksCopySummary, taskId),
    listHistory: (limit?: number) => invoke<AgentTask[]>(codePulseChannels.tasksListHistory, limit),
    getHistoryActivities: (taskId: string, limit?: number) =>
      invoke<AgentActivity[]>(codePulseChannels.tasksGetHistoryActivities, taskId, limit),
    snooze: (taskId: string, until: string) => invoke<boolean>(codePulseChannels.tasksSnooze, taskId, until),
    markViewed: (taskId: string) => invoke<boolean>(codePulseChannels.tasksMarkViewed, taskId)
  },
  providers: {
    list: () => invoke<AgentProvider[]>(codePulseChannels.providersList),
    detect: () => invoke<AdapterDetectionResult[]>(codePulseChannels.providersDetect),
    setEnabled: (providerId: string, enabled: boolean) =>
      invoke<boolean>(codePulseChannels.providersSetEnabled, providerId, enabled)
  },
  settings: {
    get: () => invoke<AppSettings>(codePulseChannels.settingsGet),
    update: (partialSettings: AppSettingsPatch) => invoke<AppSettings>(codePulseChannels.settingsUpdate, partialSettings)
  },
  windows: {
    openTaskCenter: (taskId?: string) => invoke<boolean>(codePulseChannels.windowsOpenTaskCenter, taskId),
    openSettings: () => invoke<boolean>(codePulseChannels.windowsOpenSettings),
    setIslandMode: (mode: IslandMode) => invoke<boolean>(codePulseChannels.windowsSetIslandMode, mode),
    closePopup: () => invoke<boolean>(codePulseChannels.windowsClosePopup)
  },
  system: {
    getDisplays: () => invoke<DisplayLike[]>(codePulseChannels.systemGetDisplays),
    getConnectionStatus: () => invoke<string>(codePulseChannels.systemGetConnectionStatus)
  },
  diagnostics: {
    exportRedacted: () => invoke<string>(codePulseChannels.diagnosticsExportRedacted)
  }
});

export type CodePulseApi = typeof codePulseApi;
