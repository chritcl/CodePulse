import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => {
  const listeners: Record<string, (event: { payload: unknown }) => void> = {};

  return {
    listeners,
    emit: vi.fn(() => Promise.resolve()),
    invoke: vi.fn(),
    listen: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
      listeners[eventName] = handler;
      return Promise.resolve(vi.fn());
    }),
    getCurrentWindow: vi.fn(() => ({
      show: vi.fn(() => Promise.resolve()),
      unminimize: vi.fn(() => Promise.resolve()),
      setFocus: vi.fn(() => Promise.resolve()),
    })),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  emit: tauriMocks.emit,
  listen: tauriMocks.listen,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: tauriMocks.getCurrentWindow,
}));

import { useIslandStore } from './island';

describe('useIslandStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
    for (const key of Object.keys(tauriMocks.listeners)) {
      delete tauriMocks.listeners[key];
    }
  });

  it('状态同步只更新运行态，不覆盖用户开关偏好', async () => {
    localStorage.setItem('nsd_island_enabled', 'true');
    const store = useIslandStore();

    await store.startListening();
    tauriMocks.listeners['island-status-sync']({ payload: { visible: false } });

    expect(store.isVisible).toBe(false);
    expect(localStorage.getItem('nsd_island_enabled')).toBe('true');
  });

  it('用户点击开关时会持久化偏好', async () => {
    const store = useIslandStore();

    await store.toggleVisibility();

    expect(store.isVisible).toBe(false);
    expect(localStorage.getItem('nsd_island_enabled')).toBe('false');
    expect(tauriMocks.emit).toHaveBeenCalledWith('control-island-visibility', { show: false });
  });

  it('开关偏好为开启但窗口不可见时会补发显示命令', async () => {
    vi.useFakeTimers();
    localStorage.setItem('nsd_island_enabled', 'true');
    tauriMocks.invoke.mockResolvedValue(false);
    const store = useIslandStore();

    const checking = store.checkInitialState();
    await vi.runAllTimersAsync();
    await checking;
    vi.useRealTimers();

    expect(store.isVisible).toBe(true);
    expect(tauriMocks.emit).toHaveBeenCalledWith('control-island-visibility', { show: true });
    expect(tauriMocks.invoke).toHaveBeenCalledWith('set_island_visible', { visible: true });
    expect(localStorage.getItem('nsd_island_enabled')).toBe('true');
  });
});
