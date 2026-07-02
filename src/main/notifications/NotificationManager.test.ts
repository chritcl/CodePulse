import { describe, expect, it } from "vitest";
import type { AgentProvider, AgentStateSnapshot, AgentTask, QuotaSnapshot } from "../../shared/types/agent";
import { priorityFromTaskStatus } from "../../shared/constants/priority";
import { defaultAppSettings, type AppSettings } from "../../shared/types/settings";
import {
  NotificationManager,
  type NotificationActionIndex,
  type NotificationHandle,
  type NotificationOptions,
  type NotificationPresenter
} from "./NotificationManager";

const provider: AgentProvider = {
  id: "codex",
  name: "Codex",
  icon: "terminal",
  adapterType: "codex",
  enabled: true,
  connectionStatus: "connected",
  lastConnectedAt: "2026-07-01T03:00:00.000Z",
  lastErrorAt: null,
  capabilities: []
};

const makeTask = (
  id: string,
  status: AgentTask["status"],
  now = "2026-07-01T03:00:00.000Z",
  lastActivityAt = now
): AgentTask => ({
  id,
  providerId: provider.id,
  sessionId: `${id}-session`,
  title: `${id} 任务`,
  projectName: "CodePulse",
  projectPath: null,
  status,
  stage: "测试阶段",
  priority: priorityFromTaskStatus(status),
  startedAt: "2026-07-01T02:00:00.000Z",
  updatedAt: now,
  completedAt: status === "completed" ? now : null,
  lastActivityAt,
  lastActivityText: "最近活动",
  progressType: "unavailable",
  progressValue: null,
  completedSteps: null,
  totalSteps: null,
  waitingAction:
    status === "waiting"
      ? {
          label: "查看任务",
          description: "需要用户确认",
          actionId: "open-task"
        }
      : null,
  errorCode: status === "failed" ? "TEST_FAILED" : null,
  errorMessage: status === "failed" ? "测试失败" : null,
  sourceId: "test"
});

const makeQuota = (remainingPercent: number | null): QuotaSnapshot => ({
  id: "quota-codex",
  providerId: provider.id,
  total: remainingPercent === null ? null : 100,
  used: remainingPercent === null ? null : 100 - remainingPercent,
  remaining: remainingPercent === null ? null : remainingPercent,
  remainingPercent,
  resetAt: null,
  capturedAt: "2026-07-01T03:00:00.000Z",
  expiresAt: "2026-07-01T03:10:00.000Z",
  isEstimated: false,
  source: "test",
  errorMessage: null
});

const makeSnapshot = (parts: Partial<AgentStateSnapshot>): AgentStateSnapshot => ({
  version: 1,
  generatedAt: "2026-07-01T03:00:00.000Z",
  providers: [provider],
  tasks: [],
  activities: [],
  quotas: [],
  summary: {
    status: "idle",
    label: "空闲",
    runningTaskCount: 0,
    waitingTaskCount: 0,
    failedTaskCount: 0,
    completedTaskCount: 0,
    disconnectedProviderCount: 0,
    quotaCriticalProviderCount: 0,
    primaryTaskId: null,
    aggregateText: "空闲",
    hasStaleData: false,
    updatedAt: "2026-07-01T03:00:00.000Z"
  },
  ...parts
});

class TestNotification implements NotificationHandle {
  private clickListener: (() => void) | null = null;
  private actionListener: ((index: NotificationActionIndex) => void) | null = null;

  constructor(readonly options: NotificationOptions) {}

  show(): void {}

  onClick(listener: () => void): void {
    this.clickListener = listener;
  }

  onAction(listener: (index: NotificationActionIndex) => void): void {
    this.actionListener = listener;
  }

  click(): void {
    this.clickListener?.();
  }

  action(index: NotificationActionIndex): void {
    this.actionListener?.(index);
  }
}

class TestPresenter implements NotificationPresenter {
  readonly created: TestNotification[] = [];

  create(options: NotificationOptions): NotificationHandle {
    const notification = new TestNotification(options);
    this.created.push(notification);
    return notification;
  }
}

