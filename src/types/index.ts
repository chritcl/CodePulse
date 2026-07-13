/**
 * 共享类型定义
 *
 * 定义项目中通用的数据结构和类型。
 */

// ============================================================
// 主题相关
// ============================================================

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 灵动岛主题 */
export type IslandTheme = 'black' | 'white';

// ============================================================
// 网速相关
// ============================================================

/** 网速数据 */
export interface SpeedData {
  upload: number; // bytes/s
  download: number; // bytes/s
  timestamp: number;
}

/** 格式化后的网速 */
export interface FormattedSpeed {
  value: string;
  unit: string;
}

// ============================================================
// 流量统计
// ============================================================

/** 每日流量数据 */
export interface DailyTraffic {
  up: number; // bytes
  down: number; // bytes
}

/** 流量统计集合 */
export type TrafficStats = Record<string, DailyTraffic>;

// ============================================================
// 音乐相关
// ============================================================

/** 支持的音乐平台 */
export type MusicPlatform = 'netease' | 'spotify' | 'apple' | 'qqmusic' | 'kugou' | 'echo';

// ============================================================
// 硬件监控
// ============================================================

/** 硬件状态数据 */
export interface HardwareData {
  cpu: number; // 百分比 0-100
  memory: number; // 百分比 0-100
  gpu?: number; // 百分比 0-100 (估算值)
  timestamp: number;
}

// ============================================================
// 通知相关
// ============================================================

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
// 对话框
// ============================================================

/** 对话框配置 */
export interface DialogConfig {
  visible: boolean;
  title: string;
  message: string;
  isConfirm: boolean;
  callback: (() => void) | null;
}

// ============================================================
// 应用设置 (预留 R4 阶段)
// ============================================================

/** 应用设置 */
export interface AppSettings {
  appearance: {
    theme: ThemeMode;
  };
  island: {
    enabled: boolean;
    theme: IslandTheme;
    opacity: number;
    pinToTaskbar: boolean;
    positionLocked: boolean;
    glowBorder: boolean;
    silentMode: boolean;
    rotationEnabled: boolean;
  };
  modules: {
    musicEnabled: boolean;
    hardwareEnabled: boolean;
    notificationEnabled: boolean;
  };
  autostart: boolean;
}
