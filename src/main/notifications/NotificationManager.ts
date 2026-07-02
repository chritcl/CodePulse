import type { AgentProvider, AgentStateSnapshot, AgentTask, QuotaSnapshot } from "../../shared/types/agent";
import type { AppSettings } from "../../shared/types/settings";
import type { AgentStateHub } from "../state/AgentStateHub";

export type NotificationEventType =
  | "taskCompleted"
  | "taskFailed"
  | "taskWaiting"
  | "taskInactive"
  | "providerDisconnected"
  | "quotaLow"
  | "quotaEmpty";

export type NotificationActionIndex = number;

export interface NotificationAction {
  type: "button";
  text: string;
}

export interface NotificationOptions {
  id: string;
  title: string;
  body: string;
  eventType: NotificationEventType;
  taskId?: string;
  providerId?: string;
  actions?: NotificationAction[];
}

export interface NotificationHandle {
  show(): void;
  onClick(listener: () => void): void;
  onAction(listener: (index: NotificationActionIndex) => void): void;
}

export interface NotificationPresenter {
  create(options: NotificationOptions): NotificationHandle;
}

export interface NotificationManagerOptions {
  settings: AppSettings;
  presenter: NotificationPresenter;
  now?: () => Date;
  openTaskCenter: (taskId?: string) => Promise<void>;
  eventRecordRetentionMs?: number;
  maxSentEventRecords?: number;
}

export interface NotificationRuntimeStatus {
  sentEventCount: number;
  snoozedTaskCount: number;
  lastCleanupAt: string | null;
}

interface SentNotificationEventRecord {
  lastSeenAt: number;
}

const runningStatuses = new Set<AgentTask["status"]>(["detecting", "analyzing", "planning", "executing", "testing"]);
const disconnectedStatuses = new Set<AgentProvider["connectionStatus"]>([
  "disconnected",
  "error",
  "permissionDenied",
  "notFound",
  "notRunning",
  "stale"
]);
const defaultEventRecordRetentionMs = 24 * 60 * 60 * 1000;
const defaultMaxSentEventRecords = 1000;

const minutesFromTime = (time: string): number => {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
};

const dateMinutes = (date: Date): number => date.getHours() * 60 + date.getMinutes();

const isInsideQuietHours = (date: Date, start: string | null, end: string | null): boolean => {
  if (!start || !end) {
    return false;
  }

  const current = dateMinutes(date);
  const startMinute = minutesFromTime(start);
  const endMinute = minutesFromTime(end);

  if (startMinute === endMinute) {
    return true;
  }

  if (startMinute < endMinute) {
    return current >= startMinute && current < endMinute;
  }

  return current >= startMinute || current < endMinute;
};

export class NotificationManager {
  private settings: AppSettings;
  private readonly presenter: NotificationPresenter;
  private readonly now: () => Date;
  private readonly openTaskCenter: (taskId?: string) => Promise<void>;
  private readonly eventRecordRetentionMs: number;
  private readonly maxSentEventRecords: number;
  private readonly sentEventRecords = new Map<string, SentNotificationEventRecord>();
  private readonly snoozedTaskUntil = new Map<string, number>();
  private unsubscribeHub: (() => void) | null = null;
  private lastCleanupAt: string | null = null;

  constructor(options: NotificationManagerOptions) {
    this.settings = options.settings;
    this.presenter = options.presenter;
    this.now = options.now ?? (() => new Date());
    this.openTaskCenter = options.openTaskCenter;
    this.eventRecordRetentionMs = Number.isFinite(options.eventRecordRetentionMs)
      ? Math.max(0, options.eventRecordRetentionMs ?? defaultEventRecordRetentionMs)
      : defaultEventRecordRetentionMs;
    this.maxSentEventRecords = Number.isFinite(options.maxSentEventRecords)
      ? Math.max(1, options.maxSentEventRecords ?? defaultMaxSentEventRecords)
      : defaultMaxSentEventRecords;
  }

  start(hub: AgentStateHub): void {
    if (this.unsubscribeHub) {
      return;
    }

    this.unsubscribeHub = hub.subscribe((snapshot) => {
      this.handleSnapshot(snapshot);
    });
  }

  dispose(): void {
    this.unsubscribeHub?.();
    this.unsubscribeHub = null;
    this.sentEventRecords.clear();
    this.snoozedTaskUntil.clear();
    this.lastCleanupAt = null;
  }

  updateSettings(settings: AppSettings): void {
    this.settings = settings;
  }

  getRuntimeStatus(): NotificationRuntimeStatus {
    return {
      sentEventCount: this.sentEventRecords.size,
      snoozedTaskCount: this.snoozedTaskUntil.size,
      lastCleanupAt: this.lastCleanupAt
    };
  }

