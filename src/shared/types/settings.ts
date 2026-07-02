import type { IslandMode, IslandPosition } from "./window";

export interface IslandCustomPosition {
  displayId: string | null;
  x: number;
  y: number;
}

export interface DisplaySettings {
  islandEnabled: boolean;
  islandMode: IslandMode;
  islandPosition: IslandPosition;
  islandCustomPosition: IslandCustomPosition | null;
  targetDisplayId: string | null;
  followActiveDisplay: boolean;
  autoCollapseDelay: number;
  alwaysOnTop: boolean;
  mouseThrough: boolean;
  hideInFullscreen: boolean;
  trayEnabled: boolean;
  taskbarPopupEnabled: boolean;
  showQuota: boolean;
  showTaskName: boolean;
  showDuration: boolean;
  opacity: number;
}

export interface NotificationSettings {
  enabled: boolean;
  doNotDisturb: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quotaWarningPercent: number;
  staleMinutes: number;
}

export interface CodexProviderSettings {
  enabled: boolean;
  statusFilePath: string | null;
  logFilePath: string | null;
}

export interface ProcessProviderSettings {
  enabled: boolean;
}

export interface LogProviderSettings {
  enabled: boolean;
  logFilePath: string | null;
}

export interface MockProviderSettings {
  enabled: boolean;
}

export interface CustomCommandProviderSettings {
  enabled: boolean;
  authorized: boolean;
  commandPath: string | null;
  args: string[];
  workingDirectory: string | null;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface ProviderSettings {
  codex: CodexProviderSettings;
  process: ProcessProviderSettings;
  log: LogProviderSettings;
  mock: MockProviderSettings;
  customCommand: CustomCommandProviderSettings;
}

export interface AppSettings {
  display: DisplaySettings;
  notifications: NotificationSettings;
  providers: ProviderSettings;
  paused: boolean;
}

export interface AppSettingsPatch {
  display?: Partial<DisplaySettings>;
  notifications?: Partial<NotificationSettings>;
  providers?: {
    codex?: Partial<CodexProviderSettings>;
    process?: Partial<ProcessProviderSettings>;
    log?: Partial<LogProviderSettings>;
    mock?: Partial<MockProviderSettings>;
    customCommand?: Partial<CustomCommandProviderSettings>;
  };
  paused?: boolean;
}

export const defaultDisplaySettings: DisplaySettings = {
  islandEnabled: true,
  islandMode: "collapsed",
  islandPosition: "topCenter",
  islandCustomPosition: null,
  targetDisplayId: null,
  followActiveDisplay: true,
  autoCollapseDelay: 5000,
  alwaysOnTop: true,
  mouseThrough: true,
  hideInFullscreen: true,
  trayEnabled: true,
  taskbarPopupEnabled: true,
  showQuota: true,
  showTaskName: true,
  showDuration: true,
  opacity: 0.94
};

export const defaultAppSettings: AppSettings = {
  display: defaultDisplaySettings,
  notifications: {
    enabled: true,
    doNotDisturb: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    quotaWarningPercent: 20,
    staleMinutes: 10
  },
  providers: {
    codex: {
      enabled: true,
      statusFilePath: null,
      logFilePath: null
    },
    process: {
      enabled: true
    },
    log: {
      enabled: false,
      logFilePath: null
    },
    mock: {
      enabled: true
    },
    customCommand: {
      enabled: false,
      authorized: false,
      commandPath: null,
      args: [],
      workingDirectory: null,
      timeoutMs: 5000,
      outputLimitBytes: 262144
    }
  },
  paused: false
};
