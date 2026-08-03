import type { LyricLine, MusicPlaybackState } from '@/shared/ipc/contracts';

export interface CurrentLyricResult {
  currentLine: LyricLine | null;
  nextLine: LyricLine | null;
}

type TimedLyricLine = LyricLine & { startMs: number };

const normalizeIdentityPart = (value: string | number): string =>
  String(value).trim().toLowerCase();

const encodeIdentity = (parts: Array<string | number>): string =>
  JSON.stringify(parts.map(normalizeIdentityPart));

/** 构建歌词请求身份，专辑或时长变化时允许重新请求 */
export const buildTrackIdentity = (state: MusicPlaybackState | null): string => {
  if (!state?.title.trim()) return '';

  return encodeIdentity([
    state.player,
    state.title,
    state.artist,
    state.album ?? '',
    state.durationMs ?? 0,
  ]);
};

/** 构建稳定的播放会话身份，不受专辑和时长后续补全影响 */
export const buildPlaybackSessionIdentity = (state: MusicPlaybackState | null): string => {
  if (!state?.title.trim()) return '';

  return encodeIdentity([state.player, state.sourceAppId, state.title, state.artist]);
};

const isValidTimedLine = (line: LyricLine): line is TimedLyricLine =>
  line.startMs !== undefined &&
  Number.isFinite(line.startMs) &&
  line.startMs >= 0 &&
  line.text.trim().length > 0;

/** 清洗、稳定排序歌词，并补全可推导的结束时间 */
export const normalizeLyricLines = (lines: readonly LyricLine[]): LyricLine[] => {
  const sortedLines = lines
    .map((line, sourceIndex) => ({ line, sourceIndex }))
    .filter((entry): entry is { line: TimedLyricLine; sourceIndex: number } =>
      isValidTimedLine(entry.line)
    )
    .sort(
      (left, right) =>
        left.line.startMs - right.line.startMs ||
        left.line.index - right.line.index ||
        left.sourceIndex - right.sourceIndex
    );

  const uniqueLines: TimedLyricLine[] = [];
  for (const { line } of sortedLines) {
    if (uniqueLines[uniqueLines.length - 1]?.startMs === line.startMs) continue;
    uniqueLines.push(line);
  }

  return uniqueLines.map((line, index) => {
    const explicitEndMs =
      line.endMs !== undefined && Number.isFinite(line.endMs) && line.endMs > line.startMs
        ? line.endMs
        : undefined;
    const endMs = explicitEndMs ?? uniqueLines[index + 1]?.startMs;

    return { ...line, endMs };
  });
};

/** 使用二分查找解析规范化歌词中的当前句和下一句 */
export const resolveCurrentLyricLine = (
  lines: readonly LyricLine[],
  positionMs: number | null
): CurrentLyricResult => {
  if (positionMs === null || !Number.isFinite(positionMs) || lines.length === 0) {
    return { currentLine: null, nextLine: null };
  }

  let low = 0;
  let high = lines.length - 1;
  let currentIndex = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const startMs = lines[middle]?.startMs;
    if (startMs !== undefined && startMs <= positionMs) {
      currentIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (currentIndex < 0) {
    const firstLine = lines[0];
    return {
      currentLine: null,
      nextLine: firstLine && isValidTimedLine(firstLine) ? firstLine : null,
    };
  }

  const currentLine = lines[currentIndex] ?? null;
  const nextLine = lines[currentIndex + 1] ?? null;
  if (currentLine?.endMs !== undefined && positionMs >= currentLine.endMs) {
    return { currentLine: null, nextLine };
  }

  return { currentLine, nextLine };
};
