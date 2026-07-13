import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_SPECTRUM, useMusicSpectrum } from './useMusicSpectrum';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('useMusicSpectrum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('播放音乐时优先展示真实频谱', async () => {
    const fetchSpectrum = vi.fn().mockResolvedValue([0.42, 0.51, 0.63, 0.74, 0.86]);
    const spectrum = useMusicSpectrum(ref(true), ref(true), fetchSpectrum);

    await spectrum.syncSpectrum();

    expect(fetchSpectrum).toHaveBeenCalledTimes(1);
    expect(spectrum.spectrumData.value).toEqual([0.42, 0.51, 0.63, 0.74, 0.86]);
  });

  it('连续静态最低值时生成轻量保底脉冲', async () => {
    const fetchSpectrum = vi.fn().mockResolvedValue([...MIN_SPECTRUM]);
    const spectrum = useMusicSpectrum(ref(true), ref(true), fetchSpectrum);

    await spectrum.syncSpectrum();
    await spectrum.syncSpectrum();
    await spectrum.syncSpectrum();
    await spectrum.syncSpectrum();

    expect(spectrum.spectrumData.value.some((value) => value > MIN_SPECTRUM[0])).toBe(true);
    expect(spectrum.spectrumData.value.every((value) => value <= 0.95)).toBe(true);
  });

  it('暂停或不展示音乐时回落到最低高度', async () => {
    const isPlaying = ref(true);
    const displayMusic = ref(true);
    const fetchSpectrum = vi.fn().mockResolvedValue([0.42, 0.51, 0.63, 0.74, 0.86]);
    const spectrum = useMusicSpectrum(isPlaying, displayMusic, fetchSpectrum);

    await spectrum.syncSpectrum();
    isPlaying.value = false;
    await spectrum.syncSpectrum();

    expect(spectrum.spectrumData.value).toEqual([...MIN_SPECTRUM]);

    isPlaying.value = true;
    displayMusic.value = false;
    await spectrum.syncSpectrum();

    expect(spectrum.spectrumData.value).toEqual([...MIN_SPECTRUM]);
  });

  it('停止后忽略在途响应并立即重置频谱', async () => {
    const pending = deferred<number[]>();
    const spectrum = useMusicSpectrum(ref(true), ref(true), () => pending.promise);

    spectrum.start();
    spectrum.stop();
    pending.resolve([0.42, 0.51, 0.63, 0.74, 0.86]);
    await pending.promise;
    await Promise.resolve();

    expect(spectrum.spectrumData.value).toEqual([...MIN_SPECTRUM]);
  });

  it('停止后重新启动时旧响应晚到不能覆盖新响应', async () => {
    const oldRequest = deferred<number[]>();
    const newRequest = deferred<number[]>();
    const fetchSpectrum = vi
      .fn()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise);
    const spectrum = useMusicSpectrum(ref(true), ref(true), fetchSpectrum);

    spectrum.start();
    spectrum.stop();
    spectrum.start();
    newRequest.resolve([0.45, 0.55, 0.65, 0.75, 0.85]);
    await newRequest.promise;
    await Promise.resolve();
    oldRequest.resolve([0.9, 0.9, 0.9, 0.9, 0.9]);
    await oldRequest.promise;
    await Promise.resolve();

    expect(spectrum.spectrumData.value).toEqual([0.45, 0.55, 0.65, 0.75, 0.85]);
    spectrum.stop();
  });

  it('同代请求未完成时多个轮询节拍只共享一次请求', async () => {
    vi.useFakeTimers();
    const pending = deferred<number[]>();
    const fetchSpectrum = vi.fn(() => pending.promise);
    const spectrum = useMusicSpectrum(ref(true), ref(true), fetchSpectrum);

    spectrum.start();
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchSpectrum).toHaveBeenCalledTimes(1);
    spectrum.stop();
    pending.resolve([...MIN_SPECTRUM]);
    await pending.promise;
    await Promise.resolve();
  });
});
