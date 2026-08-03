import type { MusicPlatform } from '@/types';

/** 媒体控制动作 */
export type MediaAction = 'play_pause' | 'prev' | 'next';

/** 媒体控制载荷 */
export interface MediaControlPayload {
  action: MediaAction;
}

/** 设置目标播放器载荷 */
export interface SetTargetPlayerPayload {
  player: string;
}

/** 目标音乐平台同步载荷 */
export interface TargetPlayerPayload {
  player: MusicPlatform;
}

/** 完整音乐播放状态 */
export interface MusicPlaybackState {
  title: string;
  artist: string;
  album?: string;
  sourceAppId: string;
  player: string;
  isPlaying: boolean;
  canSeek: boolean;
  durationMs?: number;
  positionMs?: number;
  timelineUpdatedAtMs?: number;
  snapshotTakenAtMs: number;
}

/** 歌词查询请求 */
export interface LyricsRequest {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  player?: string;
}

/** 歌词行 */
export interface LyricLine {
  index: number;
  startMs?: number;
  endMs?: number;
  text: string;
  translation?: string;
}

/** 歌词查询响应状态 */
export type LyricsStatus = 'ready' | 'not_found' | 'error';

/** 歌词查询错误类型 */
export type LyricsErrorCode = 'invalid_request' | 'timeout' | 'upstream' | 'cache';

/** 歌词来源类型 */
export type LyricsSource = 'cache' | 'online';

/** 歌词查询响应 */
export interface LyricsResponse {
  status: LyricsStatus;
  trackKey: string;
  provider: string;
  source: LyricsSource;
  confidence: number;
  retryable: boolean;
  errorCode?: LyricsErrorCode;
  rawLrc?: string;
  lines: LyricLine[];
}

/** 五段音频频谱数据 */
export type AudioSpectrumData = [number, number, number, number, number];
