import type {
  AgentAdapter,
  AgentAdapterEvent,
  AdapterDetectionResult,
  RuntimeConfigurableAgentAdapter
} from "../../shared/types/adapter";
import type {
  AgentActivity,
  AgentProvider,
  AgentStateSnapshot,
  AgentTask,
  QuotaSnapshot
} from "../../shared/types/agent";
import { priorityFromTaskStatus } from "../../shared/constants/priority";
import { buildSnapshot } from "./snapshot";

export interface AgentStateHubOptions {
  staleAfterMs?: number;
  now?: () => Date;
}

export type AgentStateSubscriber = (snapshot: AgentStateSnapshot) => void;

const defaultStaleAfterMs = 10 * 60 * 1000;

const eventFingerprint = (event: AgentAdapterEvent): string => JSON.stringify(event);

const isRuntimeConfigurableAdapter = (adapter: AgentAdapter): adapter is RuntimeConfigurableAgentAdapter =>
  typeof (adapter as { updateRuntimeConfig?: unknown }).updateRuntimeConfig === "function";

export class AgentStateHub {
  private readonly adapters: AgentAdapter[];
  private readonly staleAfterMs: number;
  private readonly now: () => Date;
  private readonly providers = new Map<string, AgentProvider>();
  private readonly tasks = new Map<string, AgentTask>();
  private readonly activities = new Map<string, AgentActivity>();
  private readonly quotas = new Map<string, QuotaSnapshot>();
  private readonly subscribers = new Set<AgentStateSubscriber>();
  private readonly adapterUnsubscribers: Array<() => void> = [];
  private readonly seenEvents = new Set<string>();
  private version = 0;
  private started = false;

  constructor(adapters: AgentAdapter[], options: AgentStateHubOptions = {}) {
    this.adapters = adapters;
    this.staleAfterMs = options.staleAfterMs ?? defaultStaleAfterMs;
    this.now = options.now ?? (() => new Date());

    for (const adapter of adapters) {
      this.providers.set(adapter.provider.id, adapter.provider);
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    for (const adapter of this.adapters) {
      this.adapterUnsubscribers.push(adapter.subscribe((event) => this.handleEvent(event)));

      const provider = this.providers.get(adapter.provider.id) ?? adapter.provider;

      if (!provider.enabled) {
        continue;
      }

      try {
        await adapter.start();
        await this.hydrateAdapter(adapter);
      } catch (error) {
        this.recordAdapterError(adapter.provider.id, error);
      }
    }

    this.emitSnapshot();
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.adapterUnsubscribers.splice(0)) {
      unsubscribe();
    }

    for (const adapter of this.adapters) {
      try {
        await adapter.stop();
      } catch (error) {
        this.recordAdapterError(adapter.provider.id, error);
      }
    }

    this.started = false;
  }

  subscribe(listener: AgentStateSubscriber): () => void {
    this.subscribers.add(listener);
    listener(this.getSnapshot());

    return () => {
      this.subscribers.delete(listener);
    };
  }

