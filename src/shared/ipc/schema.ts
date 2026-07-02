import type { AdapterDetectionResult } from "../types/adapter";
import type { AgentActivity, AgentProvider, AgentStateSnapshot, AgentTask } from "../types/agent";
import type { AppSettings, AppSettingsPatch } from "../types/settings";
import type { IslandMode, DisplayLike } from "../types/window";

export interface IpcResult<T> {
  ok: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
}

export interface CodePulseInvokeMap {
  "codepulse:state:getSnapshot": {
    args: [];
    result: AgentStateSnapshot;
  };
  "codepulse:state:refresh": {
    args: [providerId?: string];
    result: AgentStateSnapshot;
  };
  "codepulse:tasks:open": {
    args: [taskId: string];
    result: boolean;
  };
  "codepulse:tasks:openAgent": {
    args: [taskId: string];
    result: boolean;
  };
  "codepulse:tasks:copySummary": {
    args: [taskId: string];
    result: string;
  };
  "codepulse:tasks:listHistory": {
    args: [limit?: number];
    result: AgentTask[];
  };
  "codepulse:tasks:getHistoryActivities": {
    args: [taskId: string, limit?: number];
    result: AgentActivity[];
  };
  "codepulse:tasks:snooze": {
    args: [taskId: string, until: string];
    result: boolean;
  };
  "codepulse:tasks:markViewed": {
    args: [taskId: string];
    result: boolean;
  };
  "codepulse:providers:list": {
    args: [];
    result: AgentProvider[];
  };
  "codepulse:providers:detect": {
    args: [];
    result: AdapterDetectionResult[];
  };
  "codepulse:providers:setEnabled": {
    args: [providerId: string, enabled: boolean];
    result: boolean;
  };
  "codepulse:settings:get": {
    args: [];
    result: AppSettings;
  };
  "codepulse:settings:update": {
    args: [partialSettings: AppSettingsPatch];
    result: AppSettings;
  };
  "codepulse:windows:openTaskCenter": {
    args: [taskId?: string];
    result: boolean;
  };
  "codepulse:windows:openSettings": {
    args: [];
    result: boolean;
  };
  "codepulse:windows:setIslandMode": {
    args: [mode: IslandMode];
    result: boolean;
  };
  "codepulse:windows:closePopup": {
    args: [];
    result: boolean;
  };
  "codepulse:system:getDisplays": {
    args: [];
    result: DisplayLike[];
  };
  "codepulse:system:getConnectionStatus": {
    args: [];
    result: string;
  };
  "codepulse:diagnostics:exportRedacted": {
    args: [];
    result: string;
  };
}

export const toIpcSuccess = <T>(data: T): IpcResult<T> => ({
  ok: true,
  data,
  error: null
});

export const toIpcFailure = <T>(code: string, message: string): IpcResult<T> => ({
  ok: false,
  data: null,
  error: {
    code,
    message
  }
});

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
