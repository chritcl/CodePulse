import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_SPECTRUM, useMusicSpectrum } from './useMusicSpectrum';

describe('useMusicSpectrum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
