/**
 * 灵动岛动画 Composable
 *
 * 管理灵动岛的入场和出场动画。
 */

import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface PressSpringOptions {
  scale?: number;
  pressDuration?: number;
  releaseDuration?: number;
}

interface FlipSpringOptions {
  duration?: number;
  freq?: number;
  decay?: number;
  visualRevealStart?: number;
}

export function useIslandAnimation() {
  const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

  const springProgress = (elapsed: number, freq: number, decay: number) =>
    1 - Math.cos(freq * elapsed * 2 * Math.PI) * Math.exp(-decay * elapsed);

  /** 将弹簧反弹折回起终点之间，避免透明窗口边界裁剪越界内容 */
  const boundedSpringProgress = (elapsed: number, freq: number, decay: number) => {
    const progress = springProgress(elapsed, freq, decay);
    return Math.min(1, Math.max(0, 1 - Math.abs(1 - progress)));
  };

  /** 详情退场后让主岛从轻微压缩状态回弹，且不越过窗口边界 */
  const playMainCollapseBounce = (el: HTMLElement | null) => {
    if (!el) return;

    const startScale = 0.96;
    const duration = 260;
    const start = performance.now();
    const previousTransform = el.style.transform;
    const previousTransformOrigin = el.style.transformOrigin;
    const previousWillChange = el.style.willChange;

    el.style.transformOrigin = 'center';
    el.style.willChange = 'transform';
    el.style.transform = `scale(${startScale})`;

    const animate = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const elapsed = (time - start) / 1000;
      const spring = boundedSpringProgress(elapsed, 3, 14);
      const scale = startScale + (1 - startScale) * spring;
      el.style.transform = `scale(${scale})`;

      if (progress < 1) {
        requestAnimationFrame(animate);
        return;
      }

      el.style.transform = previousTransform;
      el.style.transformOrigin = previousTransformOrigin;
      el.style.willChange = previousWillChange;
    };

    requestAnimationFrame(animate);
  };

  /** 播放按压后弹出的两阶段弹簧动画 */
  const playPressSpring = (
    el: HTMLElement | null,
    options: PressSpringOptions = {}
  ): Promise<void> => {
    if (!el) return Promise.resolve();

    const targetScale = options.scale ?? 0.92;
    const pressDuration = options.pressDuration ?? 90;
    const releaseDuration = options.releaseDuration ?? 280;
    const previousTransform = el.style.transform;
    const previousTransformOrigin = el.style.transformOrigin;
    const previousWillChange = el.style.willChange;

    el.style.transformOrigin = 'center';
    el.style.willChange = 'transform';

    return new Promise((resolve) => {
      const pressStart = performance.now();

      const press = (time: number) => {
        const progress = Math.min(1, (time - pressStart) / pressDuration);
        const scale = 1 + (targetScale - 1) * easeOutCubic(progress);
        el.style.transform = `scale(${scale})`;

        if (progress < 1) {
          requestAnimationFrame(press);
          return;
        }

        const releaseStart = performance.now();
        const release = (releaseTime: number) => {
          const elapsed = (releaseTime - releaseStart) / 1000;
          const progressValue = Math.min(1, (releaseTime - releaseStart) / releaseDuration);
          const spring = boundedSpringProgress(elapsed, 2.8, 13);
          const scaleValue = targetScale + (1 - targetScale) * spring;
          el.style.transform = `scale(${scaleValue})`;

          if (progressValue < 1) {
            requestAnimationFrame(release);
            return;
          }

          el.style.transform = previousTransform;
          el.style.transformOrigin = previousTransformOrigin;
          el.style.willChange = previousWillChange;
          resolve();
        };

        requestAnimationFrame(release);
      };

      requestAnimationFrame(press);
    });
  };

  /** 从旧矩形弹簧过渡到元素当前位置 */
  const playFlipSpring = (
    el: HTMLElement | null,
    fromRect: DOMRect | null,
    options: FlipSpringOptions = {}
  ): Promise<void> => {
    if (!el || !fromRect) return Promise.resolve();

    const toRect = el.getBoundingClientRect();
    if (toRect.width === 0 || toRect.height === 0) return Promise.resolve();

    const deltaX = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
    const deltaY = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
    // 目标外壳只允许从小尺寸长大，避免卫星按钮被放大成主岛长条。
    const scaleX = Math.min(1, fromRect.width / toRect.width);
    const scaleY = Math.min(1, fromRect.height / toRect.height);
    const duration = options.duration ?? 360;
    const freq = options.freq ?? 2.6;
    const decay = options.decay ?? 12;
    const previousTransform = el.style.transform;
    const previousTransformOrigin = el.style.transformOrigin;
    const previousWillChange = el.style.willChange;
    const previousZIndex = el.style.zIndex;
    const flipVisual = el.querySelector<HTMLElement>('[data-flip-visual]');
    const previousTransition = el.style.transition;
    const previousAnimation = el.style.animation;
    const previousVisualOpacity = flipVisual?.style.opacity ?? '';
    const previousVisualWillChange = flipVisual?.style.willChange ?? '';
    const visualRevealStart = Math.min(0.9, Math.max(0, options.visualRevealStart ?? 0.6));

    el.style.transformOrigin = 'center';
    el.style.willChange = 'transform';
    el.style.zIndex = '20';
    if (flipVisual) {
      el.style.transition = 'none';
      el.style.animation = 'none';
      flipVisual.style.opacity = '0';
      flipVisual.style.willChange = 'opacity';
    }

    return new Promise((resolve) => {
      const start = performance.now();

      const animate = (time: number) => {
        const progress = Math.min(1, (time - start) / duration);
        const elapsed = (time - start) / 1000;
        const spring = boundedSpringProgress(elapsed, freq, decay);
        const rest = 1 - spring;
        const currentX = deltaX * rest;
        const currentY = deltaY * rest;
        const currentScaleX = 1 + (scaleX - 1) * rest;
        const currentScaleY = 1 + (scaleY - 1) * rest;

        el.style.transform = `translate(${currentX}px, ${currentY}px) scale(${currentScaleX}, ${currentScaleY})`;
        if (flipVisual) {
          const revealProgress = Math.min(
            1,
            Math.max(0, (progress - visualRevealStart) / (1 - visualRevealStart))
          );
          flipVisual.style.opacity = String(easeOutCubic(revealProgress));
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
          return;
        }

        el.style.transform = previousTransform;
        el.style.transformOrigin = previousTransformOrigin;
        el.style.willChange = previousWillChange;
        el.style.zIndex = previousZIndex;
        el.style.transition = previousTransition;
        el.style.animation = previousAnimation;
        if (flipVisual) {
          flipVisual.style.opacity = previousVisualOpacity;
          flipVisual.style.willChange = previousVisualWillChange;
        }
        resolve();
      };

      el.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
      requestAnimationFrame(animate);
    });
  };

  // ============================================================
  // 入场动画
  // ============================================================

  /** 灵动岛入场动画 */
  const onEnter = (el: Element, done: () => void) => {
    const HTMLElement = el as HTMLElement;
    HTMLElement.style.transformOrigin = 'center top';
    const start = performance.now();

    const freq = 2.0;
    const decay = 10.5;
    const duration = 600;

    const animate = (time: number) => {
      const t = (time - start) / 1000;
      const progress = (time - start) / duration;

      // 数学方程：1 - cos(2πft) * e^(-dt)
      const scale = 1 - Math.cos(freq * t * 2 * Math.PI) * Math.exp(-decay * t);
      const opacity = Math.min(1, progress * 4);

      HTMLElement.style.transform = `scale(${scale})`;
      HTMLElement.style.opacity = opacity.toString();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        HTMLElement.style.transform = `scale(1)`;
        HTMLElement.style.opacity = '1';
        done();
      }
    };
    requestAnimationFrame(animate);
  };

  /** 灵动岛出场动画 */
  const onLeave = (el: Element, done: () => void) => {
    const HTMLElement = el as HTMLElement;
    HTMLElement.style.transformOrigin = 'center top';
    const start = performance.now();

    const duration = 300;

    const animate = (time: number) => {
      const progress = (time - start) / duration;

      const scale = 1 - Math.pow(progress, 3);
      const opacity = 1 - progress * 1.5;

      HTMLElement.style.transform = `scale(${Math.max(0, scale)})`;
      HTMLElement.style.opacity = Math.max(0, opacity).toString();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        done();
        getCurrentWindow().hide().catch(console.error);
        emit('island-status-sync', { visible: false });
      }
    };
    requestAnimationFrame(animate);
  };

  // ============================================================
  // 内容切换动画
  // ============================================================

  /** 内容入场动画 */
  const onInnerEnter = (el: Element, done: () => void) => {
    const htmlEl = el as HTMLElement;
    const start = performance.now();

    const duration = 180;
    htmlEl.style.transformOrigin = 'center';
    htmlEl.style.opacity = '0';
    htmlEl.style.transform = 'none';

    const animate = (time: number) => {
      const progress = (time - start) / duration;
      htmlEl.style.opacity = Math.min(1, progress).toString();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        htmlEl.style.opacity = '1';
        done();
      }
    };
    requestAnimationFrame(animate);
  };

  /** 内容出场动画 */
  const onInnerLeave = (el: Element, done: () => void) => {
    const htmlEl = el as HTMLElement;
    const start = performance.now();
    const duration = 140;

    const animate = (time: number) => {
      const progress = (time - start) / duration;
      const opacity = 1 - progress;

      htmlEl.style.opacity = Math.max(0, opacity).toString();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        done();
      }
    };
    requestAnimationFrame(animate);
  };

  /** 详情面板入场动画 */
  const onDetailEnter = (el: Element, done: () => void) => {
    const htmlEl = el as HTMLElement;
    const start = performance.now();
    const duration = 320;

    htmlEl.style.transformOrigin = 'center top';
    htmlEl.style.opacity = '0';
    htmlEl.style.transform = 'translateY(-8px) scale(0.96)';

    const animate = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const elapsed = (time - start) / 1000;
      const spring = springProgress(elapsed, 2.4, 12);
      const offsetY = -8 * (1 - spring);
      const scale = 1 - 0.04 * (1 - spring);

      htmlEl.style.opacity = Math.min(1, progress * 3).toString();
      htmlEl.style.transform = `translateY(${offsetY}px) scale(${scale})`;

      if (progress < 1) {
        requestAnimationFrame(animate);
        return;
      }

      htmlEl.style.opacity = '1';
      htmlEl.style.transform = 'translateY(0) scale(1)';
      done();
    };

    requestAnimationFrame(animate);
  };

  /** 详情面板收起动画 */
  const onDetailLeave = (el: Element, done: () => void) => {
    const htmlEl = el as HTMLElement;
    const mainFrame =
      htmlEl
        .closest<HTMLElement>('.island-stack')
        ?.querySelector<HTMLElement>('.main-island-frame') ?? null;
    const start = performance.now();
    const duration = 160;

    const animate = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const eased = easeOutCubic(progress);

      htmlEl.style.opacity = String(1 - progress);
      htmlEl.style.transform = `translateY(${-6 * eased}px) scale(${1 - 0.04 * eased})`;

      if (progress < 1) {
        requestAnimationFrame(animate);
        return;
      }

      done();
      playMainCollapseBounce(mainFrame);
    };

    requestAnimationFrame(animate);
  };

  // ============================================================
  // 导出
  // ============================================================

  return {
    onEnter,
    onLeave,
    onInnerEnter,
    onInnerLeave,
    onDetailEnter,
    onDetailLeave,
    playPressSpring,
    playFlipSpring,
  };
}
