import { ref, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

export const MIN_SPECTRUM = [0.35, 0.35, 0.35, 0.35, 0.35] as const;

type SpectrumFrame = [number, number, number, number, number];
type SpectrumFetcher = () => Promise<number[]>;

const MAX_BAR_SCALE = 0.95;
const STATIC_FRAME_LIMIT = 3;
const STATIC_EPSILON = 0.012;
const MINIMUM_EPSILON = 0.015;

const clampScale = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(MAX_BAR_SCALE, Math.max(MIN_SPECTRUM[0], value))
    : MIN_SPECTRUM[0];

const toSpectrumFrame = (values: number[]): SpectrumFrame => {
  if (values.length !== 5) return [...MIN_SPECTRUM];
  return values.map(clampScale) as SpectrumFrame;
};

const isMinimumFrame = (frame: SpectrumFrame): boolean =>
  frame.every((value) => Math.abs(value - MIN_SPECTRUM[0]) <= MINIMUM_EPSILON);

const isStaticFrame = (current: SpectrumFrame, previous: SpectrumFrame | null): boolean => {
  if (!previous) return isMinimumFrame(current);
  return current.every((value, index) => Math.abs(value - previous[index]) <= STATIC_EPSILON);
};

const createFallbackFrame = (index: number): SpectrumFrame => {
  const phases = [0, 1.5, 2.8, 4.0, 5.2];
  return phases.map((phase, barIndex) => {
    const wave = (Math.sin(index * 0.72 + phase) + 1) / 2;
    const lift = 0.04 + wave * (0.08 + barIndex * 0.012);
    return clampScale(MIN_SPECTRUM[0] + lift);
  }) as SpectrumFrame;
};

/** 管理音乐频谱轮询，并在真实采样静止时提供轻量保底脉冲 */
export const useMusicSpectrum = (
  isPlaying: Ref<boolean>,
  displayMusic: Ref<boolean>,
  fetchSpectrum: SpectrumFetcher = () => invoke<number[]>('get_audio_spectrum')
) => {
  const spectrumData = ref<SpectrumFrame>([...MIN_SPECTRUM]);
  let timer: number | null = null;
  let previousFrame: SpectrumFrame | null = null;
  let staticFrameCount = 0;
  let fallbackFrameIndex = 0;

  const resetSpectrum = () => {
    spectrumData.value = [...MIN_SPECTRUM];
    previousFrame = null;
    staticFrameCount = 0;
    fallbackFrameIndex = 0;
  };

  const syncSpectrum = async () => {
    if (!isPlaying.value || !displayMusic.value) {
      resetSpectrum();
      return;
    }

    try {
      const nextFrame = toSpectrumFrame(await fetchSpectrum());
      if (isStaticFrame(nextFrame, previousFrame)) {
        staticFrameCount += 1;
      } else {
        staticFrameCount = 0;
      }
      previousFrame = nextFrame;

      if (staticFrameCount >= STATIC_FRAME_LIMIT) {
        spectrumData.value = createFallbackFrame(fallbackFrameIndex);
        fallbackFrameIndex += 1;
        return;
      }

      spectrumData.value = nextFrame;
    } catch {
      resetSpectrum();
    }
  };

  const start = () => {
    if (timer !== null) return;
    void syncSpectrum();
    timer = window.setInterval(() => {
      void syncSpectrum();
    }, 50);
  };

  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    spectrumData,
    syncSpectrum,
    start,
    stop,
  };
};
