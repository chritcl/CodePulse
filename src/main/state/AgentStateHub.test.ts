import { describe, expect, it } from "vitest";
import type { AgentAdapter, AgentAdapterEvent, AgentAdapterEventListener, AdapterDetectionResult } from "../../shared/types/adapter";
import type { AgentConnectionStatus, AgentProvider, AgentTask, QuotaSnapshot } from "../../shared/types/agent";
import { priorityFromTaskStatus } from "../../shared/constants/priority";
import { AgentStateHub } from "./AgentStateHub";

const fixedNow = new Date("2026-07-01T03:00:00.000Z");

const provider: AgentProvider = {
  id: "test-provider",
  name: "测试 Agent",
  icon: "test",
  adapterType: "mock",
  enabled: true,
  connectionStatus: "connected",
  lastConnectedAt: fixedNow.toISOString(),
  lastErrorAt: null,
  capabilities: []
};

const makeTask = (id: string, status: AgentTask["status"], updatedAt = fixedNow.toISOString()): AgentTask => ({
  id,
  providerId: provider.id,
  sessionId: `${id}-session`,
  title: `${id} 任务`,
  projectName: "测试项目",
  projectPath: null,
  status,
  stage: "测试阶段",
  priority: priorityFromTaskStatus(status),
  startedAt: fixedNow.toISOString(),
  updatedAt,
  completedAt: status === "completed" ? fixedNow.toISOString() : null,
  lastActivityAt: updatedAt,
  lastActivityText: "测试活动",
  progressType: "unavailable",
  progressValue: null,
  completedSteps: null,
  totalSteps: null,
  waitingAction: null,
  errorCode: null,
  errorMessage: null,
  sourceId: "test"
});

const quota = (remainingPercent: number | null): QuotaSnapshot => ({
  id: "quota",
  providerId: provider.id,
  total: remainingPercent === null ? null : 100,
  used: remainingPercent === null ? null : 100 - remainingPercent,
  remaining: remainingPercent === null ? null : remainingPercent,
  remainingPercent,
  resetAt: null,
  capturedAt: fixedNow.toISOString(),
  expiresAt: new Date(fixedNow.getTime() + 60_000).toISOString(),
  isEstimated: false,
  source: "test",
  errorMessage: remainingPercent === null ? "额度暂不可用" : null
});

class TestAdapter implements AgentAdapter {
  readonly provider: AgentProvider;
  private readonly listeners = new Set<AgentAdapterEventListener>();
  detectCalled = false;
  startCount = 0;
  stopCount = 0;
  refreshCount = 0;
  runtimeConfigs: unknown[] = [];

  constructor(
    private tasks: AgentTask[],
    private quotaSnapshot: QuotaSnapshot,
    private status: AgentConnectionStatus = "connected",
    private refreshError: Error | null = null,
    providerEnabled = true
  ) {
    this.provider = {
      ...provider,
      enabled: providerEnabled
    };
  }

  async start(): Promise<void> {
    this.startCount += 1;
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
  }

  async detect(): Promise<AdapterDetectionResult> {
    this.detectCalled = true;
    return {
      provider: {
        ...this.provider,
        connectionStatus: this.status
      },
      detected: true,
      message: "已检测"
    };
  }

  async refresh(): Promise<void> {
    this.refreshCount += 1;

    if (this.refreshError) {
      throw this.refreshError;
    }
  }

