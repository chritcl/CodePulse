import type { MusicPlaybackState } from '@/shared/ipc/contracts';

export interface TimelineReceivedAt {
  epochMs: number;
  monotonicMs: number;
}

export interface PlaybackTimelineClock {
  sync(snapshot: MusicPlaybackState, receivedAt: TimelineReceivedAt): void;
  getPosition(monotonicMs: number): number | null;
  markStale(monotonicMs: number): void;
  reset(): void;
}

export const isPlaybackProgressAvailable = (
  snapshot: MusicPlaybackState | null,
  positionMs: number | null,
  sessionReady: boolean
): boolean => {
  const durationMs = snapshot?.durationMs;
  return (
    sessionReady &&
    snapshot?.canSeek === true &&
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs > 0 &&
    positionMs !== null &&
    Number.isFinite(positionMs) &&
    positionMs >= 0
  );
};

const SEEK_THRESHOLD_MS = 1_500;
const CORRECTION_FACTOR = 0.25;

/** 创建仅依赖单调时钟推进的播放时间线 */
export const createPlaybackTimelineClock = (): PlaybackTimelineClock => {
  let anchorPositionMs: number | null = null;
  let anchorMonotonicMs = 0;
  let durationMs: number | undefined;
  let isPlaying = false;
  let lastSourcePositionMs: number | undefined;
  let mappedSourceAtMs: number | undefined;
  let sourceAnchorMonotonicMs = 0;

  const clampPosition = (positionMs: number): number =>
    durationMs === undefined
      ? Math.max(0, positionMs)
      : Math.min(Math.max(0, positionMs), durationMs);

  const getPosition = (monotonicMs: number): number | null => {
    if (anchorPositionMs === null) return null;

    const elapsedMs = isPlaying ? Math.max(0, monotonicMs - anchorMonotonicMs) : 0;
    return clampPosition(anchorPositionMs + elapsedMs);
  };

  const sync = (snapshot: MusicPlaybackState, receivedAt: TimelineReceivedAt): void => {
    durationMs = snapshot.durationMs;

    if (snapshot.positionMs === undefined) {
      const predictedPositionMs = getPosition(receivedAt.monotonicMs);
      if (predictedPositionMs !== null && isPlaying !== snapshot.isPlaying) {
        anchorPositionMs = predictedPositionMs;
        anchorMonotonicMs = receivedAt.monotonicMs;
      }
      isPlaying = snapshot.isPlaying;
      return;
    }

    const repeatedFallback =
      snapshot.timelineUpdatedAtMs === undefined &&
      snapshot.isPlaying &&
      isPlaying &&
      lastSourcePositionMs === snapshot.positionMs;
    if (repeatedFallback) return;

    const sourceAtMs = snapshot.timelineUpdatedAtMs ?? snapshot.snapshotTakenAtMs;
    let sourceAgeMs = 0;
    if (snapshot.isPlaying) {
      if (mappedSourceAtMs === sourceAtMs) {
        sourceAgeMs = Math.max(0, receivedAt.monotonicMs - sourceAnchorMonotonicMs);
      } else {
        sourceAgeMs = Math.max(0, receivedAt.epochMs - sourceAtMs);
        mappedSourceAtMs = sourceAtMs;
        sourceAnchorMonotonicMs = receivedAt.monotonicMs - sourceAgeMs;
      }
    }
    const reportedPositionMs = clampPosition(snapshot.positionMs + sourceAgeMs);
    const predictedPositionMs = getPosition(receivedAt.monotonicMs);
    const stateChanged = isPlaying !== snapshot.isPlaying;
    const residualMs =
      predictedPositionMs === null
        ? Number.POSITIVE_INFINITY
        : reportedPositionMs - predictedPositionMs;

    if (stateChanged || predictedPositionMs === null || Math.abs(residualMs) >= SEEK_THRESHOLD_MS) {
      anchorPositionMs = reportedPositionMs;
    } else {
      anchorPositionMs = clampPosition(predictedPositionMs + residualMs * CORRECTION_FACTOR);
    }
    anchorMonotonicMs = receivedAt.monotonicMs;
    isPlaying = snapshot.isPlaying;
    lastSourcePositionMs = snapshot.positionMs;
  };

  const markStale = (monotonicMs: number): void => {
    anchorPositionMs = getPosition(monotonicMs);
    anchorMonotonicMs = monotonicMs;
    isPlaying = false;
  };

  const reset = (): void => {
    anchorPositionMs = null;
    anchorMonotonicMs = 0;
    durationMs = undefined;
    isPlaying = false;
    lastSourcePositionMs = undefined;
    mappedSourceAtMs = undefined;
    sourceAnchorMonotonicMs = 0;
  };

  return { sync, getPosition, markStale, reset };
};
