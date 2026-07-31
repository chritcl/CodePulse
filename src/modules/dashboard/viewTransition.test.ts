import { describe, expect, it, vi } from 'vitest';
import { runDashboardViewTransition } from './viewTransition';

describe('runDashboardViewTransition', () => {
  it('支持同文档过渡时等待原生容器变形完成', async () => {
    const update = vi.fn();
    const finished = Promise.resolve();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished };
    });

    await runDashboardViewTransition(update, {
      startViewTransition,
      prefersReducedMotion: false,
      wait: vi.fn(),
    });

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it('原生过渡时先等待新页面挂载完成再结束快照捕获', async () => {
    const order: string[] = [];
    const update = vi.fn(() => {
      order.push('update');
    });
    const awaitNewPage = vi.fn(async () => {
      order.push('awaitNewPage');
    });
    // 模拟浏览器：调用回调并等其 Promise 完成后才 resolve finished
    const startViewTransition = vi.fn((callback: () => void | Promise<void>) => ({
      finished: Promise.resolve().then(() => callback()).then(() => undefined),
    }));

    await runDashboardViewTransition(update, {
      startViewTransition,
      prefersReducedMotion: false,
      awaitNewPage,
      wait: vi.fn(() => Promise.resolve()),
    });

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(awaitNewPage).toHaveBeenCalledOnce();
    expect(order).toEqual(['update', 'awaitNewPage']);
  });

  it('不支持原生过渡时使用 360 毫秒回退动画', async () => {
    const update = vi.fn();
    const wait = vi.fn(() => Promise.resolve());

    await runDashboardViewTransition(update, {
      prefersReducedMotion: false,
      wait,
    });

    expect(update).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(360);
  });

  it('减少动画模式降级为 120 毫秒淡入淡出', async () => {
    const update = vi.fn();
    const wait = vi.fn(() => Promise.resolve());
    const startViewTransition = vi.fn();

    await runDashboardViewTransition(update, {
      startViewTransition,
      prefersReducedMotion: true,
      wait,
    });

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledWith(120);
  });
});
