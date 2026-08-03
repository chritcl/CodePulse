import { ref, watch, type Ref } from 'vue';
import { notificationCommands } from '@/shared/ipc/commands';
import { BATTERY_EVENT, SYSTEM_EVENT } from '@/shared/ipc/events';
import type {
  BatteryEventPayload,
  LatestNotificationPayload,
  OpenAppPayload,
  SystemToastType,
} from '@/shared/ipc/contracts';
import { readBoolean } from '@/shared/utils/storage';
import {
  createEventListenerRegistry,
  type EventListen,
} from '@/shared/utils/eventListenerRegistry';
import defaultLogo from '@/assets/codepulse-mark.svg';
import qqIcon from '@/assets/qq.png';
import dingTalkIcon from '@/assets/dingtalk.png';
import mailIcon from '@/assets/mail.png';
import wechatIcon from '@/assets/wechat.png';

interface InterruptionCommands {
  fetchLatestNotification: () => Promise<LatestNotificationPayload | null>;
  openAppByAumid: (payload: OpenAppPayload) => Promise<void>;
}

interface IslandInterruptionsOptions {
  messageModeEnabled: Ref<boolean>;
  isIslandVisible: Ref<boolean>;
  showWindow: () => Promise<void>;
  collapseExpanded: () => void;
  refreshLayout: () => void;
  commands?: InterruptionCommands;
  listenEvent?: EventListen;
  resolveIcon?: (appName: string) => string;
  notificationsEnabled?: () => boolean;
  now?: () => number;
}

interface SystemToastItem {
  text: string;
  type: SystemToastType;
}

interface PendingDelay {
  timer: number;
  resolve: (active: boolean) => void;
}

const NOTIFICATION_POLL_INTERVAL_MS = 2_500;
const NOTIFICATION_VISIBLE_MS = 5_000;
const NOTIFICATION_SOFT_MS = 5_000;
const SYSTEM_TOAST_MS = 2_000;
const VISIBILITY_HIDE_DELAY_MS = 600;

const resolveNotificationIcon = (appName: string): string => {
  const name = appName.toLowerCase();
  if (name.includes('qq')) return qqIcon;
  if (name.includes('钉钉') || name.includes('dingtalk')) return dingTalkIcon;
  if (name.includes('mail') || name.includes('邮件')) return mailIcon;
  if (name.includes('wechat') || name.includes('微信')) return wechatIcon;
  return defaultLogo;
};

