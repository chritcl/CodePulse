import { effectScope, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaAction, MusicPlaybackState } from '@/shared/ipc/contracts';
import type { PlaybackTimelineController } from './usePlaybackTimeline';
import { useMusicPlaybackSession } from './useMusicPlaybackSession';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const playback = (patch: Partial<MusicPlaybackState> = {}): MusicPlaybackState => ({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  sourceAppId: 'qqmusic',
  player: 'qqmusic',
  isPlaying: true,
  durationMs: 269_000,
  positionMs: 10_000,
  timelineUpdatedAtMs: 1_000,
  snapshotTakenAtMs: 1_000,
  ...patch,
});

const createTimeline = (): PlaybackTimelineController => ({
  positionMs: ref<number | null>(null),
  sync: vi.fn(),
  reset: vi.fn(),
  markStale: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
});

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useMusicPlaybackSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('本次同步完成后才安排下一次轮询', async () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const getPlayback = vi.fn(() => first.promise);
    const session = useMusicPlaybackSession({ timeline, getPlayback });

    session.start('qqmusic');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(getPlayback).toHaveBeenCalledTimes(1);
  });

  it('首个请求永不完成时三秒后独立冻结时间线', async () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const session = useMusicPlaybackSession({ timeline, getPlayback: () => first.promise });

    session.start('qqmusic');
    await vi.advanceTimersByTimeAsync(2_999);
    expect(timeline.markStale).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(timeline.markStale).toHaveBeenCalledTimes(1);
    expect(session.status.value).toBe('stale');
  });

  it('陈旧后收到成功快照会重新锚定', async () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const session = useMusicPlaybackSession({ timeline, getPlayback: () => first.promise });
    const snapshot = playback();

    session.start('qqmusic');
    await vi.advanceTimersByTimeAsync(3_000);
    first.resolve(snapshot);
    await flushPromises();

    expect(timeline.sync).toHaveBeenCalledWith(snapshot);
    expect(session.playback.value).toEqual(snapshot);
    expect(session.status.value).toBe('ready');
  });

  it('停止后旧响应不能回写且清理时间线', async () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const session = useMusicPlaybackSession({ timeline, getPlayback: () => first.promise });

    session.start('qqmusic');
    session.stop();
    first.resolve(playback());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(session.playback.value).toBeNull();
    expect(session.status.value).toBe('idle');
    expect(timeline.sync).not.toHaveBeenCalled();
    expect(timeline.reset).toHaveBeenCalledTimes(1);
    expect(timeline.stop).toHaveBeenCalledTimes(1);
    expect(timeline.markStale).not.toHaveBeenCalled();
  });

  it('切换播放器后旧快照不能回写且新同步不被阻塞', async () => {
    const timeline = createTimeline();
    const oldRequest = deferred<MusicPlaybackState | null>();
    const newSnapshot = playback({ player: 'netease', title: '新播放器歌曲' });
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockResolvedValueOnce(newSnapshot);
    const targetSet = deferred<void>();
    const setPlayer = vi.fn(() => targetSet.promise);
    const session = useMusicPlaybackSession({ timeline, getPlayback, setPlayer });

    session.start('qqmusic');
    const switching = session.setTargetPlayer('netease');
    oldRequest.resolve(playback({ title: '旧播放器歌曲' }));
    await flushPromises();

    expect(session.playback.value).toBeNull();
    expect(timeline.sync).not.toHaveBeenCalled();
    expect(getPlayback).toHaveBeenCalledTimes(1);

    targetSet.resolve();
    await switching;

    expect(setPlayer).toHaveBeenCalledWith('netease');
    expect(getPlayback).toHaveBeenCalledTimes(2);
    expect(session.playback.value?.title).toBe('新播放器歌曲');
  });

  it('并发切换播放器时只接受最后一次选择', async () => {
    const timeline = createTimeline();
    const initialRequest = deferred<MusicPlaybackState | null>();
    const firstSwitch = deferred<void>();
    const spotifySnapshot = playback({ player: 'spotify', title: '最新选择歌曲' });
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockImplementationOnce(() => initialRequest.promise)
      .mockResolvedValueOnce(spotifySnapshot)
      .mockResolvedValueOnce(playback({ player: 'netease', title: '过期选择歌曲' }));
    const setPlayer = vi
      .fn<(player: string) => Promise<void>>()
      .mockImplementationOnce(() => firstSwitch.promise)
      .mockResolvedValueOnce(undefined);
    const session = useMusicPlaybackSession({ timeline, getPlayback, setPlayer });

    session.start('qqmusic');
    const olderSwitch = session.setTargetPlayer('netease');
    await session.setTargetPlayer('spotify');
    firstSwitch.resolve();
    await olderSwitch;

    expect(getPlayback).toHaveBeenCalledTimes(2);
    expect(session.playback.value).toEqual(spotifySnapshot);
  });

  it('切换播放器失败后也不允许旧快照恢复回写', async () => {
    const timeline = createTimeline();
    const oldRequest = deferred<MusicPlaybackState | null>();
    const setPlayer = vi.fn().mockRejectedValue(new Error('切换失败'));
    const session = useMusicPlaybackSession({
      timeline,
      getPlayback: () => oldRequest.promise,
      setPlayer,
    });

    session.start('qqmusic');
    const switching = session.setTargetPlayer('netease');
    oldRequest.resolve(playback({ title: '旧播放器歌曲' }));

    await expect(switching).rejects.toThrow('切换失败');
    await flushPromises();
    expect(session.playback.value).toBeNull();
    expect(timeline.sync).not.toHaveBeenCalled();
  });

  it('同一播放器重复启动不会创建双轮询', async () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const getPlayback = vi.fn(() => first.promise);
    const session = useMusicPlaybackSession({ timeline, getPlayback });

    session.start('qqmusic');
    session.start('qqmusic');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(getPlayback).toHaveBeenCalledTimes(1);
    expect(timeline.start).toHaveBeenCalledTimes(1);
  });

  it('重复停止会话不会重复清理时间线', () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const session = useMusicPlaybackSession({ timeline, getPlayback: () => first.promise });

    session.start('qqmusic');
    session.stop();
    session.stop();

    expect(timeline.reset).toHaveBeenCalledTimes(1);
    expect(timeline.stop).toHaveBeenCalledTimes(1);
  });

  it('立即同步会清除待执行轮询并合并并发请求', async () => {
    const timeline = createTimeline();
    const second = deferred<MusicPlaybackState | null>();
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockResolvedValueOnce(playback())
      .mockImplementationOnce(() => second.promise);
    const session = useMusicPlaybackSession({ timeline, getPlayback });

    session.start('qqmusic');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    const syncOne = session.syncNow();
    const syncTwo = session.syncNow();
    await vi.advanceTimersByTimeAsync(500);

    expect(getPlayback).toHaveBeenCalledTimes(2);
    second.resolve(playback({ positionMs: 12_000 }));
    await Promise.all([syncOne, syncTwo]);
    expect(timeline.sync).toHaveBeenLastCalledWith(playback({ positionMs: 12_000 }));
  });

  it('播放控制在既有请求中时必须排队获取控制后快照', async () => {
    const timeline = createTimeline();
    const beforeControl = deferred<MusicPlaybackState | null>();
    const afterControl = deferred<MusicPlaybackState | null>();
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockImplementationOnce(() => beforeControl.promise)
      .mockImplementationOnce(() => afterControl.promise);
    const controlMedia = vi
      .fn<(action: MediaAction) => Promise<void>>()
      .mockResolvedValue(undefined);
    const session = useMusicPlaybackSession({ timeline, getPlayback, controlMedia });

    session.start('qqmusic');
    const controlPromise = session.control('play_pause');
    await flushPromises();
    expect(getPlayback).toHaveBeenCalledTimes(1);

    beforeControl.resolve(playback({ isPlaying: false }));
    await flushPromises();
    expect(getPlayback).toHaveBeenCalledTimes(2);

    const controlledSnapshot = playback({ isPlaying: true, positionMs: 13_000 });
    afterControl.resolve(controlledSnapshot);
    await controlPromise;
    expect(session.playback.value).toEqual(controlledSnapshot);
  });

  it('播放控制失败时保持快照且不触发同步', async () => {
    const timeline = createTimeline();
    const snapshot = playback({ isPlaying: false });
    const getPlayback = vi.fn().mockResolvedValue(snapshot);
    const controlMedia = vi.fn().mockRejectedValue(new Error('控制失败'));
    const session = useMusicPlaybackSession({ timeline, getPlayback, controlMedia });

    session.start('qqmusic');
    await flushPromises();
    await expect(session.control('play_pause')).rejects.toThrow('控制失败');

    expect(session.playback.value).toEqual(snapshot);
    expect(getPlayback).toHaveBeenCalledTimes(1);
  });

  it('成功空快照会回到空闲且不继续累计陈旧', async () => {
    const timeline = createTimeline();
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValue(new Error('SMTC 不可用'));
    const session = useMusicPlaybackSession({ timeline, getPlayback });

    session.start('qqmusic');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(session.playback.value).toBeNull();
    expect(session.status.value).toBe('idle');
    expect(timeline.reset).toHaveBeenCalledTimes(1);
    expect(timeline.markStale).not.toHaveBeenCalled();
  });

  it('作用域卸载会停止会话并隔离旧响应', async () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const scope = effectScope();
    const session = scope.run(() =>
      useMusicPlaybackSession({ timeline, getPlayback: () => first.promise })
    );
    if (!session) throw new Error('未能创建音乐会话');

    session.start('qqmusic');
    scope.stop();
    first.resolve(playback());
    await flushPromises();

    expect(session.playback.value).toBeNull();
    expect(timeline.sync).not.toHaveBeenCalled();
    expect(timeline.stop).toHaveBeenCalledTimes(1);
    expect(timeline.reset).toHaveBeenCalledTimes(1);
  });
});
