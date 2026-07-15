import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicPlaybackState } from '@/shared/ipc/contracts';
import { usePlaybackTimeline } from './usePlaybackTimeline';

const playback = (patch: Partial<MusicPlaybackState> = {}): MusicPlaybackState => ({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  sourceAppId: 'qqmusic',
  player: 'qqmusic',
  isPlaying: true,
  canSeek: true,
  durationMs: 269_000,
  positionMs: 10_000,
  timelineUpdatedAtMs: 1_000,
  snapshotTakenAtMs: 1_000,
  ...patch,
});

describe('usePlaybackTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('同步快照后立即发布当前位置', () => {
    const timeline = usePlaybackTimeline();

    timeline.sync(playback());

    expect(timeline.positionMs.value).toBe(10_000);
  });

  it('启动后每一百毫秒刷新响应式位置', () => {
    const timeline = usePlaybackTimeline();
    timeline.sync(playback());

    timeline.start();
    vi.advanceTimersByTime(300);

    expect(timeline.positionMs.value).toBe(10_300);
  });

  it('重复启动不会创建多个刷新定时器', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const timeline = usePlaybackTimeline();

    timeline.start();
    timeline.start();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('停止后清除定时器并停止刷新位置', () => {
    const timeline = usePlaybackTimeline();
    timeline.sync(playback());
    timeline.start();
    vi.advanceTimersByTime(100);

    timeline.stop();
    vi.advanceTimersByTime(500);

    expect(timeline.positionMs.value).toBe(10_100);
  });

  it('标记陈旧后冻结当前位置', () => {
    const timeline = usePlaybackTimeline();
    timeline.sync(playback());
    timeline.start();
    vi.advanceTimersByTime(300);

    timeline.markStale();
    vi.advanceTimersByTime(500);

    expect(timeline.positionMs.value).toBe(10_300);
  });

  it('重置后清空当前位置', () => {
    const timeline = usePlaybackTimeline();
    timeline.sync(playback());

    timeline.reset();

    expect(timeline.positionMs.value).toBeNull();
  });

  it('响应式作用域销毁时停止刷新', () => {
    const scope = effectScope();
    const timeline = scope.run(() => usePlaybackTimeline());
    if (!timeline) throw new Error('未能创建播放时间线');
    timeline.sync(playback());
    timeline.start();
    vi.advanceTimersByTime(100);

    scope.stop();
    vi.advanceTimersByTime(500);

    expect(timeline.positionMs.value).toBe(10_100);
  });
});
