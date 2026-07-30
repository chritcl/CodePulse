import { describe, expect, it } from 'vitest';
import {
  INTERACTION_MOTION_TIMINGS,
  createDetailEnterMotion,
  createFlipMotion,
  createReleaseMotion,
  getWindowResizeDuration,
  sampleReleaseScale,
  smootherstep,
} from './springMotion';

describe('灵动岛交互动效预设', () => {
  it('明显弹簧在安全范围内完成一次回撤并保持速度连续', () => {
    const samples = Array.from({ length: 1001 }, (_, index) =>
      sampleReleaseScale(index / 1000, 0.92)
    );
    const velocities = samples.slice(1).map((value, index) => (value - samples[index]) * 1000);
    const nonZeroVelocities = velocities
      .map(Math.abs)
      .filter((value) => value > 0.001)
      .sort((left, right) => left - right);
    const medianVelocity = nonZeroVelocities[Math.floor(nonZeroVelocities.length / 2)];
    const maximumVelocityJump = velocities
      .slice(1)
      .reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - velocities[index])), 0);

    expect(samples[0]).toBeCloseTo(0.92, 6);
    expect(samples[550]).toBeCloseTo(1, 6);
    expect(samples[720]).toBeCloseTo(0.97, 6);
    expect(samples[samples.length - 1]).toBeCloseTo(1, 6);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.92);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(maximumVelocityJump / medianVelocity).toBeLessThan(3);
  });

  it('关闭弹簧后只生成单向短促过渡', () => {
    const release = createReleaseMotion(0.92, false);
    const detail = createDetailEnterMotion(false);
    const flip = createFlipMotion(
      {
        deltaX: -120,
        deltaY: 0,
        scaleX: 0.2,
        scaleY: 0.6,
      },
      false
    );

    expect(release.options.duration).toBe(INTERACTION_MOTION_TIMINGS.reduced);
    expect(release.keyframes).toHaveLength(2);
    expect(detail.keyframes).toHaveLength(2);
    expect(flip.keyframes).toHaveLength(2);
  });

  it('窗口缓动单调且时长随弹簧开关切换', () => {
    const samples = Array.from({ length: 101 }, (_, index) => smootherstep(index / 100));

    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(1);
    expect(samples.every((value, index) => index === 0 || value >= samples[index - 1])).toBe(true);
    expect(samples.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(getWindowResizeDuration(true)).toBe(280);
    expect(getWindowResizeDuration(false)).toBe(160);
  });
});
