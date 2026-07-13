import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue';
import type { MediaAction, MusicPlaybackState } from '@/shared/ipc/contracts';
import { mediaCommands } from '@/shared/ipc/commands';
import type { PlaybackTimelineController } from './usePlaybackTimeline';

export type MusicSessionStatus = 'idle' | 'ready' | 'stale' | 'error';

export interface UseMusicPlaybackSessionOptions {
  timeline: PlaybackTimelineController;
  getPlayback?: () => Promise<MusicPlaybackState | null>;
  setPlayer?: (player: string) => Promise<void>;
  controlMedia?: (action: MediaAction) => Promise<void>;
}

export interface MusicPlaybackSessionController {
  playback: Ref<MusicPlaybackState | null>;
  status: Ref<MusicSessionStatus>;
  start(player: string): void;
  stop(): void;
  setTargetPlayer(player: string): Promise<void>;
  syncNow(): Promise<void>;
  control(action: MediaAction): Promise<void>;
}

const POLL_INTERVAL_MS = 1_000;
const STALE_TIMEOUT_MS = 3_000;

/** 管理目标播放器、串行快照轮询和播放控制 */
export const useMusicPlaybackSession = (
  options: UseMusicPlaybackSessionOptions
): MusicPlaybackSessionController => {
  const getPlayback = options.getPlayback ?? mediaCommands.getMusicPlaybackState;
  const setPlayer = options.setPlayer ?? mediaCommands.setTargetPlayer;
  const controlMedia = options.controlMedia ?? mediaCommands.controlSystemMedia;
  const playback = ref<MusicPlaybackState | null>(null);
  const status = ref<MusicSessionStatus>('idle');
  let targetPlayer = '';
  let generation = 0;
  let running = false;
  let pollTimer: number | null = null;
  let staleTimer: number | null = null;
  let activePromise: Promise<void> | null = null;
  let playerRequestId = 0;
  let staleEligible = false;
  let staleMarked = false;

  const isCurrent = (expected: number): boolean => running && generation === expected;

  const clearPollTimer = (): void => {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
  };

  const clearStaleTimer = (): void => {
    if (staleTimer !== null) window.clearTimeout(staleTimer);
    staleTimer = null;
  };

  const armStaleTimer = (expected: number): void => {
    clearStaleTimer();
    staleEligible = true;
    staleMarked = false;
    staleTimer = window.setTimeout(() => {
      staleTimer = null;
      if (!isCurrent(expected) || !staleEligible || staleMarked) return;
      staleMarked = true;
      options.timeline.markStale();
      status.value = 'stale';
    }, STALE_TIMEOUT_MS);
  };

  const applySnapshot = (snapshot: MusicPlaybackState | null, expected: number): void => {
    if (!isCurrent(expected)) return;
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
    armStaleTimer(expected);
  };

  const markSyncFailure = (expected: number): void => {
    if (!isCurrent(expected) || !staleEligible || staleMarked) return;
    status.value = 'error';
  };

  const schedulePoll = (expected: number): void => {
    if (!isCurrent(expected)) return;
    clearPollTimer();
    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void beginRequest(expected);
    }, POLL_INTERVAL_MS);
  };

  const performRequest = async (expected: number): Promise<void> => {
    try {
      applySnapshot(await getPlayback(), expected);
    } catch {
      markSyncFailure(expected);
    }
  };

  const beginRequest = (expected: number): Promise<void> => {
    if (!isCurrent(expected)) return Promise.resolve();
    const request = performRequest(expected);
    activePromise = request;
    const finish = (): void => {
      if (!isCurrent(expected) || activePromise !== request) return;
      activePromise = null;
      schedulePoll(expected);
    };
    void request.then(finish, finish);
    return request;
  };

  const resetGeneration = (player: string, resetTimeline: boolean): number => {
    generation += 1;
    targetPlayer = player;
    clearPollTimer();
    clearStaleTimer();
    activePromise = null;
    playback.value = null;
    status.value = 'idle';
    if (resetTimeline) options.timeline.reset();
    armStaleTimer(generation);
    return generation;
  };

  const syncNow = (): Promise<void> => {
    clearPollTimer();
    if (!running) return Promise.resolve();
    return activePromise ?? beginRequest(generation);
  };

  const start = (player: string): void => {
    if (running && targetPlayer === player) return;
    const restarting = running;
    if (targetPlayer !== player) playerRequestId += 1;
    running = true;
    if (!restarting) options.timeline.start();
    const expected = resetGeneration(player, restarting);
    void beginRequest(expected);
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    generation += 1;
    clearPollTimer();
    clearStaleTimer();
    activePromise = null;
    staleEligible = false;
    staleMarked = false;
    playback.value = null;
    status.value = 'idle';
    options.timeline.reset();
    options.timeline.stop();
  };

  const setTargetPlayer = async (player: string): Promise<void> => {
    const requestId = ++playerRequestId;
    const changed = player !== targetPlayer;
    if (changed) {
      targetPlayer = player;
      if (running) resetGeneration(player, true);
    }
    try {
      await setPlayer(player);
    } catch (error) {
      if (requestId === playerRequestId) markSyncFailure(generation);
      throw error;
    }
    if (requestId !== playerRequestId || !running || !changed) return;
    await syncNow();
  };

  const control = async (action: MediaAction): Promise<void> => {
    const expected = generation;
    await controlMedia(action);
    if (!isCurrent(expected)) return;
    clearPollTimer();
    const beforeControlRequest = activePromise;
    if (beforeControlRequest) await beforeControlRequest;
    if (isCurrent(expected)) await syncNow();
  };

  if (getCurrentScope()) onScopeDispose(stop);

  return { playback, status, start, stop, setTargetPlayer, syncNow, control };
};
