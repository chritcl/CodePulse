/**
 * IPC 模块入口
 *
 * 统一导出所有 IPC 相关的类型、常量和命令。
 */

// 导出类型定义
export type {
  // 基础类型
  SuccessResponse,
  ErrorResponse,

  // 灵动岛相关
  IslandStatusSyncPayload,
  IslandOpacityPayload,
  IslandThemePayload,

  // 控制命令
  PinTaskbarPayload,
  MsgModePayload,
  RotationModePayload,
  HardwareMonPayload,
  MusicCtlPayload,
  IslandVisibilityPayload,

  // 媒体控制
  MediaAction,
  MediaControlPayload,
  SetTargetPlayerPayload,
  TargetPlayerPayload,
  MusicPlaybackState,
  LyricsRequest,
  LyricLine,
  LyricsStatus,
  LyricsErrorCode,
  LyricsSource,
  LyricsResponse,
  AudioSpectrumData,

  // 窗口控制
  WindowPositionPayload,
  WindowSizePayload,
  WindowBoundsPayload,

  // 通知相关
  OpenAppPayload,
  SystemToastType,
  SystemToastPayload,
  BatteryEventPayload,

  // 动画相关
  IslandAnimationPayload,

  // 系统状态
  NetworkSpeedData,
  HardwareData,
  NotificationData,

  // R4 统一状态类型
  IslandSettings,
  ModuleToggles,
  AppSettings,
  AppSnapshot,
} from './contracts';

// 导出事件常量
export {
  // 灵动岛控制
  ISLAND_VISIBILITY,
  ISLAND_OPACITY,
  ISLAND_THEME,
  PIN_TASKBAR,
  MSG_MODE,
  ROTATION_MODE,
  HARDWARE_MON,
  MUSIC_CTL,

  // 灵动岛状态
  ISLAND_STATUS_SYNC,
  OPEN_SETTINGS_PANEL,

  // 系统状态
  NETWORK_SPEED_UPDATE,
  HARDWARE_UPDATE,
  MUSIC_UPDATE,
  NOTIFICATION_UPDATE,
  SYSTEM_EVENT,
  BATTERY_EVENT,

  // 应用生命周期 (R4 统一事件)
  SETTINGS_UPDATED,
  SNAPSHOT_UPDATED,
  ISLAND_VISIBILITY_CHANGED,
  ISLAND_DISPLAY_CHANGED,

  // 聚合对象
  ALL_EVENTS,
} from './events';

// 导出事件类型
export type { EventName } from './events';

// 导出命令封装
export {
  // 分类命令
  mediaCommands,
  windowCommands,
  animationCommands,
  notificationCommands,
  systemCommands,
  settingsCommands,

  // 聚合对象
  commands,
} from './commands';
