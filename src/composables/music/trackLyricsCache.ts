import type { LyricLine } from '@/shared/ipc/contracts';

const READY_CACHE_LIMIT = 50;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1_000;

/** 创建歌词就绪缓存和限时负缓存 */
export const createTrackLyricsCache = () => {
  const ready = new Map<string, LyricLine[]>();
  const negative = new Map<string, number>();

  const getReady = (identity: string): LyricLine[] | null => {
    const cachedLines = ready.get(identity);
    if (!cachedLines) return null;
    ready.delete(identity);
    ready.set(identity, cachedLines);
    return cachedLines;
  };

  const setReady = (identity: string, lines: LyricLine[]): void => {
    ready.delete(identity);
    ready.set(identity, lines);
    while (ready.size > READY_CACHE_LIMIT) {
      const oldestIdentity = ready.keys().next().value;
      if (oldestIdentity !== undefined) ready.delete(oldestIdentity);
    }
  };

  const hasNegative = (identity: string): boolean => {
    const expiresAt = negative.get(identity) ?? 0;
    if (expiresAt > Date.now()) return true;
    negative.delete(identity);
    return false;
  };

  const setNegative = (identity: string): void => {
    negative.set(identity, Date.now() + NEGATIVE_CACHE_TTL_MS);
  };

  const clear = (): void => {
    ready.clear();
    negative.clear();
  };

  return { getReady, setReady, hasNegative, setNegative, clear };
};