  snooze(taskId: string, until: string): void {
    const untilMs = new Date(until).getTime();

    if (!Number.isFinite(untilMs)) {
      return;
    }

    this.snoozedTaskUntil.set(taskId, untilMs);
  }

  handleSnapshot(snapshot: AgentStateSnapshot): void {
    this.cleanupRuntimeRecords(this.collectSnapshotEventKeys(snapshot));

    if (!this.canNotify()) {
      return;
    }

    for (const task of snapshot.tasks) {
      this.handleTask(task);
    }

    for (const provider of snapshot.providers) {
      this.handleProvider(provider);
    }

    for (const quota of snapshot.quotas) {
      this.handleQuota(quota);
    }
  }

  private handleTask(task: AgentTask): void {
    if (this.isTaskSnoozed(task.id)) {
      return;
    }

    if (task.status === "completed") {
      this.sendOnce(`taskCompleted:${task.id}`, {
        id: `codepulse-task-completed-${task.id}`,
        title: "任务已完成",
        body: `${task.title} · ${task.lastActivityText}`,
        eventType: "taskCompleted",
        taskId: task.id
      });
    }

    if (task.status === "failed") {
      this.sendOnce(`taskFailed:${task.id}`, {
        id: `codepulse-task-failed-${task.id}`,
        title: "任务失败",
        body: `${task.title} · ${task.errorMessage ?? task.lastActivityText}`,
        eventType: "taskFailed",
        taskId: task.id
      });
    }

    if (task.status === "waiting") {
      this.sendOnce(`taskWaiting:${task.id}`, {
        id: `codepulse-task-waiting-${task.id}`,
        title: "需要处理",
        body: `${task.title} · ${task.waitingAction?.description ?? task.lastActivityText}`,
        eventType: "taskWaiting",
        taskId: task.id,
        actions: [
          {
            type: "button",
            text: "查看任务"
          },
          {
            type: "button",
            text: "稍后提醒"
          }
        ]
      });
    }

    if (this.isInactiveTask(task)) {
      this.sendOnce(`taskInactive:${task.id}`, {
        id: `codepulse-task-inactive-${task.id}`,
        title: "任务长时间没有活动",
        body: `${task.title} · 最近活动已超过 ${this.settings.notifications.staleMinutes} 分钟`,
        eventType: "taskInactive",
        taskId: task.id
      });
    }
  }

  private handleProvider(provider: AgentProvider): void {
    const eventKey = this.getProviderEventKey(provider);

    if (!eventKey) {
      return;
    }

    this.sendOnce(eventKey, {
      id: `codepulse-provider-disconnected-${provider.id}`,
      title: "数据源断开",
      body: `${provider.name} 当前状态：${provider.connectionStatus}`,
      eventType: "providerDisconnected",
      providerId: provider.id
    });
  }

  private handleQuota(quota: QuotaSnapshot): void {
    const eventKey = this.getQuotaEventKey(quota);

    if (!eventKey || quota.remainingPercent === null) {
      return;
    }

    if (quota.remainingPercent <= 0) {
      this.sendOnce(eventKey, {
        id: `codepulse-quota-empty-${quota.providerId}`,
        title: "额度已耗尽",
        body: "当前 Agent 额度已耗尽，请查看任务中心",
        eventType: "quotaEmpty",
        providerId: quota.providerId
      });
      return;
    }

    if (quota.remainingPercent <= this.settings.notifications.quotaWarningPercent) {
      this.sendOnce(eventKey, {
        id: `codepulse-quota-low-${quota.providerId}`,
        title: "额度不足",
        body: `当前 Agent 剩余额度 ${quota.remainingPercent}%`,
        eventType: "quotaLow",
        providerId: quota.providerId
      });
    }
  }

  private canNotify(): boolean {
    const notificationSettings = this.settings.notifications;

    if (this.settings.paused || !notificationSettings.enabled || notificationSettings.doNotDisturb) {
      return false;
    }

    return !isInsideQuietHours(this.now(), notificationSettings.quietHoursStart, notificationSettings.quietHoursEnd);
  }

  private isInactiveTask(task: AgentTask): boolean {
    if (!runningStatuses.has(task.status)) {
      return false;
    }

    const lastActivityAtMs = new Date(task.lastActivityAt).getTime();

    if (!Number.isFinite(lastActivityAtMs)) {
      return false;
    }

    return this.now().getTime() - lastActivityAtMs >= this.settings.notifications.staleMinutes * 60 * 1000;
  }

