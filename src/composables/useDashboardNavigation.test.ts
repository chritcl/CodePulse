import type { Event, UnlistenFn } from '@tauri-apps/api/event';
import { describe, expect, it, vi } from 'vitest';
import type { EventListen } from '@/shared/utils/eventListenerRegistry';
import { useDashboardNavigation } from './useDashboardNavigation';

const desktopEvent = <T>(payload: T): Event<T> => ({
  event: 'open-settings-panel',
  id: 1,
  payload,
});

describe('useDashboardNavigation', () => {
  it('收到外部打开设置事件时进入设置首页并唤醒主窗口', async () => {
    let callback: ((event: Event<unknown>) => void) | undefined;
    const unlisten = vi.fn<UnlistenFn>();
    const listenEvent: EventListen = vi.fn(async (_name, handler) => {
      callback = handler as (event: Event<unknown>) => void;
      return unlisten;
    });
    const windowActions = {
      show: vi.fn(async () => {}),
      unminimize: vi.fn(async () => {}),
      setFocus: vi.fn(async () => {}),
    };
    const navigation = useDashboardNavigation({ listenEvent, windowActions });

    await navigation.start();
    callback?.(desktopEvent(undefined));
    await Promise.resolve();
    await Promise.resolve();

    expect(navigation.location.value).toEqual({
      page: 'settings-home',
      category: null,
    });
    expect(windowActions.show).toHaveBeenCalledOnce();
    expect(windowActions.unminimize).toHaveBeenCalledOnce();
    expect(windowActions.setFocus).toHaveBeenCalledOnce();

    navigation.dispose();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('容器过渡未完成时拒绝新的分类导航', async () => {
    let finishTransition!: () => void;
    const pendingTransition = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    const transition = vi.fn(async (update: () => void) => {
      update();
      await pendingTransition;
    });
    const navigation = useDashboardNavigation();

    const firstNavigation = navigation.openCategory('appearance', transition);
    expect(navigation.location.value.category).toBe('appearance');
    expect(navigation.isNavigating.value).toBe(true);

    await expect(navigation.openCategory('codex', transition)).resolves.toBe(false);
    expect(navigation.location.value.category).toBe('appearance');

    finishTransition();
    await expect(firstNavigation).resolves.toBe(true);
    expect(navigation.isNavigating.value).toBe(false);
  });
});
