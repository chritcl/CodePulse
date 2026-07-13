import { getCurrentScope, onScopeDispose } from 'vue';
import type { MediaAction, MusicPlaybackState } from '@/shared/ipc/contracts';
import { mediaCommands } from '@/shared/ipc/commands';
import {
  createMusicPlaybackRuntime,
  type MusicPlaybackRuntimeContext,
} from './musicPlaybackRuntime';
import { createMusicTargetCoordinator, type MusicTargetSelection } from './musicTargetCoordinator';
import type { PlaybackTimelineController } from './usePlaybackTimeline';

export type { MusicSessionStatus } from './musicPlaybackRuntime';

export interface UseMusicPlaybackSessionOptions {
  timeline: PlaybackTimelineController;
  getPlayback?: () => Promise<MusicPlaybackState | null>;
  setPlayer?: (player: string) => Promise<void>;
  controlMedia?: (action: MediaAction) => Promise<void>;
}

interface TargetContext extends MusicPlaybackRuntimeContext {
  selection: MusicTargetSelection;
  ready: boolean;
}

/** 统一管理目标提交、快照轮询和播放控制 */
export const useMusicPlaybackSession = (options: UseMusicPlaybackSessionOptions) => {
  const getPlayback = options.getPlayback ?? mediaCommands.getMusicPlaybackState;
  const setPlayer = options.setPlayer ?? mediaCommands.setTargetPlayer;
  const controlMedia = options.controlMedia ?? mediaCommands.controlSystemMedia;
  const targets = createMusicTargetCoordinator(setPlayer);
  const runtime = createMusicPlaybackRuntime({ timeline: options.timeline, getPlayback });
  let targetContext: TargetContext | null = null;
  let targetTask = Promise.resolve();
  let generation = 0;
  let running = false;

  const isCurrent = (context: TargetContext): boolean =>
    running && targetContext === context && runtime.isCurrent(context);

  const finishTarget = async (context: TargetContext): Promise<void> => {
    try {
      await context.selection.committed;
    } catch (error) {
      runtime.markFailure(context);
      throw error;
    }
    if (!isCurrent(context)) return;
    await runtime.sync(context);
    if (isCurrent(context)) context.ready = true;
  };

  const selectTarget = (player: string, resetTimeline: boolean): Promise<void> => {
    const selection = targets.select(player);
    const context = { selection, player, generation: ++generation, ready: false };
    targetContext = context;
    if (running) runtime.activate(context, resetTimeline);
    targetTask = finishTarget(context);
    return targetTask;
  };

  const start = (player: string): Promise<void> => {
    if (running && targetContext?.player === player) return targetTask;
    const restarting = running;
    running = true;
    if (!restarting) options.timeline.start();
    return selectTarget(player, restarting);
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    generation += 1;
    targetContext = null;
    targets.invalidate();
    runtime.invalidate();
    options.timeline.stop();
  };

  const setTargetPlayer = (player: string): Promise<void> => selectTarget(player, running);

  const syncNow = async (): Promise<void> => {
    const context = targetContext;
    if (!context || !isCurrent(context)) return;
    const readyAtCall = context.ready;
    try {
      await context.selection.committed;
    } catch {
      runtime.markFailure(context);
      return;
    }
    if (!isCurrent(context)) return;
    // 留出同一事件循环中的目标切换微任务，并在恢复后再次校验上下文
    await Promise.resolve();
    if (!isCurrent(context) || (!readyAtCall && context.ready)) return;
    await runtime.sync(context);
  };

  const control = async (action: MediaAction): Promise<void> => {
    const context = targetContext;
    if (!context || !isCurrent(context)) return;
    const operation = targets.enqueueOperation(context.selection, () => controlMedia(action));
    const executed = await operation;
    if (!executed || !isCurrent(context)) return;
    await runtime.forceFresh(context);
  };

  if (getCurrentScope()) onScopeDispose(stop);
  return {
    playback: runtime.playback,
    status: runtime.status,
    start,
    stop,
    setTargetPlayer,
    syncNow,
    control,
  };
};
