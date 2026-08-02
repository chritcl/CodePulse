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

  it('原生过渡时只等待下一次 DOM 提交，不追加定时动画等待', async () => {
    const order: string[] = [];
    const update = vi.fn(() => {
      order.push('update');
    });
    const awaitRender = vi.fn(async () => {
      order.push('awaitRender');
    });
    const wait = vi.fn(() => Promise.resolve());
    // 模拟浏览器等待更新回调完成后再捕获新页面快照
    const startViewTransition = vi.fn((callback: () => void | Promise<void>) => ({
      finished: Promise.resolve()
        .then(() => callback())
        .then(() => undefined),
    }));

    await runDashboardViewTransition(update, {
      startViewTransition,
      prefersReducedMotion: false,
      awaitRender,
      wait,
    });

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(awaitRender).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
    expect(order).toEqual(['update', 'awaitRender']);
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
