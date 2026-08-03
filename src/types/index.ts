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
// 流量统计
// ============================================================

/** 每日流量数据 */
export interface DailyTraffic {
  up: number;
  down: number;
}

/** 流量统计集合 */
export type TrafficStats = Record<string, DailyTraffic>;

// ============================================================
// 音乐相关
// ============================================================

/** 支持的音乐平台 */
export type MusicPlatform = 'netease' | 'spotify' | 'apple' | 'qqmusic' | 'kugou' | 'echo';

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
