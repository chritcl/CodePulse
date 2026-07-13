import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue';
import type {
  LyricLine,
  LyricsRequest,
  LyricsResponse,
  MusicPlaybackState,
} from '@/shared/ipc/contracts';
import { mediaCommands } from '@/shared/ipc/commands';
import {
  buildPlaybackSessionIdentity,
  normalizeLyricLines,
  resolveCurrentLyricLine,
} from '@/modules/island/lyrics';
import { createTrackLyricsCache } from './trackLyricsCache';

export type TrackLyricsStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'retrying' | 'error';

export interface UseTrackLyricsOptions {
  positionMs: Ref<number | null>;
  getLyrics?: (request: LyricsRequest) => Promise<LyricsResponse>;
}

export interface TrackLyricsController {
  status: Ref<TrackLyricsStatus>;
  lines: Ref<LyricLine[]>;
  currentLyricText: ComputedRef<string>;
  nextLyricText: ComputedRef<string>;
  load(snapshot: MusicPlaybackState): Promise<void>;
  reset(): void;
  dispose(): void;
}

const RETRY_DELAYS_MS = [1_000, 3_000] as const;

const toRequest = (snapshot: MusicPlaybackState): LyricsRequest => ({
  title: snapshot.title,
  artist: snapshot.artist,
  album: snapshot.album,
  durationMs: snapshot.durationMs,
  player: snapshot.player,
});

/** 管理单首歌曲歌词的缓存、重试和代际隔离 */
export const useTrackLyrics = (options: UseTrackLyricsOptions): TrackLyricsController => {
  const getLyrics = options.getLyrics ?? mediaCommands.getLyricsForTrack;
  const status = ref<TrackLyricsStatus>('idle');
  const lines = ref<LyricLine[]>([]);
  const cache = createTrackLyricsCache();
  let activeIdentity = '';
  let latestRequest: LyricsRequest | null = null;
  let activePromise: Promise<void> | null = null;
  let generation = 0;
  let retryTimer: number | null = null;
  let resolveRetry: (() => void) | null = null;
  let disposed = false;

  const resolvedLine = computed(() =>
    resolveCurrentLyricLine(lines.value, options.positionMs.value)
  );
  const currentLyricText = computed(() => resolvedLine.value.currentLine?.text ?? '');
  const nextLyricText = computed(() => resolvedLine.value.nextLine?.text ?? '');

  const cancelRetry = (): void => {
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    const resolve = resolveRetry;
    resolveRetry = null;
    resolve?.();
  };

  const waitForRetry = (delayMs: number): Promise<void> =>
    new Promise((resolve) => {
      resolveRetry = resolve;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        resolveRetry = null;
        resolve();
      }, delayMs);
    });

  const isCurrent = (expectedGeneration: number, identity: string): boolean =>
    !disposed && generation === expectedGeneration && activeIdentity === identity;

  const restoreReady = (identity: string): boolean => {
    const cachedLines = cache.getReady(identity);
    if (!cachedLines) return false;
    lines.value = cachedLines;
    status.value = 'ready';
    return true;
  };

  const markNotFound = (identity: string): void => {
    cache.setNegative(identity);
    lines.value = [];
    status.value = 'not_found';
  };

  const requestLyrics = async (expectedGeneration: number, identity: string): Promise<void> => {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const request = latestRequest;
      if (!request || !isCurrent(expectedGeneration, identity)) return;
      let response: LyricsResponse | null;
      try {
        response = await getLyrics(request);
      } catch {
        response = null;
      }
      if (!isCurrent(expectedGeneration, identity)) return;

      if (response?.status === 'ready') {
        const normalizedLines = normalizeLyricLines(response.lines);
        if (normalizedLines.length === 0) {
          markNotFound(identity);
          return;
        }
        cache.setReady(identity, normalizedLines);
        lines.value = normalizedLines;
        status.value = 'ready';
        return;
      }
      if (response?.status === 'not_found') {
        markNotFound(identity);
        return;
      }

      const retryable = response?.retryable ?? true;
      const retryDelayMs = RETRY_DELAYS_MS[attempt];
      if (!retryable || retryDelayMs === undefined) {
        lines.value = [];
        status.value = 'error';
        return;
      }
      status.value = 'retrying';
      await waitForRetry(retryDelayMs);
    }
  };

  const beginRequest = (identity: string): Promise<void> => {
    const expectedGeneration = generation;
    status.value = 'loading';
    lines.value = [];
    const requestPromise = requestLyrics(expectedGeneration, identity);
    activePromise = requestPromise;
    const clearActivePromise = (): void => {
      if (activePromise === requestPromise) activePromise = null;
    };
    void requestPromise.then(clearActivePromise, clearActivePromise);
    return requestPromise;
  };

  const load = (snapshot: MusicPlaybackState): Promise<void> => {
    if (disposed) return Promise.resolve();
    const identity = buildPlaybackSessionIdentity(snapshot);
    if (!identity) {
      reset();
      return Promise.resolve();
    }
    latestRequest = toRequest(snapshot);
    if (identity === activeIdentity) {
      if (status.value !== 'not_found' || cache.hasNegative(identity)) {
        return activePromise ?? Promise.resolve();
      }
    }

    generation += 1;
    cancelRetry();
    activePromise = null;
    activeIdentity = identity;
    if (restoreReady(identity)) return Promise.resolve();
    if (cache.hasNegative(identity)) {
      lines.value = [];
      status.value = 'not_found';
      return Promise.resolve();
    }
    return beginRequest(identity);
  };

  const reset = (): void => {
    generation += 1;
    cancelRetry();
    activeIdentity = '';
    latestRequest = null;
    activePromise = null;
    lines.value = [];
    status.value = 'idle';
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    reset();
    cache.clear();
  };

  if (getCurrentScope()) onScopeDispose(dispose);

  return { status, lines, currentLyricText, nextLyricText, load, reset, dispose };
};
