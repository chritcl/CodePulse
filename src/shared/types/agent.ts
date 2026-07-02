export type AgentAdapterType = "mock" | "process" | "log" | "customCommand" | "codex";

export type AgentConnectionStatus =
  | "unknown"
  | "detecting"
  | "connected"
  | "disconnected"
  | "error"
  | "permissionDenied"
  | "notFound"
  | "notRunning"
  | "stale";

export type AgentTaskStatus =
  | "idle"
  | "detecting"
  | "analyzing"
  | "planning"
  | "executing"
  | "testing"
  | "waiting"
  | "completed"
  | "failed"
  | "disconnected"
  | "stale"
  | "unknown";

export type AgentDisplayPriority =
  | "waiting"
  | "failed"
  | "quotaCritical"
  | "disconnected"
  | "completed"
  | "executing"
  | "analyzing"
  | "idle";

export type AgentProgressType = "determinate" | "staged" | "indeterminate" | "unavailable";

export type AgentActivityType =
  | "taskStarted"
  | "stageChanged"
  | "message"
  | "waiting"
  | "completed"
  | "failed"
  | "quota"
  | "connection"
  | "system";

export interface AgentProviderCapability {
  id: string;
  label: string;
  enabled: boolean;
}

export interface AgentProvider {
  id: string;
  name: string;
  icon: string;
  adapterType: AgentAdapterType;
  enabled: boolean;
  connectionStatus: AgentConnectionStatus;
  lastConnectedAt: string | null;
  lastErrorAt: string | null;
  capabilities: AgentProviderCapability[];
}

export interface AgentWaitingAction {
  label: string;
  description: string;
  actionId: string;
}

export interface AgentTask {
  id: string;
  providerId: string;
  sessionId: string;
  title: string;
  projectName: string;
  projectPath: string | null;
  status: AgentTaskStatus;
  stage: string;
  priority: AgentDisplayPriority;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastActivityAt: string;
  lastActivityText: string;
  progressType: AgentProgressType;
  progressValue: number | null;
  completedSteps: number | null;
  totalSteps: number | null;
  waitingAction: AgentWaitingAction | null;
  errorCode: string | null;
  errorMessage: string | null;
  sourceId: string;
}

export interface AgentActivity {
  id: string;
  taskId: string;
  providerId: string;
  type: AgentActivityType;
  title: string;
  description: string;
  createdAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface QuotaSnapshot {
  id: string;
  providerId: string;
  total: number | null;
  used: number | null;
  remaining: number | null;
  remainingPercent: number | null;
  resetAt: string | null;
  capturedAt: string;
  expiresAt: string;
  isEstimated: boolean;
  source: string;
  errorMessage: string | null;
}

export interface AgentStateSummary {
  status: AgentDisplayPriority;
  label: string;
  runningTaskCount: number;
  waitingTaskCount: number;
  failedTaskCount: number;
  completedTaskCount: number;
  disconnectedProviderCount: number;
  quotaCriticalProviderCount: number;
  primaryTaskId: string | null;
  aggregateText: string;
  hasStaleData: boolean;
  updatedAt: string;
}

export interface AgentStateSnapshot {
  version: number;
  generatedAt: string;
  providers: AgentProvider[];
  tasks: AgentTask[];
  activities: AgentActivity[];
  quotas: QuotaSnapshot[];
  summary: AgentStateSummary;
}
