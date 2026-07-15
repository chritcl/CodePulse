import { describe, expect, it, vi } from 'vitest';
import type { MusicPlaybackState } from '@/shared/ipc/contracts';
import { useTrackCover } from './useTrackCover';

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

describe('useTrackCover', () => {
  it('专辑和时长补全不会重复获取同一播放会话的封面', async () => {
    const getCover = vi.fn().mockResolvedValue('封面');
    const cover = useTrackCover({ getCover });

    await cover.load(playback({ album: undefined, durationMs: undefined }));
    await cover.load(playback({ album: '补全专辑', durationMs: 270_000 }));

    expect(getCover).toHaveBeenCalledTimes(1);
    expect(cover.coverUrl.value).toBe('封面');
  });

  it('歌曲 A 的迟到成功不能覆盖歌曲 B', async () => {
    const first = deferred<string>();
    const getCover = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce('封面 B');
    const cover = useTrackCover({ getCover });

    const firstLoad = cover.load(playback({ title: '歌曲 A' }));
    await cover.load(playback({ title: '歌曲 B' }));
    first.resolve('封面 A');
    await firstLoad;

    expect(cover.coverUrl.value).toBe('封面 B');
  });

  it('歌曲 A 的迟到失败不能清空歌曲 B', async () => {
    const first = deferred<string>();
    const getCover = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce('封面 B');
    const cover = useTrackCover({ getCover });

    const firstLoad = cover.load(playback({ title: '歌曲 A' }));
    await cover.load(playback({ title: '歌曲 B' }));
    first.reject(new Error('歌曲 A 获取失败'));
    await firstLoad;

    expect(cover.coverUrl.value).toBe('封面 B');
  });

  it('重置会使未完成请求失效但保留封面缓存', async () => {
    const pending = deferred<string>();
    const getCover = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce('已缓存封面');
    const cover = useTrackCover({ getCover });

    const pendingLoad = cover.load(playback({ title: '缓慢歌曲' }));
    cover.reset();
    pending.resolve('不应写入');
    await pendingLoad;
    expect(cover.coverUrl.value).toBe('');

    await cover.load(playback({ title: '缓存歌曲' }));
    cover.reset();
    await cover.load(playback({ title: '缓存歌曲' }));
    expect(getCover).toHaveBeenCalledTimes(2);
    expect(cover.coverUrl.value).toBe('已缓存封面');
  });

  it('销毁后永久忽略请求、清空展示并拒绝继续加载', async () => {
    const pending = deferred<string>();
    const getCover = vi.fn(() => pending.promise);
    const cover = useTrackCover({ getCover });

    const load = cover.load(playback());
    cover.dispose();
    pending.resolve('不应写入');
    await load;
    await cover.load(playback({ title: '另一首歌' }));

    expect(cover.coverUrl.value).toBe('');
    expect(getCover).toHaveBeenCalledTimes(1);
  });

  it('封面缓存最多保留五十首并按最近使用淘汰', async () => {
    const getCover = vi.fn((title: string) => Promise.resolve(`${title}封面`));
    const cover = useTrackCover({ getCover });

    for (let index = 1; index <= 51; index += 1) {
      await cover.load(playback({ title: `歌曲 ${index}` }));
    }
    await cover.load(playback({ title: '歌曲 2' }));
    expect(getCover).toHaveBeenCalledTimes(51);

    await cover.load(playback({ title: '歌曲 1' }));
    expect(getCover).toHaveBeenCalledTimes(52);
  });
});
