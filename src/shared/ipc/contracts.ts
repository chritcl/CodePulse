/**
 * IPC 事件 Payload 类型定义
 *
 * 所有跨窗口通信的 Payload 都应在此定义，确保类型安全。
 */

// ============================================================
// 基础类型
// ============================================================

/** 通用成功响应 */
export interface SuccessResponse {
  success: boolean;
  message?: string;
}

/** 通用错误响应 */
export interface ErrorResponse {
  error: string;
  code?: string;
}

// ============================================================
// 灵动岛相关
// ============================================================

/** 灵动岛状态同步 */
export interface IslandStatusSyncPayload {
  visible: boolean;
}

/** 灵动岛透明度 */
export interface IslandOpacityPayload {
  opacity: number; // 0.0 - 1.0
}

/** 灵动岛主题 */
export interface IslandThemePayload {
  theme: 'black' | 'white';
}

// ============================================================
// 控制命令
// ============================================================

/** 任务栏停靠 */
export interface PinTaskbarPayload {
  enabled: boolean;
}

/** 消息模式 */
export interface MsgModePayload {
  enabled: boolean;
}

/** 轮换模式 */
export interface RotationModePayload {
  enabled: boolean;
}

/** 硬件监控 */
export interface HardwareMonPayload {
  enabled: boolean;
}

/** 音乐控制 */
export interface MusicCtlPayload {
  enabled: boolean;
}

/** 灵动岛显隐 */
export interface IslandVisibilityPayload {
  show: boolean;
}

// ============================================================
// 媒体控制
// ============================================================

/** 媒体控制动作 */
export type MediaAction = 'play_pause' | 'prev' | 'next' | 'stop';

/** 媒体控制命令 */
export interface MediaControlPayload {
  action: MediaAction;
}

/** 设置目标播放器 */
export interface SetTargetPlayerPayload {
  player: string;
}

// ============================================================
// 窗口控制
// ============================================================

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

/** 窗口边界 (位置 + 大小) */
export interface WindowBoundsPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================
// 通知相关
// ============================================================

/** 打开应用 */
export interface OpenAppPayload {
  aumid: string;
  launchId?: string;
}

// ============================================================
// 动画相关
// ============================================================

/** 灵动岛动画参数 */
export interface IslandAnimationPayload {
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
  duration?: number;
}

// ============================================================
// 系统状态
// ============================================================

/** 网速数据 */
export interface NetworkSpeedData {
  upload: number; // bytes/s
  download: number; // bytes/s
  timestamp: number;
}

/** 硬件状态 */
export interface HardwareData {
  cpu: number; // 百分比 0-100
  memory: number; // 百分比 0-100
  gpu?: number; // 百分比 0-100 (估算值)
  timestamp: number;
}

/** 音乐状态 */
export interface MusicData {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  isPlaying: boolean;
  progress?: number; // 0.0 - 1.0
  duration?: number; // 毫秒
  timestamp: number;
}

/** 通知数据 */
export interface NotificationData {
  id: string;
  title: string;
  body: string;
  app: string;
  aumid: string;
  timestamp: number;
  icon?: string;
}

// ============================================================
// R4 统一状态类型
// ============================================================

/** 灵动岛设置 */
export interface IslandSettings {
  enabled: boolean;
  theme: 'black' | 'white';
  opacity: number; // 0-100
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
  updatedAt: number; // 时间戳 (秒)
}
