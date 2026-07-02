import type {
  AgentActivity,
  AgentProvider,
  AgentStateSnapshot,
  AgentTask,
  QuotaSnapshot
} from "../../shared/types/agent";
import { priorityFromTaskStatus } from "../../shared/constants/priority";
import { buildStateSummary } from "./priority";

export interface SnapshotSource {
  version: number;
  providers: AgentProvider[];
  tasks: AgentTask[];
  activities: AgentActivity[];
  quotas: QuotaSnapshot[];
  staleAfterMs: number;
  now: Date;
}

const runningStatuses = new Set(["detecting", "analyzing", "planning", "executing", "testing", "waiting"]);

export const markStaleTasks = (tasks: AgentTask[], now: Date, staleAfterMs: number): AgentTask[] =>
  tasks.map((task) => {
    const updatedAtMs = new Date(task.updatedAt).getTime();
    const isExpired = runningStatuses.has(task.status) && now.getTime() - updatedAtMs > staleAfterMs;

    if (!isExpired) {
      return task;
    }

    return {
      ...task,
      status: "stale",
      priority: priorityFromTaskStatus("stale"),
      lastActivityText: "状态数据已过期"
    };
  });

export const buildSnapshot = (source: SnapshotSource): AgentStateSnapshot => {
  const nowIso = source.now.toISOString();
  const tasks = markStaleTasks(source.tasks, source.now, source.staleAfterMs);
  const hasStaleData =
    tasks.some((task) => task.status === "stale") ||
    source.quotas.some((quota) => new Date(quota.expiresAt).getTime() < source.now.getTime());

  return {
    version: source.version,
    generatedAt: nowIso,
    providers: source.providers,
    tasks,
    activities: source.activities,
    quotas: source.quotas,
    summary: buildStateSummary(tasks, source.providers, source.quotas, hasStaleData, nowIso)
  };
};