/** 统一管理通知、系统提示及消息模式下的临时窗口显隐。 */
export const useIslandInterruptions = (options: IslandInterruptionsOptions) => {
  const commands = options.commands ?? notificationCommands;
  const now = options.now ?? Date.now;
  const resolveIcon = options.resolveIcon ?? resolveNotificationIcon;
  const notificationsEnabled =
    options.notificationsEnabled ?? (() => readBoolean('codepulse_msg_notify'));
  const eventListeners = createEventListenerRegistry(options.listenEvent);

  const messageActive = ref(false);
  const notificationTitle = ref('');
  const notificationBody = ref('');
  const notificationAumid = ref('');
  const notificationIcon = ref(defaultLogo);
  const notificationUnreadCount = ref(0);
  const notificationSoftUntil = ref(0);
  const systemToastVisible = ref(false);
  const systemToastText = ref('');
  const systemToastType = ref<SystemToastType>('app');
  const systemToastSoftUntil = ref(0);

  const toastQueue: SystemToastItem[] = [];
  const pendingDelays = new Set<PendingDelay>();
  let messageTimer: number | null = null;
  let notificationTimer: number | null = null;
  let delayedMessageHideTimer: number | null = null;
  let delayedToastHideTimer: number | null = null;
  let isProcessingToast = false;
  let started = false;
  let disposed = false;

  const waitForLifecycleDelay = (delayMs: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (disposed) {
        resolve(false);
        return;
      }
      const pending: PendingDelay = { timer: 0, resolve };
      pending.timer = window.setTimeout(() => {
        pendingDelays.delete(pending);
        resolve(!disposed);
      }, delayMs);
      pendingDelays.add(pending);
    });

  const clearLifecycleDelays = () => {
    for (const pending of pendingDelays) {
      window.clearTimeout(pending.timer);
      pending.resolve(false);
    }
    pendingDelays.clear();
  };

  const processToastQueue = async () => {
    if (disposed || isProcessingToast || toastQueue.length === 0 || messageActive.value) return;
    isProcessingToast = true;
    const islandWasVisible = options.isIslandVisible.value;
    const nextToast = toastQueue.shift();

    if (nextToast) {
      options.collapseExpanded();
      systemToastText.value = nextToast.text;
      systemToastType.value = nextToast.type;
      systemToastSoftUntil.value = now() + SYSTEM_TOAST_MS;
      systemToastVisible.value = true;
      options.refreshLayout();

      if (options.messageModeEnabled.value && !options.isIslandVisible.value) {
        await options.showWindow();
        if (disposed) return;
        options.isIslandVisible.value = true;
      }

      if (!(await waitForLifecycleDelay(SYSTEM_TOAST_MS))) return;
      systemToastVisible.value = false;
      systemToastSoftUntil.value = 0;
      options.refreshLayout();
      if (!(await waitForLifecycleDelay(200))) return;
    }

    isProcessingToast = false;
    if (toastQueue.length > 0) {
      void processToastQueue();
    } else if (options.messageModeEnabled.value && !messageActive.value && !islandWasVisible) {
      if (delayedToastHideTimer !== null) window.clearTimeout(delayedToastHideTimer);
      delayedToastHideTimer = window.setTimeout(() => {
        delayedToastHideTimer = null;
        if (!disposed && !messageActive.value && !systemToastVisible.value) {
          options.isIslandVisible.value = false;
        }
      }, VISIBILITY_HIDE_DELAY_MS);
    }
  };

  const enqueueToast = (text: string, type: SystemToastType = 'app') => {
    if (disposed || !text.trim()) return;
    toastQueue.push({ text, type });
    void processToastQueue();
  };

  const stopMessageWatcher = watch(messageActive, (active) => {
    if (!active) void processToastQueue();
  });

  const pollNotification = async () => {
    if (disposed || !notificationsEnabled()) return;
    try {
      const notification = await commands.fetchLatestNotification();
      if (disposed || !notification) return;
      notificationTitle.value = notification.app_name;
      notificationAumid.value = notification.aumid;
      notificationBody.value = notification.body
        ? `${notification.title}: ${notification.body}`
        : notification.title;
      notificationIcon.value = resolveIcon(notification.app_name);
      notificationUnreadCount.value += 1;
      notificationSoftUntil.value = now() + NOTIFICATION_SOFT_MS;
      options.refreshLayout();

      if (!messageActive.value) {
        messageActive.value = true;
        if (options.messageModeEnabled.value && !options.isIslandVisible.value) {
          await options.showWindow();
          if (disposed) return;
          options.isIslandVisible.value = true;
        }
      }

      if (messageTimer !== null) window.clearTimeout(messageTimer);
      messageTimer = window.setTimeout(() => {
        messageTimer = null;
        if (disposed) return;
        messageActive.value = false;
        notificationSoftUntil.value = 0;
        options.refreshLayout();
        if (!options.messageModeEnabled.value) return;
        if (delayedMessageHideTimer !== null) window.clearTimeout(delayedMessageHideTimer);
        delayedMessageHideTimer = window.setTimeout(() => {
          delayedMessageHideTimer = null;
          if (!disposed && !messageActive.value) options.isIslandVisible.value = false;
        }, VISIBILITY_HIDE_DELAY_MS);
      }, NOTIFICATION_VISIBLE_MS);
    } catch (error) {
      if (!disposed) console.error('获取系统通知失败:', error);
    }
  };

  const openNotification = async () => {
    if (!notificationAumid.value && !notificationTitle.value) return;
    try {
      await commands.openAppByAumid({
        aumid: notificationAumid.value,
        appName: notificationTitle.value,
      });
      if (disposed) return;
      messageActive.value = false;
      notificationUnreadCount.value = 0;
      notificationSoftUntil.value = 0;
      options.collapseExpanded();
      options.refreshLayout();
      if (messageTimer !== null) window.clearTimeout(messageTimer);
      messageTimer = null;
    } catch (error) {
      if (!disposed) console.error('打开程序失败:', error);
    }
  };

  const start = async () => {
    if (started || disposed) return;
    started = true;
    await eventListeners.register<string>(SYSTEM_EVENT, (event) => {
      enqueueToast(event.payload, 'sys');
    });
    if (disposed) return;
    await eventListeners.register<BatteryEventPayload>(BATTERY_EVENT, (event) => {
      const { state, percent } = event.payload;
      if (state === 'charging') {
        enqueueToast(`已接入电源，当前电量 ${percent}%`, 'battery-charge');
      } else if (state === 'discharging' && percent <= 20) {
        enqueueToast(`电池电量低，剩余 ${percent}%`, 'battery-low');
      }
    });
    if (disposed) return;
    notificationTimer = window.setInterval(
      () => void pollNotification(),
      NOTIFICATION_POLL_INTERVAL_MS
    );
  };

  const stop = () => {
    if (disposed) return;
    disposed = true;
    stopMessageWatcher();
    eventListeners.dispose();
    if (notificationTimer !== null) window.clearInterval(notificationTimer);
    if (messageTimer !== null) window.clearTimeout(messageTimer);
    if (delayedMessageHideTimer !== null) window.clearTimeout(delayedMessageHideTimer);
    if (delayedToastHideTimer !== null) window.clearTimeout(delayedToastHideTimer);
    notificationTimer = null;
    messageTimer = null;
    delayedMessageHideTimer = null;
    delayedToastHideTimer = null;
    clearLifecycleDelays();
  };

  return {
    messageActive,
    notificationTitle,
    notificationBody,
    notificationAumid,
    notificationIcon,
    notificationUnreadCount,
    notificationSoftUntil,
    systemToastVisible,
    systemToastText,
    systemToastType,
    systemToastSoftUntil,
    enqueueToast,
    openNotification,
    start,
    stop,
  };
};
