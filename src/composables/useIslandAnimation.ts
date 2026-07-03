/**
 * 灵动岛动画 Composable
 *
 * 管理灵动岛的入场和出场动画。
 */

import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useIslandAnimation() {
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

  // ============================================================
  // 导出
  // ============================================================

  return {
    onEnter,
    onLeave,
    onInnerEnter,
    onInnerLeave,
  };
}
