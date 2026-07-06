/**
 * IPC 事件常量定义
 *
 * 所有跨窗口事件名称统一定义在此，避免硬编码字符串。
 * 使用 kebab-case 命名风格，与现有事件保持一致。
 */

// ============================================================
// 灵动岛控制事件 (main → widget)
// ============================================================

/** 灵动岛显隐控制 */
export const ISLAND_VISIBILITY = 'control-island-visibility';

/** 灵动岛透明度 */
export const ISLAND_OPACITY = 'control-island-opacity';

/** 灵动岛主题 */
export const ISLAND_THEME = 'control-island-theme';

/** 任务栏停靠 */
export const PIN_TASKBAR = 'control-pin-taskbar';

/** 消息模式 */
export const MSG_MODE = 'control-msg-mode';

/** 轮换模式 */
export const ROTATION_MODE = 'control-rotation-mode';

/** 硬件监控开关 */
export const HARDWARE_MON = 'control-hardware-mon';

/** 音乐控制开关 */
export const MUSIC_CTL = 'control-music-ctl';

// ============================================================
// 灵动岛状态事件 (widget → main)
// ============================================================

/** 灵动岛状态同步 */
export const ISLAND_STATUS_SYNC = 'island-status-sync';

/** 打开设置面板 */
export const OPEN_SETTINGS_PANEL = 'open-settings-panel';

// ============================================================
// 系统状态事件 (Rust → frontend)
// ============================================================

/** 网速更新 */
export const NETWORK_SPEED_UPDATE = 'network-speed-update';

/** 硬件状态更新 */
export const HARDWARE_UPDATE = 'hardware-update';

/** 音乐状态更新 */
export const MUSIC_UPDATE = 'music-update';

/** 通知更新 */
export const NOTIFICATION_UPDATE = 'notification-update';

/** 系统操作事件 */
export const SYSTEM_EVENT = 'system-event';

/** 电池状态事件 */
export const BATTERY_EVENT = 'battery-event';

// ============================================================
// 应用生命周期事件 (R4 统一事件)
// ============================================================

/** 应用设置已更新 (统一事件，替代所有 control-* 事件) */
export const SETTINGS_UPDATED = 'app.settings.updated';

/** 应用快照已更新 */
export const SNAPSHOT_UPDATED = 'app.snapshot.updated';

/** 灵动岛显隐变更 (统一事件) */
export const ISLAND_VISIBILITY_CHANGED = 'app.island.visibility';

/** 灵动岛展示模式已变更 */
export const ISLAND_DISPLAY_CHANGED = 'island.display.changed';

// ============================================================
// 事件名称映射类型 (用于类型检查)
// ============================================================

/** 所有事件名称常量 */
export const ALL_EVENTS = {
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
} as const;

/** 事件名称类型 */
export type EventName = (typeof ALL_EVENTS)[keyof typeof ALL_EVENTS];
