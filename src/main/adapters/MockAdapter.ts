import type { AgentAdapter, AgentAdapterEvent, AgentAdapterEventListener, AdapterDetectionResult } from "../../shared/types/adapter";
import type { AgentConnectionStatus, AgentProvider, AgentTask, QuotaSnapshot } from "../../shared/types/agent";
import { priorityFromTaskStatus } from "../../shared/constants/priority";

const nowIso = (): string => new Date().toISOString();

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60 * 1000).toISOString();

export interface MockAdapterOptions {
  enabled?: boolean;
}

export class MockAdapter implements AgentAdapter {
  readonly provider: AgentProvider = {
    id: "mock-codex",
    name: "Codex",
    icon: "hexagon",
    adapterType: "mock",
    enabled: true,
    connectionStatus: "connected",
    lastConnectedAt: nowIso(),
    lastErrorAt: null,
    capabilities: [
      {
        id: "taskStatus",
        label: "任务状态",
        enabled: true
      },
      {
        id: "quota",
        label: "额度",
        enabled: true
      }
    ]
  };

  private readonly listeners = new Set<AgentAdapterEventListener>();
  private running = false;
  private connectionStatus: AgentConnectionStatus = "connected";

  constructor(options: MockAdapterOptions = {}) {
    this.provider.enabled = options.enabled ?? true;
  }

  async start(): Promise<void> {
    this.running = true;
    this.emit({
      type: "provider:updated",
      provider: {
        ...this.provider,
        connectionStatus: this.connectionStatus
      },
      occurredAt: nowIso()
    });
    await this.refresh();
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async detect(): Promise<AdapterDetectionResult> {
    return {
      provider: this.provider,
      detected: true,
      message: "已启用模拟数据源"
    };
  }

  async refresh(): Promise<void> {
    if (!this.running) {
      return;
    }

    const occurredAt = nowIso();

    this.emit({
      type: "tasks:updated",
      providerId: this.provider.id,
      tasks: await this.getCurrentTasks(),
      occurredAt
    });
    this.emit({
      type: "quota:updated",
      providerId: this.provider.id,
      quota: await this.getQuota(),
      occurredAt
    });
  }

  subscribe(listener: AgentAdapterEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async getCurrentTasks(): Promise<AgentTask[]> {
    return [
      {
        id: "mock-task-running",
        providerId: this.provider.id,
        sessionId: "mock-session-1",
        title: "正在运行单元测试",
        projectName: "CodePulse",
        projectPath: null,
        status: "executing",
        stage: "单元测试",
        priority: priorityFromTaskStatus("executing"),
        startedAt: minutesAgo(6),
        updatedAt: nowIso(),
        completedAt: null,
        lastActivityAt: minutesAgo(1),
        lastActivityText: "32 / 48 项通过",
        progressType: "staged",
        progressValue: null,
        completedSteps: 32,
        totalSteps: 48,
        waitingAction: null,
        errorCode: null,
        errorMessage: null,
        sourceId: "mock"
      },
      {
        id: "mock-task-waiting",
        providerId: this.provider.id,
        sessionId: "mock-session-2",
        title: "读取 .env.example",
        projectName: "示例项目",
        projectPath: null,
        status: "waiting",
        stage: "等待确认",
        priority: priorityFromTaskStatus("waiting"),
        startedAt: minutesAgo(12),
        updatedAt: minutesAgo(2),
        completedAt: null,
        lastActivityAt: minutesAgo(2),
        lastActivityText: "需要确认是否允许访问配置样例",
        progressType: "unavailable",
        progressValue: null,
        completedSteps: null,
        totalSteps: null,
        waitingAction: {
          label: "查看详情",
          description: "确认读取权限后继续任务",
          actionId: "open-task"
        },
        errorCode: null,
        errorMessage: null,
        sourceId: "mock"
      }
    ];
  }

  async getQuota(): Promise<QuotaSnapshot> {
    return {
      id: "mock-quota-codex",
      providerId: this.provider.id,
      total: 100,
      used: 32,
      remaining: 68,
      remainingPercent: 68,
      resetAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      capturedAt: nowIso(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      isEstimated: false,
      source: "mock",
      errorMessage: null
    };
  }

  async getConnectionStatus(): Promise<AgentConnectionStatus> {
    return this.connectionStatus;
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    this.running = false;
  }

  private emit(event: AgentAdapterEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
