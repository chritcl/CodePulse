import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { MusicPlaybackState } from '@/shared/ipc/contracts';
import { mediaCommands } from '@/shared/ipc/commands';
import { buildPlaybackSessionIdentity } from '@/modules/island/lyrics';

const MAX_CACHE_SIZE = 50;

export interface UseTrackCoverOptions {
  getCover?: (songName: string, artistName: string) => Promise<string>;
}

/** 管理封面缓存，并阻止旧曲目的异步结果覆盖当前展示 */
export const useTrackCover = (options: UseTrackCoverOptions = {}) => {
  const getCover = options.getCover ?? mediaCommands.getRandomCoverUrl;
  const coverUrl = ref('');
  const cache = new Map<string, string>();
  let activeIdentity = '';
  let activeTask: Promise<void> | null = null;
  let generation = 0;
  let disposed = false;

  const readCache = (identity: string): string | undefined => {
    if (!cache.has(identity)) return undefined;
    const value = cache.get(identity)!;
    cache.delete(identity);
    cache.set(identity, value);
    return value;
  };

  const writeCache = (identity: string, value: string) => {
    cache.delete(identity);
    cache.set(identity, value);
    while (cache.size > MAX_CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const isCurrent = (identity: string, requestGeneration: number) =>
    !disposed && activeIdentity === identity && generation === requestGeneration;

  const reset = () => {
    if (disposed) return;
    generation += 1;
    activeIdentity = '';
    activeTask = null;
    coverUrl.value = '';
  };

  const load = (playback: MusicPlaybackState): Promise<void> => {
    if (disposed) return Promise.resolve();
    const identity = buildPlaybackSessionIdentity(playback);
    if (!identity) {
      reset();
      return Promise.resolve();
    }
    if (identity === activeIdentity && activeTask) return activeTask;
    if (identity === activeIdentity && cache.has(identity)) {
      coverUrl.value = readCache(identity) ?? '';
      return Promise.resolve();
    }

    const requestGeneration = ++generation;
    activeIdentity = identity;
    activeTask = null;
    const cachedCover = readCache(identity);
    if (cachedCover !== undefined) {
      coverUrl.value = cachedCover;
      return Promise.resolve();
    }

    coverUrl.value = '';
    const task = getCover(playback.title, playback.artist)
      .then((value) => {
        if (!isCurrent(identity, requestGeneration)) return;
        writeCache(identity, value);
        coverUrl.value = value;
      })
      .catch(() => {
        if (isCurrent(identity, requestGeneration)) coverUrl.value = '';
      })
      .finally(() => {
        if (isCurrent(identity, requestGeneration)) activeTask = null;
      });
    activeTask = task;
    return task;
  };

  const dispose = () => {
    if (disposed) return;
    generation += 1;
    disposed = true;
    activeIdentity = '';
    activeTask = null;
    coverUrl.value = '';
    cache.clear();
  };

  if (getCurrentScope()) onScopeDispose(dispose);
  return { coverUrl, load, reset, dispose };
};
