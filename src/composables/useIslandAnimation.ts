/**
 * 灵动岛动画 Composable
 *
 * 管理灵动岛的显隐动画和交互动效。
 */

import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentScope, onScopeDispose, toValue, type MaybeRefOrGetter } from 'vue';
import {
  createCollapseBounceMotion,
  createDetailEnterMotion,
  createDetailLeaveMotion,
  createFlipMotion,
  createFlipRevealMotion,
  createPressMotion,
  createReleaseMotion,
  type MotionDefinition,
} from '@/modules/island/springMotion';

interface PressOptions {
  scale?: number;
}

interface ReleaseOptions {
  scale?: number;
}

interface FlipOptions {
  visualRevealStart?: number;
}

interface UseIslandAnimationOptions {
  springEnabled?: MaybeRefOrGetter<boolean>;
}

interface InlineStyleSnapshot {
  transformOrigin: string;
  willChange: string;
  zIndex: string;
}

export function useIslandAnimation(options: UseIslandAnimationOptions = {}) {
  const activeAnimations = new Map<HTMLElement, Animation>();
  const styleSnapshots = new Map<HTMLElement, InlineStyleSnapshot>();
  const springEnabled = () => toValue(options.springEnabled ?? true);

  const captureStyle = (element: HTMLElement) => {
    if (styleSnapshots.has(element)) return;
    styleSnapshots.set(element, {
      transformOrigin: element.style.transformOrigin,
      willChange: element.style.willChange,
      zIndex: element.style.zIndex,
    });
  };

  const restoreStyle = (element: HTMLElement) => {
    const snapshot = styleSnapshots.get(element);
    if (!snapshot) return;

    element.style.transformOrigin = snapshot.transformOrigin;
    element.style.willChange = snapshot.willChange;
    element.style.zIndex = snapshot.zIndex;
    styleSnapshots.delete(element);
  };

  /** 在同一元素上串行化合成层动画，并在最终动画结束后恢复样式 */
  const runMotion = async (
    element: HTMLElement,
    motion: MotionDefinition,
    prepare?: () => void
  ): Promise<boolean> => {
    activeAnimations.get(element)?.cancel();
    captureStyle(element);
    prepare?.();

    const animation = element.animate(motion.keyframes, motion.options);
    activeAnimations.set(element, animation);

    let completed: boolean;
    try {
      await animation.finished;
      completed = true;
    } catch {
      completed = false;
    } finally {
      if (activeAnimations.get(element) === animation) {
        activeAnimations.delete(element);
        animation.cancel();
        restoreStyle(element);
      }
    }

    return completed;
  };

  /** 播放按压阶段，调用方可在完成后立即提交交互状态 */
  const playPress = async (
    element: HTMLElement | null,
    pressOptions: PressOptions = {}
  ): Promise<void> => {
    if (!element) return;

    await runMotion(element, createPressMotion(pressOptions.scale ?? 0.92), () => {
      element.style.transformOrigin = 'center';
      element.style.willChange = 'transform';
    });
  };

  /** 播放按压释放后的回弹阶段 */
  const playRelease = async (
    element: HTMLElement | null,
    releaseOptions: ReleaseOptions = {}
  ): Promise<void> => {
    if (!element) return;

    await runMotion(
      element,
      createReleaseMotion(releaseOptions.scale ?? 0.92, springEnabled()),
      () => {
        element.style.transformOrigin = 'center';
        element.style.willChange = 'transform';
      }
    );
  };

  /** 从旧矩形平滑过渡到元素当前位置 */
  const playFlipSpring = async (
    element: HTMLElement | null,
    fromRect: DOMRect | null,
    flipOptions: FlipOptions = {}
  ): Promise<void> => {
    if (!element || !fromRect) return;

    const toRect = element.getBoundingClientRect();
    if (toRect.width === 0 || toRect.height === 0) return;

    const deltaX = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
    const deltaY = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
    const scaleX = Math.min(1, fromRect.width / toRect.width);
    const scaleY = Math.min(1, fromRect.height / toRect.height);
    const visual = element.querySelector<HTMLElement>('[data-flip-visual]');
    const revealMotion = createFlipRevealMotion(springEnabled());
    if (typeof flipOptions.visualRevealStart === 'number') {
      const revealStart = Math.min(0.9, Math.max(0, flipOptions.visualRevealStart));
      if (revealMotion.keyframes[1]) revealMotion.keyframes[1].offset = revealStart;
    }

    await Promise.all([
      runMotion(
        element,
        createFlipMotion({ deltaX, deltaY, scaleX, scaleY }, springEnabled()),
        () => {
          element.style.transformOrigin = 'center';
          element.style.willChange = 'transform';
          element.style.zIndex = '20';
        }
      ),
      visual
        ? runMotion(visual, revealMotion, () => {
            visual.style.willChange = 'opacity';
          })
        : Promise.resolve(true),
    ]);
  };

  /** 详情退场完成后让主岛执行一次向内回弹 */
  const playMainCollapseBounce = (element: HTMLElement | null) => {
    if (!element) return;
    void runMotion(element, createCollapseBounceMotion(springEnabled()), () => {
      element.style.transformOrigin = 'center';
      element.style.willChange = 'transform';
    });
  };

  /** 取消所有仍在运行的交互动效 */
  const cancelInteractionAnimations = () => {
    for (const animation of activeAnimations.values()) animation.cancel();
  };

  const activeAnimationCount = () => activeAnimations.size;

  // ============================================================
  // 显隐动画
  // ============================================================

  /** 灵动岛入场动画 */
  const onEnter = (element: Element, done: () => void) => {
    const htmlElement = element as HTMLElement;
    htmlElement.style.transformOrigin = 'center top';
    const start = performance.now();
    const freq = 2;
    const decay = 10.5;
    const duration = 600;

    const animate = (time: number) => {
      const elapsed = (time - start) / 1000;
      const progress = (time - start) / duration;
      const scale = 1 - Math.cos(freq * elapsed * 2 * Math.PI) * Math.exp(-decay * elapsed);
      const opacity = Math.min(1, progress * 4);

      htmlElement.style.transform = `scale(${scale})`;
      htmlElement.style.opacity = opacity.toString();

      if (progress < 1) {
        requestAnimationFrame(animate);
        return;
      }

      htmlElement.style.transform = 'scale(1)';
      htmlElement.style.opacity = '1';
      done();
    };

    requestAnimationFrame(animate);
  };

  /** 灵动岛出场动画 */
  const onLeave = (element: Element, done: () => void) => {
    const htmlElement = element as HTMLElement;
    htmlElement.style.transformOrigin = 'center top';
    const start = performance.now();
    const duration = 300;

    const animate = (time: number) => {
      const progress = (time - start) / duration;
      const scale = 1 - Math.pow(progress, 3);
      const opacity = 1 - progress * 1.5;

      htmlElement.style.transform = `scale(${Math.max(0, scale)})`;
      htmlElement.style.opacity = Math.max(0, opacity).toString();

      if (progress < 1) {
        requestAnimationFrame(animate);
        return;
      }

      done();
      getCurrentWindow().hide().catch(console.error);
      emit('island-status-sync', { visible: false });
    };

    requestAnimationFrame(animate);
  };

  // ============================================================
  // Vue 内容过渡
  // ============================================================

  const runTransition = (element: Element, done: () => void, motion: MotionDefinition) => {
    const htmlElement = element as HTMLElement;
    let finished = false;
    const finishOnce = () => {
      if (finished) return;
      finished = true;
      done();
    };

    void runMotion(htmlElement, motion, () => {
      htmlElement.style.transformOrigin = 'center';
      htmlElement.style.willChange = 'transform, opacity';
    }).finally(finishOnce);
  };

  /** 内容入场动画 */
  const onInnerEnter = (element: Element, done: () => void) => {
    runTransition(element, done, {
      keyframes: [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: 1 },
      ],
      options: {
        duration: springEnabled() ? 180 : 120,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards',
      },
    });
  };

  /** 内容出场动画 */
  const onInnerLeave = (element: Element, done: () => void) => {
    runTransition(element, done, {
      keyframes: [
        { opacity: 1, offset: 0 },
        { opacity: 0, offset: 1 },
      ],
      options: {
        duration: springEnabled() ? 140 : 100,
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
        fill: 'forwards',
      },
    });
  };

  /** 详情面板入场动画 */
  const onDetailEnter = (element: Element, done: () => void) => {
    runTransition(element, done, createDetailEnterMotion(springEnabled()));
  };

  /** 详情面板收起动画 */
  const onDetailLeave = (element: Element, done: () => void) => {
    const htmlElement = element as HTMLElement;
    const mainFrame =
      htmlElement
        .closest<HTMLElement>('.island-stack')
        ?.querySelector<HTMLElement>('.main-island-frame') ?? null;
    let finished = false;
    const finishOnce = () => {
      if (finished) return;
      finished = true;
      done();
    };

    void runMotion(htmlElement, createDetailLeaveMotion(), () => {
      htmlElement.style.transformOrigin = 'center top';
      htmlElement.style.willChange = 'transform, opacity';
    }).then((completed) => {
      finishOnce();
      if (completed) playMainCollapseBounce(mainFrame);
    }, finishOnce);
  };

  if (getCurrentScope()) {
    onScopeDispose(cancelInteractionAnimations);
  }

  return {
    onEnter,
    onLeave,
    onInnerEnter,
    onInnerLeave,
    onDetailEnter,
    onDetailLeave,
    playPress,
    playRelease,
    playFlipSpring,
    cancelInteractionAnimations,
    activeAnimationCount,
  };
}