const createManager = (
  presenter: TestPresenter,
  settings: AppSettings = defaultAppSettings,
  now = () => new Date("2026-07-01T03:00:00.000Z"),
  runtimeOptions: {
    eventRecordRetentionMs?: number;
    maxSentEventRecords?: number;
  } = {}
) => {
  const openedTaskIds: Array<string | undefined> = [];
  const manager = new NotificationManager({
    settings,
    presenter,
    now,
    openTaskCenter: async (taskId?: string) => {
      openedTaskIds.push(taskId);
    },
    ...runtimeOptions
  });

  return {
    manager,
    openedTaskIds
  };
};

describe("NotificationManager", () => {
  it("按快照发送任务、连接、额度和长时间无活动通知", () => {
    const presenter = new TestPresenter();
    const { manager } = createManager(presenter);
    const inactiveAt = "2026-07-01T02:40:00.000Z";

    manager.handleSnapshot(
      makeSnapshot({
        providers: [
          provider,
          {
            ...provider,
            id: "offline",
            name: "离线 Agent",
            connectionStatus: "disconnected"
          }
        ],
        tasks: [
          makeTask("completed", "completed"),
          makeTask("failed", "failed"),
          makeTask("waiting", "waiting"),
          makeTask("inactive", "executing", "2026-07-01T03:00:00.000Z", inactiveAt)
        ],
        quotas: [makeQuota(12), { ...makeQuota(0), id: "quota-empty", providerId: "offline" }]
      })
    );

    expect(presenter.created.map((notification) => notification.options.eventType)).toEqual([
      "taskCompleted",
      "taskFailed",
      "taskWaiting",
      "taskInactive",
      "providerDisconnected",
      "quotaLow",
      "quotaEmpty"
    ]);
  });

  it("同一任务同一事件和同一数据源额度事件只通知一次", () => {
    const presenter = new TestPresenter();
    const { manager } = createManager(presenter);
    const snapshot = makeSnapshot({
      tasks: [makeTask("failed", "failed")],
      quotas: [makeQuota(10)]
    });

    manager.handleSnapshot(snapshot);
    manager.handleSnapshot(snapshot);

    expect(presenter.created.map((notification) => notification.options.eventType)).toEqual(["taskFailed", "quotaLow"]);
  });

  it("快照中消失且超过保留期的通知去重记录会释放", () => {
    const presenter = new TestPresenter();
    let currentNow = new Date("2026-07-01T03:00:00.000Z");
    const { manager } = createManager(presenter, defaultAppSettings, () => currentNow, {
      eventRecordRetentionMs: 60 * 1000
    });
    const failedSnapshot = makeSnapshot({
      tasks: [makeTask("failed", "failed")]
    });
    const emptySnapshot = makeSnapshot({
      tasks: []
    });

    manager.handleSnapshot(failedSnapshot);
    currentNow = new Date("2026-07-01T03:00:30.000Z");
    manager.handleSnapshot(emptySnapshot);
    currentNow = new Date("2026-07-01T03:00:40.000Z");
    manager.handleSnapshot(failedSnapshot);
    currentNow = new Date("2026-07-01T03:01:40.000Z");
    manager.handleSnapshot(emptySnapshot);
    currentNow = new Date("2026-07-01T03:01:41.000Z");
    manager.handleSnapshot(failedSnapshot);

    expect(presenter.created.map((notification) => notification.options.eventType)).toEqual([
      "taskFailed",
      "taskFailed"
    ]);
  });

  it("处理快照时会清理已到期的稍后提醒记录", () => {
    const presenter = new TestPresenter();
    let currentNow = new Date("2026-07-01T03:00:00.000Z");
    const { manager } = createManager(presenter, defaultAppSettings, () => currentNow);

    manager.snooze("expired", "2026-07-01T03:01:00.000Z");
    manager.snooze("active", "2026-07-01T03:15:00.000Z");
    currentNow = new Date("2026-07-01T03:02:00.000Z");
    manager.handleSnapshot(
      makeSnapshot({
        tasks: [makeTask("completed", "completed")]
      })
    );

    expect(manager.getRuntimeStatus()).toMatchObject({
      sentEventCount: 1,
      snoozedTaskCount: 1,
      lastCleanupAt: "2026-07-01T03:02:00.000Z"
    });
  });

  it("通知点击和查看操作会打开任务中心并定位任务", async () => {
    const presenter = new TestPresenter();
    const { manager, openedTaskIds } = createManager(presenter);

    manager.handleSnapshot(
      makeSnapshot({
        tasks: [makeTask("waiting", "waiting")]
      })
    );

    presenter.created[0]?.click();
    presenter.created[0]?.action(0);
    await Promise.resolve();

    expect(presenter.created[0]?.options.actions?.map((action) => action.text)).toEqual(["查看任务", "稍后提醒"]);
    expect(openedTaskIds).toEqual(["waiting", "waiting"]);
  });

  it("稍后提醒操作会在到期前抑制同一任务的新通知", () => {
    const presenter = new TestPresenter();
    let currentNow = new Date("2026-07-01T03:00:00.000Z");
    const { manager } = createManager(presenter, defaultAppSettings, () => currentNow);

    manager.handleSnapshot(
      makeSnapshot({
        tasks: [makeTask("waiting", "waiting")]
      })
    );
    presenter.created[0]?.action(1);
    manager.handleSnapshot(
      makeSnapshot({
        tasks: [makeTask("waiting", "failed", "2026-07-01T03:01:00.000Z")]
      })
    );
    currentNow = new Date("2026-07-01T03:16:00.000Z");
    manager.handleSnapshot(
      makeSnapshot({
        tasks: [makeTask("waiting", "failed", "2026-07-01T03:16:00.000Z")]
      })
    );

    expect(presenter.created.map((notification) => notification.options.eventType)).toEqual(["taskWaiting", "taskFailed"]);
  });

  it("勿扰开关和勿扰时间段会抑制通知", () => {
    const presenter = new TestPresenter();
    const doNotDisturbSettings: AppSettings = {
      ...defaultAppSettings,
      notifications: {
        ...defaultAppSettings.notifications,
        doNotDisturb: true
      }
    };
    const quietHourSettings: AppSettings = {
      ...defaultAppSettings,
      notifications: {
        ...defaultAppSettings.notifications,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:30"
      }
    };
    const { manager } = createManager(presenter, doNotDisturbSettings);
    const quietManager = createManager(presenter, quietHourSettings, () => new Date(2026, 6, 1, 23, 0, 0)).manager;

    manager.handleSnapshot(
      makeSnapshot({
        tasks: [makeTask("failed", "failed")]
      })
    );
    quietManager.handleSnapshot(
      makeSnapshot({
        tasks: [makeTask("waiting", "waiting")]
      })
    );

    expect(presenter.created).toHaveLength(0);
  });

  it("关闭通知设置时不发送通知", () => {
    const presenter = new TestPresenter();
    const { manager } = createManager(presenter, {
      ...defaultAppSettings,
      notifications: {
        ...defaultAppSettings.notifications,
        enabled: false
      }
    });

    manager.handleSnapshot(
      makeSnapshot({
        tasks: [makeTask("completed", "completed")]
      })
    );

    expect(presenter.created).toHaveLength(0);
  });

  it("暂停监控时抑制通知且恢复后同一事件仍可通知", () => {
    const presenter = new TestPresenter();
    const pausedSettings: AppSettings = {
      ...defaultAppSettings,
      paused: true
    };
    const { manager } = createManager(presenter, pausedSettings);
    const snapshot = makeSnapshot({
      tasks: [makeTask("failed", "failed")]
    });

    manager.handleSnapshot(snapshot);

    expect(presenter.created).toHaveLength(0);

    manager.updateSettings({
      ...pausedSettings,
      paused: false
    });
    manager.handleSnapshot(snapshot);

    expect(presenter.created.map((notification) => notification.options.eventType)).toEqual(["taskFailed"]);
  });
});
