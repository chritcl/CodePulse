export interface MotionDefinition {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

export interface FlipGeometry {
  deltaX: number;
  deltaY: number;
  scaleX: number;
  scaleY: number;
}

export const INTERACTION_MOTION_TIMINGS = {
  press: 70,
  release: 320,
  detailEnter: 320,
  detailLeave: 160,
  flip: 320,
  reduced: 140,
  windowSpring: 280,
  windowReduced: 160,
} as const;

const SAMPLE_INTERVAL_MS = 12;

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

const interpolate = (start: number, end: number, progress: number) =>
  start + (end - start) * smootherstep(progress);

/** 提供端点速度和加速度均为零的五次平滑曲线 */
export const smootherstep = (progress: number) => {
  const value = clampUnit(progress);
  return value * value * value * (value * (value * 6 - 15) + 10);
};

const sampleThreeStageValue = (
  progress: number,
  start: number,
  target: number,
  rebound: number
) => {
  const value = clampUnit(progress);
  if (value <= 0.55) return interpolate(start, target, value / 0.55);
  if (value <= 0.72) return interpolate(target, rebound, (value - 0.55) / 0.17);
  return interpolate(rebound, target, (value - 0.72) / 0.28);
};

/** 采样按压释放后的安全回弹缩放 */
export const sampleReleaseScale = (progress: number, startScale = 0.92) =>
  sampleThreeStageValue(progress, startScale, 1, 0.97);

const createSampledKeyframes = (
  duration: number,
  sample: (progress: number) => Keyframe
): Keyframe[] => {
  const steps = Math.max(2, Math.ceil(duration / SAMPLE_INTERVAL_MS));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const offset = index / steps;
    return { ...sample(offset), offset };
  });
};

const createOptions = (duration: number): KeyframeAnimationOptions => ({
  duration,
  easing: 'linear',
  fill: 'forwards',
});

/** 创建短按反馈，结束时元素保持在按压峰值 */
export const createPressMotion = (targetScale = 0.92): MotionDefinition => ({
  keyframes: [
    { transform: 'scale(1)', offset: 0 },
    { transform: `scale(${targetScale})`, offset: 1 },
  ],
  options: {
    duration: INTERACTION_MOTION_TIMINGS.press,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    fill: 'forwards',
  },
});

/** 创建按压释放动效 */
export const createReleaseMotion = (startScale = 0.92, springEnabled = true): MotionDefinition => {
  if (!springEnabled) {
    return {
      keyframes: [
        { transform: `scale(${startScale})`, offset: 0 },
        { transform: 'scale(1)', offset: 1 },
      ],
      options: {
        duration: INTERACTION_MOTION_TIMINGS.reduced,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards',
      },
    };
  }

  return {
    keyframes: createSampledKeyframes(INTERACTION_MOTION_TIMINGS.release, (progress) => ({
      transform: `scale(${sampleReleaseScale(progress, startScale)})`,
    })),
    options: createOptions(INTERACTION_MOTION_TIMINGS.release),
  };
};

/** 创建详情面板入场动效 */
export const createDetailEnterMotion = (springEnabled = true): MotionDefinition => {
  if (!springEnabled) {
    return {
      keyframes: [
        { opacity: 0, transform: 'translateY(-6px) scale(0.98)', offset: 0 },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 1 },
      ],
      options: {
        duration: INTERACTION_MOTION_TIMINGS.reduced,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards',
      },
    };
  }

  return {
    keyframes: createSampledKeyframes(INTERACTION_MOTION_TIMINGS.detailEnter, (progress) => {
      const scale = sampleThreeStageValue(progress, 0.94, 1, 0.97);
      const offsetY = sampleThreeStageValue(progress, -8, 0, -2);
      const opacity = smootherstep(Math.min(1, progress / 0.45));
      return {
        opacity,
        transform: `translateY(${offsetY}px) scale(${scale})`,
      };
    }),
    options: createOptions(INTERACTION_MOTION_TIMINGS.detailEnter),
  };
};

/** 创建详情面板退场动效 */
export const createDetailLeaveMotion = (): MotionDefinition => ({
  keyframes: [
    { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0 },
    { opacity: 0, transform: 'translateY(-6px) scale(0.96)', offset: 1 },
  ],
  options: {
    duration: INTERACTION_MOTION_TIMINGS.detailLeave,
    easing: 'cubic-bezier(0.4, 0, 1, 1)',
    fill: 'forwards',
  },
});

/** 创建主岛收起后的向内回弹 */
export const createCollapseBounceMotion = (springEnabled = true): MotionDefinition => {
  if (!springEnabled) {
    return {
      keyframes: [
        { transform: 'scale(0.98)', offset: 0 },
        { transform: 'scale(1)', offset: 1 },
      ],
      options: {
        duration: INTERACTION_MOTION_TIMINGS.reduced,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards',
      },
    };
  }

  return {
    keyframes: createSampledKeyframes(INTERACTION_MOTION_TIMINGS.release, (progress) => ({
      transform: `scale(${sampleReleaseScale(progress, 0.94)})`,
    })),
    options: createOptions(INTERACTION_MOTION_TIMINGS.release),
  };
};

/** 创建卫星岛与主岛之间的 FLIP 动效 */
export const createFlipMotion = (
  geometry: FlipGeometry,
  springEnabled = true
): MotionDefinition => {
  const buildTransform = (motionProgress: number) => {
    const rest = 1 - motionProgress;
    const x = geometry.deltaX * rest;
    const y = geometry.deltaY * rest;
    const scaleX = 1 + (geometry.scaleX - 1) * rest;
    const scaleY = 1 + (geometry.scaleY - 1) * rest;
    return `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`;
  };

  if (!springEnabled) {
    return {
      keyframes: [
        { transform: buildTransform(0), offset: 0 },
        { transform: buildTransform(1), offset: 1 },
      ],
      options: {
        duration: INTERACTION_MOTION_TIMINGS.reduced,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards',
      },
    };
  }

  return {
    keyframes: createSampledKeyframes(INTERACTION_MOTION_TIMINGS.flip, (progress) => ({
      transform: buildTransform(sampleThreeStageValue(progress, 0, 1, 0.96)),
    })),
    options: createOptions(INTERACTION_MOTION_TIMINGS.flip),
  };
};

/** 创建 FLIP 内容渐显动效 */
export const createFlipRevealMotion = (springEnabled = true): MotionDefinition => ({
  keyframes: [
    { opacity: 0, offset: 0 },
    { opacity: 0, offset: springEnabled ? 0.42 : 0.2 },
    { opacity: 1, offset: 1 },
  ],
  options: {
    duration: springEnabled ? INTERACTION_MOTION_TIMINGS.flip : INTERACTION_MOTION_TIMINGS.reduced,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    fill: 'forwards',
  },
});

/** 获取窗口尺寸过渡时长 */
export const getWindowResizeDuration = (springEnabled: boolean) =>
  springEnabled
    ? INTERACTION_MOTION_TIMINGS.windowSpring
    : INTERACTION_MOTION_TIMINGS.windowReduced;