  getSnapshot(): AgentStateSnapshot {
    return buildSnapshot({
      version: this.version,
      providers: Array.from(this.providers.values()),
      tasks: Array.from(this.tasks.values()),
      activities: Array.from(this.activities.values()).sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      ),
      quotas: Array.from(this.quotas.values()),
      staleAfterMs: this.staleAfterMs,
      now: this.now()
    });
  }

  async refresh(providerId?: string): Promise<AgentStateSnapshot> {
    const targetAdapters = providerId
      ? this.adapters.filter((adapter) => adapter.provider.id === providerId)
      : this.adapters;

    for (const adapter of targetAdapters) {
      const provider = this.providers.get(adapter.provider.id) ?? adapter.provider;

      if (!provider.enabled) {
        this.replaceProviderTasks(adapter.provider.id, []);
        this.quotas.delete(adapter.provider.id);
        continue;
      }

      try {
        await adapter.refresh();
        await this.hydrateAdapter(adapter);
      } catch (error) {
        this.recordAdapterError(adapter.provider.id, error);
      }
    }

    this.emitSnapshot();
    return this.getSnapshot();
  }

  getProviders(): AgentProvider[] {
    return Array.from(this.providers.values());
  }

  async setProviderEnabled(providerId: string, enabled: boolean): Promise<AgentStateSnapshot> {
    const adapter = this.adapters.find((item) => item.provider.id === providerId);
    const provider = this.providers.get(providerId);

    if (!adapter || !provider) {
      throw new Error("数据源不存在");
    }

    if (provider.enabled === enabled) {
      return this.getSnapshot();
    }

    if (!enabled) {
      try {
        await adapter.stop();
      } catch (error) {
        this.recordAdapterError(providerId, error);
      }

      adapter.provider.enabled = false;
      if (isRuntimeConfigurableAdapter(adapter)) {
        await adapter.updateRuntimeConfig({
          enabled: false
        });
      }
      this.providers.set(providerId, {
        ...provider,
        enabled: false,
        connectionStatus: "unknown"
      });
      this.replaceProviderTasks(providerId, []);
      this.quotas.delete(providerId);
      this.version += 1;
      this.emitSnapshot();
      return this.getSnapshot();
    }

    this.providers.set(providerId, {
      ...provider,
      enabled: true
    });
    adapter.provider.enabled = true;
    if (isRuntimeConfigurableAdapter(adapter)) {
      await adapter.updateRuntimeConfig({
        enabled: true
      });
    }

    if (this.started) {
      try {
        await adapter.start();
        await this.hydrateAdapter(adapter);
      } catch (error) {
        this.recordAdapterError(providerId, error);
      }
    }

    this.version += 1;
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateProviderRuntimeConfig(providerId: string, config: unknown): Promise<AgentStateSnapshot> {
    const adapter = this.adapters.find((item) => item.provider.id === providerId);
    const provider = this.providers.get(providerId);

    if (!adapter || !provider) {
      throw new Error("数据源不存在");
    }

    if (!isRuntimeConfigurableAdapter(adapter)) {
      throw new Error("数据源暂不支持运行期配置更新");
    }

    await adapter.updateRuntimeConfig(config);
    this.providers.set(providerId, {
      ...provider,
      capabilities: adapter.provider.capabilities,
      enabled: provider.enabled
    });

    if (provider.enabled) {
      try {
        await adapter.refresh();
        await this.hydrateAdapter(adapter);
      } catch (error) {
        this.recordAdapterError(providerId, error);
      }
    } else {
      this.replaceProviderTasks(providerId, []);
      this.quotas.delete(providerId);
    }

    this.version += 1;
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async detectProviders(): Promise<AdapterDetectionResult[]> {
    const results: AdapterDetectionResult[] = [];

    for (const adapter of this.adapters) {
      const provider = this.providers.get(adapter.provider.id) ?? adapter.provider;

      if (!provider.enabled) {
        results.push({
          provider,
          detected: false,
          message: "数据源已禁用"
        });
        continue;
      }

      try {
        const result = await adapter.detect();
        results.push(result);
        this.providers.set(result.provider.id, {
          ...result.provider,
          enabled: provider.enabled
        });
        this.version += 1;
      } catch (error) {
        this.recordAdapterError(adapter.provider.id, error, "ADAPTER_DETECT_ERROR");
        const provider = this.providers.get(adapter.provider.id) ?? adapter.provider;
        results.push({
          provider,
          detected: false,
          message: error instanceof Error ? error.message : "数据源检测失败"
        });
      }
    }

    this.emitSnapshot();
    return results;
  }

  handleEvent(event: AgentAdapterEvent): void {
    const fingerprint = eventFingerprint(event);

    if (this.seenEvents.has(fingerprint)) {
      return;
    }

    this.seenEvents.add(fingerprint);
    this.applyEvent(event);
    this.version += 1;
    this.emitSnapshot();
  }

  private async hydrateAdapter(adapter: AgentAdapter): Promise<void> {
    const existingProvider = this.providers.get(adapter.provider.id) ?? adapter.provider;

    if (!existingProvider.enabled) {
      this.replaceProviderTasks(adapter.provider.id, []);
      this.quotas.delete(adapter.provider.id);
      return;
    }

    const [tasks, quota, connectionStatus] = await Promise.all([
      adapter.getCurrentTasks(),
      adapter.getQuota(),
      adapter.getConnectionStatus()
    ]);

    this.providers.set(adapter.provider.id, {
      ...existingProvider,
      connectionStatus,
      lastConnectedAt: connectionStatus === "connected" ? this.now().toISOString() : existingProvider.lastConnectedAt
    });

    this.replaceProviderTasks(adapter.provider.id, tasks);

    this.quotas.set(quota.providerId, quota);
    this.version += 1;
  }

  private applyEvent(event: AgentAdapterEvent): void {
    if (event.type === "provider:updated") {
      const existingProvider = this.providers.get(event.provider.id);

      this.providers.set(event.provider.id, {
        ...event.provider,
        enabled: existingProvider?.enabled ?? event.provider.enabled
      });
      return;
    }

    if (event.type === "tasks:updated") {
      this.replaceProviderTasks(event.providerId, event.tasks);
      return;
    }

    if (event.type === "task:upserted") {
      this.tasks.set(event.task.id, this.normalizeTask(event.task));
      return;
    }

    if (event.type === "activity:created") {
      this.activities.set(event.activity.id, event.activity);
      return;
    }

    if (event.type === "quota:updated") {
      this.quotas.set(event.providerId, event.quota);
      return;
    }

    if (event.type === "connection:changed") {
      this.updateProviderConnection(event.providerId, event.status, event.message, event.occurredAt);
      return;
    }

    this.recordAdapterError(event.providerId, new Error(event.message), event.code, event.occurredAt);
  }

  private normalizeTask(task: AgentTask): AgentTask {
    return {
      ...task,
      priority: priorityFromTaskStatus(task.status),
      progressValue: task.progressType === "determinate" ? task.progressValue : null
    };
  }

  private replaceProviderTasks(providerId: string, tasks: AgentTask[]): void {
    for (const [taskId, task] of this.tasks) {
      if (task.providerId === providerId) {
        this.tasks.delete(taskId);
      }
    }

    for (const task of tasks) {
      this.tasks.set(task.id, this.normalizeTask(task));
    }
  }

  private updateProviderConnection(
    providerId: string,
    status: AgentProvider["connectionStatus"],
    message: string,
    occurredAt: string
  ): void {
    const provider = this.providers.get(providerId);

    if (!provider) {
      return;
    }

    this.providers.set(providerId, {
      ...provider,
      connectionStatus: status,
      lastConnectedAt: status === "connected" ? occurredAt : provider.lastConnectedAt,
      lastErrorAt: status === "connected" ? provider.lastErrorAt : occurredAt
    });

    this.activities.set(`${providerId}:connection:${occurredAt}`, {
      id: `${providerId}:connection:${occurredAt}`,
      taskId: "",
      providerId,
      type: "connection",
      title: "数据源状态变化",
      description: message,
      createdAt: occurredAt,
      metadata: {
        status
      }
    });
  }

  private recordAdapterError(providerId: string, error: unknown, code = "ADAPTER_ERROR", occurredAt = this.now().toISOString()): void {
    const provider = this.providers.get(providerId);
    const message = error instanceof Error ? error.message : "适配器异常";

    if (provider) {
      this.providers.set(providerId, {
        ...provider,
        connectionStatus: "error",
        lastErrorAt: occurredAt
      });
    }

    this.activities.set(`${providerId}:error:${occurredAt}`, {
      id: `${providerId}:error:${occurredAt}`,
      taskId: "",
      providerId,
      type: "connection",
      title: "适配器异常",
      description: message,
      createdAt: occurredAt,
      metadata: {
        code
      }
    });

    this.version += 1;
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();

    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }
}
