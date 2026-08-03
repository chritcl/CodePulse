import { ref } from 'vue';
import type { Event } from '@tauri-apps/api/event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventListen } from '@/shared/utils/eventListenerRegistry';
import { useIslandInterruptions } from './useIslandInterruptions';

const tauriEvent = <T>(event: string, payload: T): Event<T> => ({ event, id: 1, payload });

describe('灵动岛通知与系统提示', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createOptions = () => ({
    messageModeEnabled: ref(false),
    isIslandVisible: ref(true),
    showWindow: vi.fn().mockResolvedValue(undefined),
    collapseExpanded: vi.fn(),
    refreshLayout: vi.fn(),
    resolveIcon: vi.fn(() => 'icon.png'),
    notificationsEnabled: () => true,
    commands: {
      fetchLatestNotification: vi.fn().mockResolvedValue(null),
      openAppByAumid: vi.fn().mockResolvedValue(undefined),
    },
    listenEvent: vi.fn(async () => vi.fn()) as EventListen,
  });

  it('按进入顺序展示系统提示队列', async () => {
    const interruptions = useIslandInterruptions(createOptions());

    interruptions.enqueueToast('第一条', 'app');
    interruptions.enqueueToast('第二条', 'sys');
    await vi.advanceTimersByTimeAsync(0);

    expect(interruptions.systemToastText.value).toBe('第一条');
    expect(interruptions.systemToastVisible.value).toBe(true);

    await vi.advanceTimersByTimeAsync(2_200);

    expect(interruptions.systemToastText.value).toBe('第二条');
    expect(interruptions.systemToastType.value).toBe('sys');
    interruptions.stop();
  });

  it('活跃通知会阻止系统提示抢占展示', async () => {
    const interruptions = useIslandInterruptions(createOptions());
    interruptions.messageActive.value = true;

    interruptions.enqueueToast('稍后展示');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(interruptions.systemToastVisible.value).toBe(false);
    interruptions.stop();
  });

  it('消息模式收到通知时临时显示窗口并在过期后隐藏', async () => {
    const options = createOptions();
    options.messageModeEnabled.value = true;
    options.isIslandVisible.value = false;
    options.commands.fetchLatestNotification
      .mockResolvedValueOnce({
        app_name: '邮件',
        title: '主题',
        body: '正文',
        aumid: 'mail.app',
      })
      .mockResolvedValue(null);
    const interruptions = useIslandInterruptions(options);

    await interruptions.start();
    await vi.advanceTimersByTimeAsync(2_500);

    expect(options.showWindow).toHaveBeenCalledTimes(1);
    expect(options.isIslandVisible.value).toBe(true);
    expect(interruptions.messageActive.value).toBe(true);
    expect(interruptions.notificationBody.value).toBe('主题: 正文');

    await vi.advanceTimersByTimeAsync(5_600);

    expect(interruptions.messageActive.value).toBe(false);
    expect(options.isIslandVisible.value).toBe(false);
    interruptions.stop();
  });

  it('监听系统与电池事件并在停止时释放监听器', async () => {
    const handlers = new Map<string, (event: Event<unknown>) => void>();
    const systemUnlisten = vi.fn();
    const batteryUnlisten = vi.fn();
    const options = createOptions();
    options.listenEvent = vi
      .fn()
      .mockImplementationOnce(async (name, handler) => {
        handlers.set(name, handler as (event: Event<unknown>) => void);
        return systemUnlisten;
      })
      .mockImplementationOnce(async (name, handler) => {
        handlers.set(name, handler as (event: Event<unknown>) => void);
        return batteryUnlisten;
      }) as EventListen;
    const interruptions = useIslandInterruptions(options);

    await interruptions.start();
    handlers.get('battery-event')?.(
      tauriEvent('battery-event', { state: 'discharging', percent: 15 })
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(interruptions.systemToastText.value).toBe('电池电量低，剩余 15%');
    interruptions.stop();
    expect(systemUnlisten).toHaveBeenCalledTimes(1);
    expect(batteryUnlisten).toHaveBeenCalledTimes(1);
  });

  it('打开通知后清除未读和软打断状态', async () => {
    const options = createOptions();
    const interruptions = useIslandInterruptions(options);
    interruptions.notificationTitle.value = '邮件';
    interruptions.notificationAumid.value = 'mail.app';
    interruptions.notificationUnreadCount.value = 2;
    interruptions.notificationSoftUntil.value = 8_000;
    interruptions.messageActive.value = true;

    await interruptions.openNotification();

    expect(options.commands.openAppByAumid).toHaveBeenCalledWith({
      aumid: 'mail.app',
      appName: '邮件',
    });
    expect(interruptions.messageActive.value).toBe(false);
    expect(interruptions.notificationUnreadCount.value).toBe(0);
    expect(interruptions.notificationSoftUntil.value).toBe(0);
    interruptions.stop();
  });
});
