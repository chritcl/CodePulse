import { describe, expect, it, vi } from 'vitest';
import type { Event, UnlistenFn } from '@tauri-apps/api/event';
import type { CodexDisplayPreferencesPayload } from '@/shared/ipc/contracts';
import type { EventListen } from '@/shared/utils/eventListenerRegistry';
import { useCodexDisplayPreferences } from './useCodexDisplayPreferences';

const event = (payload: CodexDisplayPreferencesPayload): Event<CodexDisplayPreferencesPayload> => ({
  event: 'codex-display-preferences-updated',
  id: 1,
  payload,
});

describe('useCodexDisplayPreferences', () => {
  it('读取默认偏好并接收主窗口同步的显示更新', async () => {
    localStorage.clear();
    let listener: ((received: Event<CodexDisplayPreferencesPayload>) => void) | undefined;
    const listenEvent: EventListen = async (_eventName, registered) => {
      listener = registered as (received: Event<CodexDisplayPreferencesPayload>) => void;
      return () => {};
    };
    const preferences = useCodexDisplayPreferences({ listenEvent });

    await preferences.start();
    listener?.(event({ idleResident: true, showOperationSummary: false, showTaskSummary: true }));

    expect(preferences.idleResident.value).toBe(true);
    expect(preferences.showOperationSummary.value).toBe(false);
    expect(preferences.showTaskSummary.value).toBe(true);
  });

  it('释放后解除监听并忽略迟到事件', async () => {
    let listener: ((received: Event<CodexDisplayPreferencesPayload>) => void) | undefined;
    const unlisten = vi.fn<UnlistenFn>();
    const listenEvent: EventListen = async (_eventName, registered) => {
      listener = registered as (received: Event<CodexDisplayPreferencesPayload>) => void;
      return unlisten;
    };
    const preferences = useCodexDisplayPreferences({ listenEvent });

    await preferences.start();
    preferences.dispose();
    listener?.(event({ idleResident: true, showOperationSummary: false, showTaskSummary: true }));

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(preferences.idleResident.value).toBe(false);
    expect(preferences.showOperationSummary.value).toBe(true);
    expect(preferences.showTaskSummary.value).toBe(false);
  });
});
