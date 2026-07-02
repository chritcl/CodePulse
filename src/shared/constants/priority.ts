import type { AgentDisplayPriority, AgentTask, AgentTaskStatus, QuotaSnapshot } from "../types/agent";

export const displayPriorityOrder: AgentDisplayPriority[] = [
  "waiting",
  "failed",
  "quotaCritical",
  "disconnected",
  "completed",
  "executing",
  "analyzing",
  "idle"
];

export const displayPriorityWeight: Record<AgentDisplayPriority, number> = displayPriorityOrder.reduce(
  (weights, priority, index) => ({
    ...weights,
    [priority]: displayPriorityOrder.length - index
  }),
  {} as Record<AgentDisplayPriority, number>
);

export const priorityFromTaskStatus = (status: AgentTaskStatus): AgentDisplayPriority => {
  if (status === "waiting") {
    return "waiting";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "disconnected" || status === "stale") {
    return "disconnected";
  }

  if (status === "completed") {
    return "completed";
  }

  if (status === "executing" || status === "planning" || status === "testing") {
    return "executing";
  }

  if (status === "analyzing" || status === "detecting") {
    return "analyzing";
  }

  return "idle";
};

export const isQuotaCritical = (quota: QuotaSnapshot): boolean =>
  quota.remainingPercent !== null && quota.remainingPercent <= 15;

export const compareTasksByPriority = (left: AgentTask, right: AgentTask): number => {
  const priorityDelta = displayPriorityWeight[right.priority] - displayPriorityWeight[left.priority];

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
};
