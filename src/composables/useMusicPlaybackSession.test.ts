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
  canSeek: true,
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
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const createSession = (
  options: Parameters<typeof useMusicPlaybackSession>[0]
): ReturnType<typeof useMusicPlaybackSession> =>
  useMusicPlaybackSession({ setPlayer: vi.fn().mockResolvedValue(undefined), ...options });

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
    const session = createSession({ timeline, getPlayback });

    session.start('qqmusic');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(getPlayback).toHaveBeenCalledTimes(1);
  });

  it('首个请求永不完成时三秒后独立冻结时间线', async () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const session = createSession({ timeline, getPlayback: () => first.promise });

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
    const session = createSession({ timeline, getPlayback: () => first.promise });
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
    const session = createSession({ timeline, getPlayback: () => first.promise });

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
    const setPlayer = vi
      .fn<(player: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => targetSet.promise);
    const session = createSession({ timeline, getPlayback, setPlayer });

    session.start('qqmusic');
    await flushPromises();
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
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => firstSwitch.promise)
      .mockResolvedValueOnce(undefined);
    const session = createSession({ timeline, getPlayback, setPlayer });

    session.start('qqmusic');
    await flushPromises();
    const olderSwitch = session.setTargetPlayer('netease');
    const latestSwitch = session.setTargetPlayer('spotify');
    await flushPromises();

    expect(setPlayer).toHaveBeenCalledTimes(2);
    initialRequest.resolve(playback({ title: '过期初始歌曲' }));
    firstSwitch.resolve();
    await Promise.all([olderSwitch, latestSwitch]);

    expect(setPlayer).toHaveBeenNthCalledWith(3, 'spotify');
    expect(getPlayback).toHaveBeenCalledTimes(2);
    expect(session.playback.value).toEqual(spotifySnapshot);
  });

  it('切换播放器失败后也不允许旧快照恢复回写', async () => {
    const timeline = createTimeline();
    const oldRequest = deferred<MusicPlaybackState | null>();
    const setPlayer = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('切换失败'));
    const session = createSession({
      timeline,
      getPlayback: () => oldRequest.promise,
      setPlayer,
    });

    session.start('qqmusic');
    await flushPromises();
    const switching = session.setTargetPlayer('netease');
    oldRequest.resolve(playback({ title: '旧播放器歌曲' }));

    await expect(switching).rejects.toThrow('切换失败');
    await flushPromises();
    expect(session.playback.value).toBeNull();
    expect(timeline.sync).not.toHaveBeenCalled();
  });

  it('首次启动必须等待后端提交目标后再取快照', async () => {
    const timeline = createTimeline();
    const targetCommit = deferred<void>();
    const snapshot = playback();
    const setPlayer = vi.fn(() => targetCommit.promise);
    const getPlayback = vi.fn().mockResolvedValue(snapshot);
    const session = createSession({ timeline, setPlayer, getPlayback });

    const starting = session.start('qqmusic');
    await flushPromises();

    expect(setPlayer).toHaveBeenCalledWith('qqmusic');
    expect(getPlayback).not.toHaveBeenCalled();

    targetCommit.resolve();
    await starting;
    expect(getPlayback).toHaveBeenCalledTimes(1);
    expect(session.playback.value).toEqual(snapshot);
  });

  it('运行中使用不同播放器启动也必须先提交目标', async () => {
    const timeline = createTimeline();
    const secondCommit = deferred<void>();
    const neteaseSnapshot = playback({ player: 'netease', title: '新目标歌曲' });
    const setPlayer = vi
      .fn<(player: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => secondCommit.promise);
    const getPlayback = vi
      .fn()
      .mockResolvedValueOnce(playback())
      .mockResolvedValueOnce(neteaseSnapshot);
    const session = createSession({ timeline, setPlayer, getPlayback });

    await session.start('qqmusic');
    const restarting = session.start('netease');
    await flushPromises();

    expect(setPlayer).toHaveBeenNthCalledWith(2, 'netease');
    expect(getPlayback).toHaveBeenCalledTimes(1);

    secondCommit.resolve();
    await restarting;
    expect(session.playback.value).toEqual(neteaseSnapshot);
  });

  it('旧目标提交跨越停止和重启时新目标必须最后写入', async () => {
    const timeline = createTimeline();
    const oldCommit = deferred<void>();
    const setPlayer = vi
      .fn<(player: string) => Promise<void>>()
      .mockImplementationOnce(() => oldCommit.promise)
      .mockResolvedValueOnce(undefined);
    const qqSnapshot = playback({ title: '重启后歌曲' });
    const getPlayback = vi.fn().mockResolvedValue(qqSnapshot);
    const session = createSession({ timeline, setPlayer, getPlayback });

    const oldStart = session.start('netease');
    await flushPromises();
    session.stop();
    const restarted = session.start('qqmusic');
    await flushPromises();

    expect(setPlayer).toHaveBeenCalledTimes(1);
    expect(getPlayback).not.toHaveBeenCalled();

    oldCommit.resolve();
    await Promise.all([oldStart, restarted]);
    expect(setPlayer).toHaveBeenNthCalledWith(2, 'qqmusic');
    expect(getPlayback).toHaveBeenCalledTimes(1);
    expect(session.playback.value).toEqual(qqSnapshot);
  });

  it('目标提交期间立即同步和控制都必须等待屏障', async () => {
    const timeline = createTimeline();
    const switchCommit = deferred<void>();
    const switchedSnapshot = playback({ player: 'netease', positionMs: 20_000 });
    const controlledSnapshot = playback({ player: 'netease', positionMs: 21_000 });
    const setPlayer = vi
      .fn<(player: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => switchCommit.promise);
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockResolvedValueOnce(playback())
      .mockResolvedValueOnce(switchedSnapshot)
      .mockResolvedValueOnce(controlledSnapshot);
    const controlMedia = vi.fn().mockResolvedValue(undefined);
    const session = createSession({ timeline, setPlayer, getPlayback, controlMedia });

    await session.start('qqmusic');
    const switching = session.setTargetPlayer('netease');
    const syncing = session.syncNow();
    const controlling = session.control('next');
    await flushPromises();

    expect(getPlayback).toHaveBeenCalledTimes(1);
    expect(controlMedia).not.toHaveBeenCalled();

    switchCommit.resolve();
    await Promise.all([switching, syncing, controlling]);
    expect(controlMedia).toHaveBeenCalledWith('next');
    expect(getPlayback).toHaveBeenCalledTimes(3);
    expect(session.playback.value).toEqual(controlledSnapshot);
  });

  it('同目标切换失败后重试成功会恢复立即同步', async () => {
    const timeline = createTimeline();
    const recoveredSnapshot = playback({ player: 'netease', title: '恢复后歌曲' });
    const setPlayer = vi
      .fn<(player: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('首次失败'))
      .mockResolvedValueOnce(undefined);
    const getPlayback = vi
      .fn()
      .mockResolvedValueOnce(playback())
      .mockResolvedValueOnce(recoveredSnapshot);
    const session = createSession({ timeline, setPlayer, getPlayback });

    await session.start('qqmusic');
    await expect(session.setTargetPlayer('netease')).rejects.toThrow('首次失败');
    await session.setTargetPlayer('netease');

    expect(setPlayer).toHaveBeenCalledTimes(3);
    expect(getPlayback).toHaveBeenCalledTimes(2);
    expect(session.playback.value).toEqual(recoveredSnapshot);
  });

  it('两个同目标并发选择只在最新提交后恢复同步', async () => {
    const timeline = createTimeline();
    const firstSameCommit = deferred<void>();
    const latestSnapshot = playback({ title: '最新同目标歌曲' });
    const setPlayer = vi
      .fn<(player: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => firstSameCommit.promise)
      .mockResolvedValueOnce(undefined);
    const getPlayback = vi
      .fn()
      .mockResolvedValueOnce(playback())
      .mockResolvedValueOnce(latestSnapshot);
    const session = createSession({ timeline, setPlayer, getPlayback });

    await session.start('qqmusic');
    const olderSelection = session.setTargetPlayer('qqmusic');
    const latestSelection = session.setTargetPlayer('qqmusic');
    await flushPromises();

    expect(setPlayer).toHaveBeenCalledTimes(2);
    expect(getPlayback).toHaveBeenCalledTimes(1);

    firstSameCommit.resolve();
    await Promise.all([olderSelection, latestSelection]);
    expect(setPlayer).toHaveBeenCalledTimes(3);
    expect(getPlayback).toHaveBeenCalledTimes(2);
    expect(session.playback.value).toEqual(latestSnapshot);
  });

  it('快照播放器与当前目标不一致时拒绝回写', async () => {
    const timeline = createTimeline();
    const mismatched = playback({ player: 'netease', title: '错误播放器歌曲' });
    const session = createSession({ timeline, getPlayback: vi.fn().mockResolvedValue(mismatched) });

    await session.start('qqmusic');

    expect(session.playback.value).toBeNull();
    expect(session.status.value).toBe('error');
    expect(timeline.sync).not.toHaveBeenCalled();
  });

  it('控制已发出时后续目标写入必须等待控制完成', async () => {
    const timeline = createTimeline();
    const controlDone = deferred<void>();
    const events: string[] = [];
    const setPlayer = vi.fn(async (player: string) => {
      events.push(`写入:${player}`);
    });
    const controlMedia = vi.fn(async () => {
      events.push('控制:开始');
      await controlDone.promise;
      events.push('控制:结束');
    });
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockResolvedValueOnce(playback())
      .mockResolvedValueOnce(playback({ player: 'netease', title: '切换后歌曲' }));
    const session = createSession({ timeline, setPlayer, controlMedia, getPlayback });

    await session.start('qqmusic');
    const controlling = session.control('next');
    await flushPromises();
    const switching = session.setTargetPlayer('netease');
    await flushPromises();

    expect(setPlayer).toHaveBeenCalledTimes(1);
    controlDone.resolve();
    await Promise.all([controlling, switching]);
    expect(events).toEqual(['写入:qqmusic', '控制:开始', '控制:结束', '写入:netease']);
    expect(session.playback.value?.player).toBe('netease');
  });

  it('立即同步等待恢复的下一微任务切换目标不能越过新屏障', async () => {
    const timeline = createTimeline();
    const switchCommit = deferred<void>();
    const neteaseSnapshot = playback({ player: 'netease', title: '新屏障歌曲' });
    const setPlayer = vi
      .fn<(player: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => switchCommit.promise);
    const getPlayback = vi
      .fn()
      .mockResolvedValueOnce(playback())
      .mockResolvedValueOnce(neteaseSnapshot);
    const session = createSession({ timeline, setPlayer, getPlayback });

    await session.start('qqmusic');
    const syncing = session.syncNow();
    let switching!: Promise<void>;
    await Promise.resolve().then(() => {
      switching = session.setTargetPlayer('netease');
    });
    await flushPromises();

    expect(getPlayback).toHaveBeenCalledTimes(1);
    switchCommit.resolve();
    await Promise.all([syncing, switching]);
    expect(getPlayback).toHaveBeenCalledTimes(2);
    expect(session.playback.value).toEqual(neteaseSnapshot);
  });

  it('控制后强制快照挂起超过一秒也不会被旧轮询并发', async () => {
    const timeline = createTimeline();
    const beforeControl = deferred<MusicPlaybackState | null>();
    const forcedSnapshot = deferred<MusicPlaybackState | null>();
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockImplementationOnce(() => beforeControl.promise)
      .mockImplementationOnce(() => forcedSnapshot.promise)
      .mockResolvedValue(playback({ positionMs: 30_000 }));
    const controlMedia = vi.fn().mockResolvedValue(undefined);
    const session = createSession({ timeline, getPlayback, controlMedia });

    const starting = session.start('qqmusic');
    await flushPromises();
    const controlling = session.control('play_pause');
    await flushPromises();
    beforeControl.resolve(playback({ isPlaying: false }));
    await flushPromises();

    expect(getPlayback).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(getPlayback).toHaveBeenCalledTimes(2);

    forcedSnapshot.resolve(playback({ isPlaying: true, positionMs: 15_000 }));
    await Promise.all([starting, controlling]);
  });

  it('目标提交在陈旧后迟到失败不能覆盖 stale', async () => {
    const timeline = createTimeline();
    const targetCommit = deferred<void>();
    const session = createSession({
      timeline,
      setPlayer: () => targetCommit.promise,
      getPlayback: vi.fn(),
    });

    const starting = session.start('qqmusic');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(session.status.value).toBe('stale');

    targetCommit.reject(new Error('目标迟到失败'));
    await expect(starting).rejects.toThrow('目标迟到失败');
    expect(session.status.value).toBe('stale');
  });

  it('持续返回不匹配快照超过三秒后保持 stale', async () => {
    const timeline = createTimeline();
    const mismatched = playback({ player: 'netease', title: '不匹配歌曲' });
    const session = createSession({
      timeline,
      getPlayback: vi.fn().mockResolvedValue(mismatched),
    });

    await session.start('qqmusic');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(session.status.value).toBe('stale');
    expect(timeline.markStale).toHaveBeenCalledTimes(1);
    expect(timeline.sync).not.toHaveBeenCalled();
  });

  it('同一播放器重复启动不会创建双轮询', async () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const getPlayback = vi.fn(() => first.promise);
    const session = createSession({ timeline, getPlayback });

    session.start('qqmusic');
    session.start('qqmusic');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(getPlayback).toHaveBeenCalledTimes(1);
    expect(timeline.start).toHaveBeenCalledTimes(1);
  });

  it('重复停止会话不会重复清理时间线', () => {
    const timeline = createTimeline();
    const first = deferred<MusicPlaybackState | null>();
    const session = createSession({ timeline, getPlayback: () => first.promise });

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
    const session = createSession({ timeline, getPlayback });

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
    const session = createSession({ timeline, getPlayback, controlMedia });

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

  it('跳转成功后立即刷新播放快照', async () => {
    const timeline = createTimeline();
    const seekMedia = vi.fn().mockResolvedValue(true);
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockResolvedValueOnce(playback())
      .mockResolvedValueOnce(playback({ positionMs: 42_000 }));
    const session = createSession({ timeline, getPlayback, seekMedia });

    await session.start('qqmusic');
    const succeeded = await session.seek(42_000);

    expect(succeeded).toBe(true);
    expect(seekMedia).toHaveBeenCalledWith(42_000);
    expect(getPlayback).toHaveBeenCalledTimes(2);
    expect(session.playback.value?.positionMs).toBe(42_000);
  });

  it('播放器拒绝跳转时保留当前快照且不额外刷新', async () => {
    const timeline = createTimeline();
    const snapshot = playback({ positionMs: 10_000 });
    const seekMedia = vi.fn().mockResolvedValue(false);
    const getPlayback = vi.fn().mockResolvedValue(snapshot);
    const session = createSession({ timeline, getPlayback, seekMedia });

    await session.start('qqmusic');
    const succeeded = await session.seek(42_000);

    expect(succeeded).toBe(false);
    expect(getPlayback).toHaveBeenCalledTimes(1);
    expect(session.playback.value).toEqual(snapshot);
  });

  it('跳转执行期间切换目标会等待旧操作结束并让跳转返回失败', async () => {
    const timeline = createTimeline();
    const seekDone = deferred<boolean>();
    const events: string[] = [];
    const setPlayer = vi.fn(async (player: string) => {
      events.push(`写入:${player}`);
    });
    const seekMedia = vi.fn(async () => {
      events.push('跳转:开始');
      const succeeded = await seekDone.promise;
      events.push('跳转:结束');
      return succeeded;
    });
    const getPlayback = vi
      .fn<() => Promise<MusicPlaybackState | null>>()
      .mockResolvedValueOnce(playback())
      .mockResolvedValueOnce(playback({ player: 'netease', title: '切换后歌曲' }));
    const session = createSession({ timeline, setPlayer, seekMedia, getPlayback });

    await session.start('qqmusic');
    const seeking = session.seek(42_000);
    await flushPromises();
    const switching = session.setTargetPlayer('netease');
    await flushPromises();

    expect(setPlayer).toHaveBeenCalledTimes(1);
    seekDone.resolve(true);
    await switching;

    await expect(seeking).resolves.toBe(false);
    expect(events).toEqual(['写入:qqmusic', '跳转:开始', '跳转:结束', '写入:netease']);
    expect(session.playback.value?.player).toBe('netease');
  });

  it('播放控制失败时保持快照且不触发同步', async () => {
    const timeline = createTimeline();
    const snapshot = playback({ isPlaying: false });
    const getPlayback = vi.fn().mockResolvedValue(snapshot);
    const controlMedia = vi.fn().mockRejectedValue(new Error('控制失败'));
    const session = createSession({ timeline, getPlayback, controlMedia });

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
    const session = createSession({ timeline, getPlayback });

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
    const session = scope.run(() => createSession({ timeline, getPlayback: () => first.promise }));
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
