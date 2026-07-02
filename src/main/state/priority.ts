import type {
  AgentDisplayPriority,
  AgentProvider,
  AgentStateSummary,
  AgentTask,
  QuotaSnapshot
} from "../../shared/types/agent";
import { compareTasksByPriority, displayPriorityWeight, isQuotaCritical } from "../../shared/constants/priority";

const statusLabels: Record<AgentDisplayPriority, string> = {
  waiting: "等待处理",
  failed: "任务失败",
  quotaCritical: "额度不足",
  disconnected: "数据源断开",
  completed: "任务已完成",
  executing: "运行中",
  analyzing: "分析中",
  idle: "空闲"
};

const countByPriority = (tasks: AgentTask[], priority: AgentDisplayPriority): number =>
  tasks.filter((task) => task.priority === priority).length;

const makeAggregateText = (
  priority: AgentDisplayPriority,
  count: number,
  disconnectedProviderCount: number,
  quotaCriticalProviderCount: number
): string => {
  if (priority === "waiting" && count >= 2) {
    return `${count} 个任务需要处理`;
  }

  if (priority === "failed" && count >= 2) {
    return `${count} 个任务失败`;
  }

  if (priority === "executing" && count >= 2) {
    return `${count} 个任务运行中`;
  }

  if (priority === "quotaCritical" && quotaCriticalProviderCount >= 2) {
    return `${quotaCriticalProviderCount} 个额度不足`;
  }

  if (priority === "disconnected" && disconnectedProviderCount >= 2) {
    return `${disconnectedProviderCount} 个数据源断开`;
  }

  return statusLabels[priority];
};

export const buildStateSummary = (
  tasks: AgentTask[],
  providers: AgentProvider[],
  quotas: QuotaSnapshot[],
  hasStaleData: boolean,
  nowIso: string
): AgentStateSummary => {
  const sortedTasks = [...tasks].sort(compareTasksByPriority);
  const primaryTask = sortedTasks[0] ?? null;
  const disconnectedProviderCount = providers.filter((provider) =>
    ["disconnected", "error", "permissionDenied", "notFound", "notRunning", "stale"].includes(provider.connectionStatus)
  ).length;
  const quotaCriticalProviderCount = quotas.filter(isQuotaCritical).length;
  const runningTaskCount = tasks.filter((task) =>
    ["detecting", "analyzing", "planning", "executing", "testing"].includes(task.status)
  ).length;
  const waitingTaskCount = countByPriority(tasks, "waiting");
  const failedTaskCount = countByPriority(tasks, "failed");
  const completedTaskCount = countByPriority(tasks, "completed");
  const candidatePriorities: AgentDisplayPriority[] = [];

  if (primaryTask) {
    candidatePriorities.push(primaryTask.priority);
  }

  if (quotaCriticalProviderCount > 0) {
    candidatePriorities.push("quotaCritical");
  }

  if (disconnectedProviderCount > 0) {
    candidatePriorities.push("disconnected");
  }

  if (candidatePriorities.length === 0) {
    candidatePriorities.push("idle");
  }

  const status = candidatePriorities.sort(
    (left, right) => displayPriorityWeight[right] - displayPriorityWeight[left]
  )[0] as AgentDisplayPriority;
  const samePriorityCount = status === "quotaCritical" || status === "disconnected" ? 0 : countByPriority(tasks, status);

  return {
    status,
    label: statusLabels[status],
    runningTaskCount,
    waitingTaskCount,
    failedTaskCount,
    completedTaskCount,
    disconnectedProviderCount,
    quotaCriticalProviderCount,
    primaryTaskId: primaryTask?.id ?? null,
    aggregateText: makeAggregateText(status, samePriorityCount, disconnectedProviderCount, quotaCriticalProviderCount),
    hasStaleData,
    updatedAt: nowIso
  };
};
