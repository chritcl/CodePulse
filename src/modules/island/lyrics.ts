import type { LyricLine, MusicPlaybackState } from '@/shared/ipc/contracts';

export interface CurrentLyricResult {
  currentLine: LyricLine | null;
  nextLine: LyricLine | null;
}

/** 构建前端曲目身份，仅用于避免重复请求歌词 */
export const buildTrackIdentity = (state: MusicPlaybackState | null): string => {
  if (!state?.title.trim()) return '';

  return [
    state.player,
    state.title,
    state.artist,
    state.album ?? '',
    state.durationMs ?? 0,
  ]
    .map((value) => String(value).trim().toLowerCase())
    .join('|');
};

/** 根据最近一次系统时间线同步结果推算当前播放位置 */
export const estimatePlaybackPosition = (
  state: Pick<
    MusicPlaybackState,
    'durationMs' | 'isPlaying' | 'positionMs' | 'timelineUpdatedAtMs'
  > | null,
  nowMs = Date.now()
): number | null => {
  if (!state || state.positionMs === undefined) return null;

  const elapsedMs = state.isPlaying ? Math.max(0, nowMs - state.timelineUpdatedAtMs) : 0;
  const estimatedPosition = state.positionMs + elapsedMs;

  if (state.durationMs === undefined) {
    return Math.max(0, estimatedPosition);
  }

  return Math.min(Math.max(0, estimatedPosition), state.durationMs);
};

/** 根据播放位置解析当前歌词和下一句歌词 */
export const resolveCurrentLyricLine = (
  lines: LyricLine[],
  positionMs: number | null
): CurrentLyricResult => {
  if (positionMs === null) {
    return { currentLine: null, nextLine: null };
  }

  const timedLines = lines.filter((line) => line.startMs !== undefined);
  if (timedLines.length === 0) {
    return { currentLine: null, nextLine: null };
  }

  let currentIndex = -1;

  for (let index = 0; index < timedLines.length; index += 1) {
    const line = timedLines[index];
    if ((line.startMs ?? 0) <= positionMs) {
      currentIndex = index;
      continue;
    }
    break;
  }

  if (currentIndex < 0) {
    return {
      currentLine: null,
      nextLine: timedLines[0] ?? null,
    };
  }

  return {
    currentLine: timedLines[currentIndex] ?? null,
    nextLine: timedLines[currentIndex + 1] ?? null,
  };
};
