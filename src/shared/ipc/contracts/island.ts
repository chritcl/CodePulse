/** 灵动岛状态同步载荷 */
export interface IslandStatusSyncPayload {
  visible: boolean;
}

/** 灵动岛透明度载荷 */
export interface IslandOpacityPayload {
  opacity: number;
}

/** 灵动岛主题载荷 */
export interface IslandThemePayload {
  theme: 'black' | 'white';
}

/** 任务栏停靠载荷 */
export interface PinTaskbarPayload {
  enabled: boolean;
}

/** 消息模式载荷 */
export interface MsgModePayload {
  enabled: boolean;
}

/** 轮换模式载荷 */
export interface RotationModePayload {
  enabled: boolean;
}

/** 硬件监控载荷 */
export interface HardwareMonPayload {
  enabled: boolean;
}

/** 音乐控制载荷 */
export interface MusicCtlPayload {
  enabled: boolean;
}

/** 灵动岛显隐载荷 */
export interface IslandVisibilityPayload {
  show: boolean;
}

/** 弹簧动画载荷 */
export interface SpringAnimationPayload {
  enabled: boolean;
}

/** 窗口位置 */
export interface WindowPositionPayload {
  x: number;
  y: number;
}

/** 窗口大小 */
export interface WindowSizePayload {
  width: number;
  height: number;
}

/** 窗口边界 */
export interface WindowBoundsPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 灵动岛原生拖拽启动参数 */
export interface IslandDragStartPayload {
  targetWidth: number;
  targetHeight: number;
  isPinned: boolean;
}

/** 系统操作提示类型 */
export type SystemToastType = 'app' | 'sys' | 'battery-charge' | 'battery-low' | 'lock' | 'unlock';

/** 系统操作提示载荷 */
export interface SystemToastPayload {
  text: string;
  type: SystemToastType;
}

/** 电池事件载荷 */
export interface BatteryEventPayload {
  state: 'charging' | 'discharging';
  percent: number;
}

/** 灵动岛动画参数 */
export interface IslandAnimationPayload {
  startWidth: number;
  startHeight: number;
  targetWidth: number;
  targetHeight: number;
  isPinned: boolean;
  durationMs: number;
}
