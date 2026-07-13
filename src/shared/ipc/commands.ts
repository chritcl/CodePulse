/**
 * Tauri 命令封装
 *
 * 统一封装所有 Tauri invoke 调用，提供类型安全的命令接口。
 * 命令名称与 Rust 侧 #[tauri::command] 保持一致。
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  MediaAction,
  AudioSpectrumData,
  MusicPlaybackState,
  LyricsRequest,
  LyricsResponse,
  OpenAppPayload,
  IslandAnimationPayload,
  WindowBoundsPayload,
  AppSettings,
  AppSnapshot,
} from './contracts';

// ============================================================
// 媒体控制命令
// ============================================================

/** 控制系统媒体播放 */
export const mediaCommands = {
  /**
   * 执行媒体控制动作
   * @param action - 播放/暂停/上一首/下一首
   */
  controlSystemMedia: (action: MediaAction): Promise<void> =>
    invoke('control_system_media', { action }),

  /**
   * 设置目标播放器
   * @param player - 播放器名称
   */
  setTargetPlayer: (player: string): Promise<void> => invoke('set_target_player', { player }),

  /** 获取完整音乐播放状态 */
  getMusicPlaybackState: (): Promise<MusicPlaybackState | null> =>
    invoke('get_music_playback_state'),

  /** 获取歌曲封面 */
  getRandomCoverUrl: (songName: string, artistName: string): Promise<string> =>
    invoke('get_random_cover_url', { songName, artistName }),

  /**
   * 获取当前歌曲歌词
   * @param request - 歌曲元信息
   */
  getLyricsForTrack: (request: LyricsRequest): Promise<LyricsResponse> =>
    invoke('get_lyrics_for_track', { ...request }),

  /** 获取音乐频谱 */
  getAudioSpectrum: (): Promise<AudioSpectrumData> => invoke('get_audio_spectrum'),
};

// ============================================================
// 窗口控制命令
// ============================================================

/** 窗口管理命令 */
export const windowCommands = {
  /** 强制窗口置顶 */
  forceWindowTopmost: (): Promise<void> => invoke('force_window_topmost'),

  /**
   * 设置窗口边界 (位置 + 大小)
   * @param bounds - 窗口边界参数
   */
  setWindowBounds: (bounds: WindowBoundsPayload): Promise<void> =>
    invoke('set_window_bounds', { bounds }),
};

// ============================================================
// 灵动岛动画命令
// ============================================================

/** 灵动岛动画命令 */
export const animationCommands = {
  /**
   * 启动灵动岛动画
   * @param params - 动画参数
   */
  startIslandAnimation: (params: IslandAnimationPayload): Promise<void> =>
    invoke('start_island_animation', { ...params }),
};

// ============================================================
// 通知命令
// ============================================================

/** 通知相关命令 */
export const notificationCommands = {
  /**
   * 通过 AUMID 打开应用
   * @param payload - 应用标识
   */
  openAppByAumid: (payload: OpenAppPayload): Promise<void> =>
    invoke('open_app_by_aumid', { ...payload }),
};

// ============================================================
// 系统监控命令 (未来扩展)
// ============================================================

/** 系统监控命令 */
export const systemCommands = {
  /**
   * 获取当前网速
   * @returns 网速数据
   */
  getNetworkSpeed: (): Promise<{ upload: number; download: number }> => invoke('get_network_speed'),

  /**
   * 获取硬件状态
   * @returns 硬件数据
   */
  getHardwareStatus: (): Promise<{ cpu: number; memory: number; gpu?: number }> =>
    invoke('get_hardware_status'),
};

// ============================================================
// 设置命令 (R4 统一命令)
// ============================================================

/** 设置命令 */
export const settingsCommands = {
  /**
   * 获取应用快照
   * @returns 应用快照
   */
  getAppSnapshot: (): Promise<AppSnapshot> => invoke('get_app_snapshot'),

  /**
   * 更新设置
   * @param patch - 设置补丁
   * @returns 更新后的设置
   */
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    invoke('update_settings', { patch }),

  /**
   * 设置灵动岛可见性
   * @param visible - 是否可见
   */
  setIslandVisible: (visible: boolean): Promise<void> => invoke('set_island_visible', { visible }),
};

// ============================================================
// 导出所有命令
// ============================================================

/** 所有 Tauri 命令 */
export const commands = {
  media: mediaCommands,
  window: windowCommands,
  animation: animationCommands,
  notification: notificationCommands,
  system: systemCommands,
  settings: settingsCommands,
} as const;
