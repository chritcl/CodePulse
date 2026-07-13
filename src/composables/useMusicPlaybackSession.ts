import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { MediaAction, MusicPlaybackState } from '@/shared/ipc/contracts';
import { mediaCommands } from '@/shared/ipc/commands';
import { createMusicTargetCoordinator, type MusicTargetSelection } from './musicTargetCoordinator';
import type { PlaybackTimelineController } from './usePlaybackTimeline';

export type MusicSessionStatus = 'idle' | 'ready' | 'stale' | 'error';

export interface UseMusicPlaybackSessionOptions {
  timeline: PlaybackTimelineController;
  getPlayback?: () => Promise<MusicPlaybackState | null>;
  setPlayer?: (player: string) => Promise<void>;
  controlMedia?: (action: MediaAction) => Promise<void>;
}

const POLL_INTERVAL_MS = 1_000;
const STALE_TIMEOUT_MS = 3_000;

/** 统一管理目标提交、快照轮询和播放控制 */
export const useMusicPlaybackSession = (options: UseMusicPlaybackSessionOptions) => {
  const getPlayback = options.getPlayback ?? mediaCommands.getMusicPlaybackState;
  const setPlayer = options.setPlayer ?? mediaCommands.setTargetPlayer;
  const controlMedia = options.controlMedia ?? mediaCommands.controlSystemMedia;
  const targets = createMusicTargetCoordinator(setPlayer);
  const playback = ref<MusicPlaybackState | null>(null);
  const status = ref<MusicSessionStatus>('idle');
  let targetTask = Promise.resolve();
  let generation = 0;
  let running = false;
  let pollTimer: number | null = null;
  let staleTimer: number | null = null;
  let activePromise: Promise<void> | null = null;
  let staleEligible = false;
  let staleMarked = false;
  let targetReady = false;

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
    if (snapshot && snapshot.player !== targets.currentPlayer()) {
      status.value = 'error';
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
    armStaleTimer(expected);
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
      if (isCurrent(expected) && staleEligible && !staleMarked) status.value = 'error';
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
  const resetGeneration = (resetTimeline: boolean): number => {
    generation += 1;
    clearPollTimer();
    clearStaleTimer();
    activePromise = null;
    playback.value = null;
    status.value = 'idle';
    if (resetTimeline) options.timeline.reset();
    if (running) armStaleTimer(generation);
    return generation;
  };
  const syncCommitted = (expected: number): Promise<void> => {
    clearPollTimer();
    return activePromise ?? beginRequest(expected);
  };
  const waitForTarget = async (): Promise<number | null> => {
    try {
      const selection = await targets.waitForCurrent();
      return selection && running ? generation : null;
    } catch {
      if (running) status.value = 'error';
      return null;
    }
  };
  const syncNow = async (): Promise<void> => {
    clearPollTimer();
    const readyGeneration = targetReady ? generation : -1;
    const expected = await waitForTarget();
    if (
      expected !== null &&
      isCurrent(expected) &&
      (!targetReady || readyGeneration === expected)
    ) {
      await syncCommitted(expected);
    }
  };
  const finishTarget = async (
    expectedGeneration: number,
    selection: MusicTargetSelection
  ): Promise<void> => {
    try {
      await selection.committed;
    } catch (error) {
      if (targets.isCurrent(selection) && isCurrent(expectedGeneration)) status.value = 'error';
      throw error;
    }
    if (targets.isCurrent(selection) && isCurrent(expectedGeneration)) {
      await syncCommitted(expectedGeneration);
      if (targets.isCurrent(selection) && isCurrent(expectedGeneration)) targetReady = true;
    }
  };
  const selectTarget = (player: string, resetTimeline: boolean): Promise<void> => {
    const selection = targets.select(player);
    targetReady = false;
    const expectedGeneration = resetGeneration(resetTimeline);
    targetTask = finishTarget(expectedGeneration, selection);
    return targetTask;
  };
  const start = (player: string): Promise<void> => {
    if (running && targets.currentPlayer() === player) return targetTask;
    const restarting = running;
    running = true;
    if (!restarting) options.timeline.start();
    return selectTarget(player, restarting);
  };
  const stop = (): void => {
    if (!running) return;
    running = false;
    generation += 1;
    targets.invalidate();
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
  const setTargetPlayer = (player: string): Promise<void> => selectTarget(player, running);
  const control = async (action: MediaAction): Promise<void> => {
    const expected = await waitForTarget();
    if (expected === null || !isCurrent(expected)) return;
    await controlMedia(action);
    if (!isCurrent(expected)) return;
    clearPollTimer();
    const beforeControlRequest = activePromise;
    if (beforeControlRequest) await beforeControlRequest;
    if (isCurrent(expected)) await beginRequest(expected);
  };
  if (getCurrentScope()) onScopeDispose(stop);
  return { playback, status, start, stop, setTargetPlayer, syncNow, control };
};
