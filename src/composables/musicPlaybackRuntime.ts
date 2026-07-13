import { ref, type Ref } from 'vue';
import type { MusicPlaybackState } from '@/shared/ipc/contracts';
import type { PlaybackTimelineController } from './usePlaybackTimeline';

export type MusicSessionStatus = 'idle' | 'ready' | 'stale' | 'error';

export interface MusicPlaybackRuntimeContext {
  player: string;
  generation: number;
}

interface MusicPlaybackRuntimeOptions {
  timeline: PlaybackTimelineController;
  getPlayback: () => Promise<MusicPlaybackState | null>;
}

interface MusicPlaybackRuntime {
  playback: Ref<MusicPlaybackState | null>;
  status: Ref<MusicSessionStatus>;
  activate(context: MusicPlaybackRuntimeContext, resetTimeline: boolean): void;
  invalidate(): void;
  isCurrent(context: MusicPlaybackRuntimeContext): boolean;
  sync(context: MusicPlaybackRuntimeContext): Promise<void>;
  forceFresh(context: MusicPlaybackRuntimeContext): Promise<void>;
  markFailure(context: MusicPlaybackRuntimeContext): void;
}

const POLL_INTERVAL_MS = 1_000;
const STALE_TIMEOUT_MS = 3_000;

/** 管理单一目标下的快照串行轮询与陈旧看门狗 */
export const createMusicPlaybackRuntime = (
  options: MusicPlaybackRuntimeOptions
): MusicPlaybackRuntime => {
  const playback = ref<MusicPlaybackState | null>(null);
  const status = ref<MusicSessionStatus>('idle');
  let current: MusicPlaybackRuntimeContext | null = null;
  let pollTimer: number | null = null;
  let staleTimer: number | null = null;
  let activePromise: Promise<void> | null = null;
  let staleEligible = false;
  let staleMarked = false;

  const isCurrent = (context: MusicPlaybackRuntimeContext): boolean => current === context;
  const clearPollTimer = (): void => {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
  };
  const clearStaleTimer = (): void => {
    if (staleTimer !== null) window.clearTimeout(staleTimer);
    staleTimer = null;
  };
  const markFailure = (context: MusicPlaybackRuntimeContext): void => {
    if (!isCurrent(context) || !staleEligible || staleMarked) return;
    status.value = 'error';
  };
  const armStaleTimer = (context: MusicPlaybackRuntimeContext): void => {
    clearStaleTimer();
    staleEligible = true;
    staleMarked = false;
    staleTimer = window.setTimeout(() => {
      staleTimer = null;
      if (!isCurrent(context) || !staleEligible || staleMarked) return;
      staleMarked = true;
      options.timeline.markStale();
      status.value = 'stale';
    }, STALE_TIMEOUT_MS);
  };
  const applySnapshot = (
    snapshot: MusicPlaybackState | null,
    context: MusicPlaybackRuntimeContext
  ): void => {
    if (!isCurrent(context)) return;
    if (snapshot && snapshot.player !== context.player) {
      markFailure(context);
      return;
    }
    if (!snapshot) {
      playback.value = null;
      status.value = 'idle';
      staleEligible = false;
      staleMarked = false;
      clearStaleTimer();
      options.timeline.reset();
      return;
    }
    playback.value = snapshot;
    status.value = 'ready';
    options.timeline.sync(snapshot);
    armStaleTimer(context);
  };
  const schedulePoll = (context: MusicPlaybackRuntimeContext): void => {
    if (!isCurrent(context)) return;
    clearPollTimer();
    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void beginRequest(context);
    }, POLL_INTERVAL_MS);
  };
  const performRequest = async (context: MusicPlaybackRuntimeContext): Promise<void> => {
    try {
      applySnapshot(await options.getPlayback(), context);
    } catch {
      markFailure(context);
    }
  };
  const beginRequest = (context: MusicPlaybackRuntimeContext): Promise<void> => {
    if (!isCurrent(context)) return Promise.resolve();
    if (activePromise) return activePromise;
    const request = performRequest(context);
    activePromise = request;
    const finish = (): void => {
      if (!isCurrent(context) || activePromise !== request) return;
      activePromise = null;
      schedulePoll(context);
    };
    void request.then(finish, finish);
    return request;
  };
  const activate = (context: MusicPlaybackRuntimeContext, resetTimeline: boolean): void => {
    current = context;
    clearPollTimer();
    clearStaleTimer();
    activePromise = null;
    playback.value = null;
    status.value = 'idle';
    if (resetTimeline) options.timeline.reset();
    armStaleTimer(context);
  };
  const invalidate = (): void => {
    current = null;
    clearPollTimer();
    clearStaleTimer();
    activePromise = null;
    staleEligible = false;
    staleMarked = false;
    playback.value = null;
    status.value = 'idle';
    options.timeline.reset();
  };
  const sync = (context: MusicPlaybackRuntimeContext): Promise<void> => {
    clearPollTimer();
    return beginRequest(context);
  };
  const forceFresh = async (context: MusicPlaybackRuntimeContext): Promise<void> => {
    const pending = activePromise;
    if (pending) await pending;
    if (!isCurrent(context)) return;
    clearPollTimer();
    await beginRequest(context);
  };

  return { playback, status, activate, invalidate, isCurrent, sync, forceFresh, markFailure };
};
