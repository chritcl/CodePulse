import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue';
import type { MusicPlaybackState } from '@/shared/ipc/contracts';
import {
  createPlaybackTimelineClock,
  type TimelineReceivedAt,
} from '@/modules/island/playbackTimeline';

export interface PlaybackTimelineController {
  positionMs: Ref<number | null>;
  sync(snapshot: MusicPlaybackState): void;
  reset(): void;
  markStale(): void;
  start(): void;
  stop(): void;
}

const REFRESH_INTERVAL_MS = 100;

const getReceivedAt = (): TimelineReceivedAt => ({
  epochMs: Date.now(),
  monotonicMs: performance.now(),
});

/** 将唯一播放时钟包装为每一百毫秒刷新的响应式位置 */
export const usePlaybackTimeline = (): PlaybackTimelineController => {
  const clock = createPlaybackTimelineClock();
  const positionMs = ref<number | null>(null);
  let timer: number | null = null;

  const refresh = (monotonicMs = performance.now()): void => {
    positionMs.value = clock.getPosition(monotonicMs);
  };

  const sync = (snapshot: MusicPlaybackState): void => {
    const receivedAt = getReceivedAt();
    clock.sync(snapshot, receivedAt);
    refresh(receivedAt.monotonicMs);
  };

  const reset = (): void => {
    clock.reset();
    positionMs.value = null;
  };

  const markStale = (): void => {
    const monotonicMs = performance.now();
    clock.markStale(monotonicMs);
    refresh(monotonicMs);
  };

  const start = (): void => {
    if (timer !== null) return;
    refresh();
    timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
  };

  const stop = (): void => {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  };

  if (getCurrentScope()) {
    onScopeDispose(stop);
  }

  return { positionMs, sync, reset, markStale, start, stop };
};