  subscribe(listener: AgentAdapterEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async getCurrentTasks(): Promise<AgentTask[]> {
    return this.tasks;
  }

  async getQuota(): Promise<QuotaSnapshot> {
    return this.quotaSnapshot;
  }

  async getConnectionStatus(): Promise<AgentConnectionStatus> {
    return this.status;
  }

  async dispose(): Promise<void> {}

  async updateRuntimeConfig(config: unknown): Promise<void> {
    this.runtimeConfigs.push(config);
  }

  emit(event: AgentAdapterEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe("AgentStateHub", () => {
  it("按固定优先级选择等待任务", async () => {
    const adapter = new TestAdapter([makeTask("failed", "failed"), makeTask("waiting", "waiting")], quota(68));
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();

    expect(hub.getSnapshot().summary.status).toBe("waiting");
    expect(hub.getSnapshot().summary.aggregateText).toBe("等待处理");
  });

  it("相同事件只处理一次", async () => {
    const adapter = new TestAdapter([], quota(68));
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();
    const event: AgentAdapterEvent = {
      type: "task:upserted",
      providerId: provider.id,
      task: makeTask("running", "executing"),
      occurredAt: fixedNow.toISOString()
    };

    adapter.emit(event);
    const versionAfterFirstEvent = hub.getSnapshot().version;
    adapter.emit(event);

    expect(hub.getSnapshot().version).toBe(versionAfterFirstEvent);
  });

  it("任务列表更新会替换同一数据源已经消失的任务", async () => {
    const adapter = new TestAdapter([makeTask("running", "executing")], quota(68));
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();
    adapter.emit({
      type: "tasks:updated",
      providerId: provider.id,
      tasks: [],
      occurredAt: fixedNow.toISOString()
    });

    expect(hub.getSnapshot().tasks).toEqual([]);
    expect(hub.getSnapshot().summary.runningTaskCount).toBe(0);
  });

  it("过期运行任务不会继续显示为运行中", async () => {
    const staleTime = new Date(fixedNow.getTime() - 61_000).toISOString();
    const adapter = new TestAdapter([makeTask("running", "executing", staleTime)], quota(68));
    const hub = new AgentStateHub([adapter], {
      staleAfterMs: 60_000,
      now: () => fixedNow
    });

    await hub.start();
    const snapshot = hub.getSnapshot();

    expect(snapshot.tasks[0]?.status).toBe("stale");
    expect(snapshot.summary.runningTaskCount).toBe(0);
    expect(snapshot.summary.hasStaleData).toBe(true);
  });

  it("额度不可用时不显示为 0%", async () => {
    const adapter = new TestAdapter([makeTask("running", "executing")], quota(null));
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();
    const snapshot = hub.getSnapshot();

    expect(snapshot.quotas[0]?.remainingPercent).toBeNull();
    expect(snapshot.summary.quotaCriticalProviderCount).toBe(0);
  });

  it("适配器刷新异常会隔离为连接错误状态", async () => {
    const adapter = new TestAdapter([], quota(68), "connected", new Error("读取失败"));
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();
    await expect(hub.refresh()).resolves.toBeDefined();
    const snapshot = hub.getSnapshot();

    expect(snapshot.providers[0]?.connectionStatus).toBe("error");
    expect(snapshot.activities[0]?.description).toBe("读取失败");
  });

  it("执行数据源检测并更新提供方连接状态", async () => {
    const adapter = new TestAdapter([], quota(68), "notRunning");
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    const results = await hub.detectProviders();
    const snapshot = hub.getSnapshot();

    expect(adapter.detectCalled).toBe(true);
    expect(results[0]?.message).toBe("已检测");
    expect(snapshot.providers[0]?.connectionStatus).toBe("notRunning");
  });

  it("禁用数据源时停止适配器并清空该数据源任务和额度", async () => {
    const adapter = new TestAdapter([makeTask("running", "executing")], quota(12));
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();
    const snapshot = await hub.setProviderEnabled(provider.id, false);

    expect(adapter.stopCount).toBe(1);
    expect(snapshot.providers[0]).toMatchObject({
      enabled: false,
      connectionStatus: "unknown"
    });
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.quotas).toEqual([]);
    expect(snapshot.summary.runningTaskCount).toBe(0);
    expect(snapshot.summary.disconnectedProviderCount).toBe(0);
  });

  it("重新启用数据源时启动适配器并恢复该数据源快照", async () => {
    const adapter = new TestAdapter([makeTask("running", "executing")], quota(68));
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();
    await hub.setProviderEnabled(provider.id, false);
    const snapshot = await hub.setProviderEnabled(provider.id, true);

    expect(adapter.startCount).toBe(2);
    expect(snapshot.providers[0]).toMatchObject({
      enabled: true,
      connectionStatus: "connected"
    });
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.quotas).toHaveLength(1);
  });

  it("禁用数据源后刷新和检测不会继续读取该适配器", async () => {
    const adapter = new TestAdapter([makeTask("running", "executing")], quota(68));
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();
    await hub.setProviderEnabled(provider.id, false);
    adapter.refreshCount = 0;
    adapter.detectCalled = false;

    await hub.refresh(provider.id);
    const results = await hub.detectProviders();

    expect(adapter.refreshCount).toBe(0);
    expect(adapter.detectCalled).toBe(false);
    expect(results[0]).toMatchObject({
      detected: false,
      message: "数据源已禁用"
    });
  });

  it("启用初始禁用数据源后不会被适配器旧快照覆盖回禁用", async () => {
    const adapter = new TestAdapter([makeTask("running", "executing")], quota(68), "connected", null, false);
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();
    const snapshot = await hub.setProviderEnabled(provider.id, true);
    adapter.emit({
      type: "provider:updated",
      provider: {
        ...adapter.provider,
        enabled: false,
        connectionStatus: "connected"
      },
      occurredAt: fixedNow.toISOString()
    });

    expect(adapter.startCount).toBe(1);
    expect(snapshot.providers[0]?.enabled).toBe(true);
    expect(hub.getSnapshot().providers[0]?.enabled).toBe(true);
  });

  it("更新数据源运行期配置时会调用适配器并刷新快照", async () => {
    const adapter = new TestAdapter([makeTask("running", "executing")], quota(68));
    const hub = new AgentStateHub([adapter], {
      now: () => fixedNow
    });

    await hub.start();
    adapter.refreshCount = 0;
    const snapshot = await hub.updateProviderRuntimeConfig(provider.id, {
      authorized: true,
      commandPath: "agent-status.exe"
    });

    expect(adapter.runtimeConfigs).toEqual([
      {
        authorized: true,
        commandPath: "agent-status.exe"
      }
    ]);
    expect(adapter.refreshCount).toBe(1);
    expect(snapshot.tasks).toHaveLength(1);
  });
});
