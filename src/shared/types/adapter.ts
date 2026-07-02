import type {
  AgentActivity,
  AgentConnectionStatus,
  AgentProvider,
  AgentTask,
  QuotaSnapshot
} from "./agent";

export interface AdapterDetectionResult {
  provider: AgentProvider;
  detected: boolean;
  message: string;
}

export type AgentAdapterEvent =
  | {
      type: "provider:updated";
      provider: AgentProvider;
      occurredAt: string;
    }
  | {
      type: "tasks:updated";
      providerId: string;
      tasks: AgentTask[];
      occurredAt: string;
    }
  | {
      type: "task:upserted";
      providerId: string;
      task: AgentTask;
      occurredAt: string;
    }
  | {
      type: "activity:created";
      providerId: string;
      activity: AgentActivity;
      occurredAt: string;
    }
  | {
      type: "quota:updated";
      providerId: string;
      quota: QuotaSnapshot;
      occurredAt: string;
    }
  | {
      type: "connection:changed";
      providerId: string;
      status: AgentConnectionStatus;
      message: string;
      occurredAt: string;
    }
  | {
      type: "error:raised";
      providerId: string;
      code: string;
      message: string;
      occurredAt: string;
    };

export type AgentAdapterEventListener = (event: AgentAdapterEvent) => void;

export interface AgentAdapter {
  readonly provider: AgentProvider;
  start(): Promise<void>;
  stop(): Promise<void>;
  detect(): Promise<AdapterDetectionResult>;
  refresh(): Promise<void>;
  subscribe(listener: AgentAdapterEventListener): () => void;
  getCurrentTasks(): Promise<AgentTask[]>;
  getQuota(): Promise<QuotaSnapshot>;
  getConnectionStatus(): Promise<AgentConnectionStatus>;
  dispose(): Promise<void>;
}

export interface RuntimeConfigurableAgentAdapter extends AgentAdapter {
  updateRuntimeConfig(config: unknown): Promise<void>;
}
