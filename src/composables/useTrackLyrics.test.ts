import { effectScope, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LyricLine,
  LyricsRequest,
  LyricsResponse,
  MusicPlaybackState,
} from '@/shared/ipc/contracts';
import { useTrackLyrics } from './useTrackLyrics';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const ready = (text: string, startMs = 0): LyricsResponse => ({
  status: 'ready',
  trackKey: text,
  provider: 'fake',
  source: 'online',
  confidence: 1,
  retryable: false,
  lines: [{ index: 0, startMs, text }],
});

const notFound = (): LyricsResponse => ({
  status: 'not_found',
  trackKey: 'missing',
  provider: 'none',
  source: 'online',
  confidence: 0,
  retryable: false,
  lines: [],
});

const errorResponse = (retryable: boolean): LyricsResponse => ({
  status: 'error',
  trackKey: 'failed',
  provider: 'none',
  source: 'online',
  confidence: 0,
  retryable,
  errorCode: 'upstream',
  lines: [],
});

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

describe('useTrackLyrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('同一播放会话并发加载只发出一个请求', async () => {
    const request = deferred<LyricsResponse>();
    const getLyrics = vi.fn(() => request.promise);
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    const firstLoad = lyrics.load(playback());
    const secondLoad = lyrics.load(playback({ album: '稍后补全', durationMs: 270_000 }));

    expect(getLyrics).toHaveBeenCalledTimes(1);
    expect(lyrics.status.value).toBe('loading');
    request.resolve(ready('同一首歌'));
    await Promise.all([firstLoad, secondLoad]);
    expect(lyrics.currentLyricText.value).toBe('同一首歌');
  });

  it('切歌后丢弃上一首歌的迟到响应', async () => {
    const first = deferred<LyricsResponse>();
    const getLyrics = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(ready('歌曲 B'));
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    void lyrics.load(playback({ title: '歌曲 A' }));
    await lyrics.load(playback({ title: '歌曲 B' }));
    first.resolve(ready('歌曲 A'));
    await Promise.resolve();

    expect(lyrics.currentLyricText.value).toBe('歌曲 B');
    expect(lyrics.status.value).toBe('ready');
  });

  it('可重试错误按一秒和三秒退避后恢复', async () => {
    const getLyrics = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(true))
      .mockResolvedValueOnce(errorResponse(true))
      .mockResolvedValueOnce(ready('已恢复'));
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    void lyrics.load(playback());
    await vi.advanceTimersByTimeAsync(999);
    expect(getLyrics).toHaveBeenCalledTimes(1);
    expect(lyrics.status.value).toBe('retrying');
    await vi.advanceTimersByTimeAsync(1);
    expect(getLyrics).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(getLyrics).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    expect(getLyrics).toHaveBeenCalledTimes(3);
    expect(lyrics.status.value).toBe('ready');
    expect(lyrics.currentLyricText.value).toBe('已恢复');
  });

  it('未找到结果在五分钟内使用负缓存', async () => {
    const getLyrics = vi
      .fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValue(ready('补到歌词'));
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    await lyrics.load(playback());
    await lyrics.load(playback({ title: '另一首歌' }));
    await lyrics.load(playback());
    expect(getLyrics).toHaveBeenCalledTimes(2);
    expect(lyrics.status.value).toBe('not_found');

    await vi.advanceTimersByTimeAsync(300_000);
    await lyrics.load(playback());
    expect(getLyrics).toHaveBeenCalledTimes(3);
    expect(lyrics.status.value).toBe('ready');
  });

  it('不可重试错误不会安排自动重试且同会话重复加载稳定', async () => {
    const getLyrics = vi.fn().mockResolvedValue(errorResponse(false));
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    await lyrics.load(playback());
    await lyrics.load(playback({ album: '补全专辑' }));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(getLyrics).toHaveBeenCalledTimes(1);
    expect(lyrics.status.value).toBe('error');
  });

  it('位置前进和后退都会立即重新匹配当前歌词', async () => {
    const positionMs = ref<number | null>(1_500);
    const getLyrics = vi.fn().mockResolvedValue({
      ...ready('占位'),
      lines: [
        { index: 0, startMs: 0, text: '第一句' },
        { index: 1, startMs: 1_000, text: '第二句' },
        { index: 2, startMs: 2_000, text: '第三句' },
      ],
    });
    const lyrics = useTrackLyrics({ positionMs, getLyrics });

    await lyrics.load(playback());
    expect(lyrics.currentLyricText.value).toBe('第二句');
    expect(lyrics.nextLyricText.value).toBe('第三句');

    positionMs.value = 500;
    expect(lyrics.currentLyricText.value).toBe('第一句');
    expect(lyrics.nextLyricText.value).toBe('第二句');
  });

  it.each<{ name: string; lines: LyricLine[] }>([
    { name: '只有无时间戳纯文本', lines: [{ index: 0, text: '纯文本歌词' }] },
    {
      name: '所有歌词行都无效',
      lines: [
        { index: 0, startMs: -1, text: '负时间' },
        { index: 1, startMs: 1_000, text: '   ' },
      ],
    },
    { name: '歌词行为空', lines: [] },
  ])('就绪响应$name时转为未找到并写入负缓存', async ({ lines: responseLines }) => {
    const invalidReady: LyricsResponse = { ...ready('无效歌词'), lines: responseLines };
    const getLyrics = vi
      .fn()
      .mockResolvedValueOnce(invalidReady)
      .mockResolvedValueOnce(ready('另一首歌'));
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    await lyrics.load(playback());
    expect(lyrics.status.value).toBe('not_found');
    expect(lyrics.lines.value).toEqual([]);
    expect(lyrics.currentLyricText.value).toBe('');
    expect(lyrics.nextLyricText.value).toBe('');

    await lyrics.load(playback({ title: '另一首歌' }));
    await lyrics.load(playback());
    expect(getLyrics).toHaveBeenCalledTimes(2);
    expect(lyrics.status.value).toBe('not_found');
  });

  it('重试时使用同一会话的最新元信息且重复加载不新增请求', async () => {
    const getLyrics = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(true))
      .mockResolvedValueOnce(ready('更新成功'));
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    void lyrics.load(playback());
    await Promise.resolve();
    void lyrics.load(playback({ album: '新专辑', durationMs: 271_000 }));
    expect(getLyrics).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(getLyrics).toHaveBeenCalledTimes(2);
    expect(getLyrics.mock.calls[1]?.[0]).toEqual({
      title: '晴天',
      artist: '周杰伦',
      album: '新专辑',
      durationMs: 271_000,
      player: 'qqmusic',
    });
  });

  it('就绪缓存最多保留五十首并按最近使用淘汰', async () => {
    const getLyrics = vi.fn((request: LyricsRequest) => Promise.resolve(ready(request.title)));
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    for (let index = 1; index <= 51; index += 1) {
      await lyrics.load(playback({ title: `歌曲 ${index}` }));
    }
    await lyrics.load(playback({ title: '歌曲 2' }));
    expect(getLyrics).toHaveBeenCalledTimes(51);
    expect(lyrics.currentLyricText.value).toBe('歌曲 2');

    await lyrics.load(playback({ title: '歌曲 1' }));
    expect(getLyrics).toHaveBeenCalledTimes(52);
  });

  it('切回已缓存歌曲不会等待上一首歌的未完成请求', async () => {
    const pending = deferred<LyricsResponse>();
    const getLyrics = vi
      .fn()
      .mockResolvedValueOnce(ready('已缓存'))
      .mockImplementationOnce(() => pending.promise);
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    await lyrics.load(playback({ title: '缓存歌曲' }));
    void lyrics.load(playback({ title: '缓慢歌曲' }));
    await lyrics.load(playback({ title: '缓存歌曲' }));
    let restored = false;
    void lyrics.load(playback({ title: '缓存歌曲' })).then(() => {
      restored = true;
    });
    await Promise.resolve();

    expect(restored).toBe(true);
    expect(lyrics.currentLyricText.value).toBe('已缓存');
    pending.resolve(ready('缓慢歌曲'));
  });

  it('重置会使进行中的请求和重试失效', async () => {
    const first = deferred<LyricsResponse>();
    const getLyrics = vi.fn(() => first.promise);
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });

    void lyrics.load(playback());
    lyrics.reset();
    first.resolve(ready('不应写入'));
    await Promise.resolve();

    expect(lyrics.status.value).toBe('idle');
    expect(lyrics.lines.value).toEqual([]);
    expect(lyrics.currentLyricText.value).toBe('');
  });

  it('销毁响应式作用域会清理重试定时器', async () => {
    const getLyrics = vi.fn().mockResolvedValue(errorResponse(true));
    const scope = effectScope();
    const lyrics = scope.run(() => useTrackLyrics({ positionMs: ref(0), getLyrics }));
    if (!lyrics) throw new Error('未能创建歌词状态机');

    void lyrics.load(playback());
    await Promise.resolve();
    scope.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(getLyrics).toHaveBeenCalledTimes(1);
    expect(lyrics.status.value).toBe('idle');
  });

  it('主动销毁后忽略进行中请求的迟到响应', async () => {
    const pending = deferred<LyricsResponse>();
    const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics: () => pending.promise });

    const loadPromise = lyrics.load(playback());
    lyrics.dispose();
    pending.resolve(ready('不应写入'));
    await loadPromise;

    expect(lyrics.status.value).toBe('idle');
    expect(lyrics.currentLyricText.value).toBe('');
  });
});