  private collectSnapshotEventKeys(snapshot: AgentStateSnapshot): Set<string> {
    const eventKeys = new Set<string>();

    for (const task of snapshot.tasks) {
      for (const eventKey of this.getTaskEventKeys(task)) {
        eventKeys.add(eventKey);
      }
    }

    for (const provider of snapshot.providers) {
      const eventKey = this.getProviderEventKey(provider);

      if (eventKey) {
        eventKeys.add(eventKey);
      }
    }

    for (const quota of snapshot.quotas) {
      const eventKey = this.getQuotaEventKey(quota);

      if (eventKey) {
        eventKeys.add(eventKey);
      }
    }

    return eventKeys;
  }

  private getTaskEventKeys(task: AgentTask): string[] {
    const eventKeys: string[] = [];

    if (task.status === "completed") {
      eventKeys.push(`taskCompleted:${task.id}`);
    }

    if (task.status === "failed") {
      eventKeys.push(`taskFailed:${task.id}`);
    }

    if (task.status === "waiting") {
      eventKeys.push(`taskWaiting:${task.id}`);
    }

    if (this.isInactiveTask(task)) {
      eventKeys.push(`taskInactive:${task.id}`);
    }

    return eventKeys;
  }

  private getProviderEventKey(provider: AgentProvider): string | null {
    if (!disconnectedStatuses.has(provider.connectionStatus)) {
      return null;
    }

    return `providerDisconnected:${provider.id}`;
  }

  private getQuotaEventKey(quota: QuotaSnapshot): string | null {
    if (quota.remainingPercent === null) {
      return null;
    }

    if (quota.remainingPercent <= 0) {
      return `quotaEmpty:${quota.providerId}`;
    }

    if (quota.remainingPercent <= this.settings.notifications.quotaWarningPercent) {
      return `quotaLow:${quota.providerId}`;
    }

    return null;
  }

  private cleanupRuntimeRecords(currentEventKeys: Set<string>): void {
    const now = this.now();
    const nowMs = now.getTime();

    if (!Number.isFinite(nowMs)) {
      return;
    }

    for (const [taskId, untilMs] of this.snoozedTaskUntil) {
      if (untilMs <= nowMs) {
        this.snoozedTaskUntil.delete(taskId);
      }
    }

    for (const [eventKey, record] of this.sentEventRecords) {
      if (!currentEventKeys.has(eventKey) && nowMs - record.lastSeenAt >= this.eventRecordRetentionMs) {
        this.sentEventRecords.delete(eventKey);
      }
    }

    this.pruneSentEventRecords(currentEventKeys);
    this.lastCleanupAt = now.toISOString();
  }

  private pruneSentEventRecords(currentEventKeys: Set<string>): void {
    if (this.sentEventRecords.size <= this.maxSentEventRecords) {
      return;
    }

    const removableRecords = [...this.sentEventRecords.entries()]
      .filter(([eventKey]) => !currentEventKeys.has(eventKey))
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt);

    for (const [eventKey] of removableRecords) {
      if (this.sentEventRecords.size <= this.maxSentEventRecords) {
        return;
      }

      this.sentEventRecords.delete(eventKey);
    }

    const oldestRecords = [...this.sentEventRecords.entries()].sort(
      (left, right) => left[1].lastSeenAt - right[1].lastSeenAt
    );

    for (const [eventKey] of oldestRecords) {
      if (this.sentEventRecords.size <= this.maxSentEventRecords) {
        return;
      }

      this.sentEventRecords.delete(eventKey);
    }
  }

  private isTaskSnoozed(taskId: string): boolean {
    const untilMs = this.snoozedTaskUntil.get(taskId);

    if (untilMs === undefined) {
      return false;
    }

    if (untilMs <= this.now().getTime()) {
      this.snoozedTaskUntil.delete(taskId);
      return false;
    }

    return true;
  }

  private sendOnce(eventKey: string, options: NotificationOptions): void {
    const nowMs = this.now().getTime();
    const existingRecord = this.sentEventRecords.get(eventKey);

    if (existingRecord) {
      existingRecord.lastSeenAt = nowMs;
      return;
    }

    const notification = this.presenter.create(options);
    notification.onClick(() => {
      void this.openTaskCenter(options.taskId);
    });
    notification.onAction((index) => {
      if (index === 0) {
        void this.openTaskCenter(options.taskId);
      }

      if (index === 1 && options.taskId) {
        this.snooze(options.taskId, new Date(this.now().getTime() + 15 * 60 * 1000).toISOString());
      }
    });
    notification.show();
    this.sentEventRecords.set(eventKey, {
      lastSeenAt: nowMs
    });
  }
}
