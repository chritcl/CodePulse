/** 灵动岛设置 */
export interface IslandSettings {
  enabled: boolean;
  theme: 'black' | 'white';
  opacity: number;
  pinToTaskbar: boolean;
  positionLocked: boolean;
  glowBorder: boolean;
  silentMode: boolean;
  rotationEnabled: boolean;
}

/** 模块开关 */
export interface ModuleToggles {
  musicEnabled: boolean;
  hardwareEnabled: boolean;
  notificationEnabled: boolean;
  msgModeEnabled: boolean;
}

/** 应用设置 */
export interface AppSettings {
  island: IslandSettings;
  modules: ModuleToggles;
  targetPlayer: string;
}

/** 应用快照 */
export interface AppSnapshot {
  settings: AppSettings;
  updatedAt: number;
}
