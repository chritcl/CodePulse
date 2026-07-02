import type { AgentActivity, AgentTask } from "../../../shared/types/agent";

export type CenterTaskStatusFilter = "all" | "running" | "waiting" | "failed" | "completed" | "history";
export type CenterTaskTimeRange = "all" | "today" | "last24h" | "last7d";

export interface CenterTaskFilters {
  status: CenterTaskStatusFilter;
  keyword: string;
  providerId: string | null;
  projectName: string | null;
  timeRange: CenterTaskTimeRange;
  now?: Date;
}

export interface CenterFilterOptions {
  providers: string[];
  projects: string[];
}

const runningStatuses = new Set<AgentTask["status"]>(["detecting", "analyzing", "planning", "executing", "testing"]);
const historyStatuses = new Set<AgentTask["status"]>(["completed", "failed", "stale"]);
const asciiFirstCompare = (left: string, right: string): number => {
  const leftAscii = /^[\x00-\x7F]/.test(left);
  const rightAscii = /^[\x00-\x7F]/.test(right);

  if (leftAscii !== rightAscii) {
    return leftAscii ? -1 : 1;
  }

  return left.localeCompare(right, "zh-CN");
};

const matchesStatus = (task: AgentTask, status: CenterTaskStatusFilter): boolean => {
  if (status === "all") {
    return true;
  }

  if (status === "running") {
    return runningStatuses.has(task.status);
  }

  if (status === "history") {
    return historyStatuses.has(task.status);
  }

  return task.status === status;
};

const matchesKeyword = (task: AgentTask, keyword: string): boolean => {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");

  if (!normalizedKeyword) {
    return true;
  }

  return [task.title, task.projectName, task.projectPath, task.stage, task.lastActivityText, task.providerId, task.sessionId]
    .filter((item): item is string => Boolean(item))
    .some((item) => item.toLocaleLowerCase("zh-CN").includes(normalizedKeyword));
};

const startOfToday = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const matchesTimeRange = (task: AgentTask, timeRange: CenterTaskTimeRange, now: Date): boolean => {
  if (timeRange === "all") {
    return true;
  }

  const updatedAt = new Date(task.updatedAt).getTime();

  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  if (timeRange === "today") {
    return updatedAt >= startOfToday(now).getTime();
  }

  const rangeMs = timeRange === "last24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return updatedAt >= now.getTime() - rangeMs;
};

export const filterCenterTasks = (tasks: AgentTask[], filters: CenterTaskFilters): AgentTask[] => {
  const now = filters.now ?? new Date();

  return tasks
    .filter((task) => matchesStatus(task, filters.status))
    .filter((task) => !filters.providerId || task.providerId === filters.providerId)
    .filter((task) => !filters.projectName || task.projectName === filters.projectName)
    .filter((task) => matchesKeyword(task, filters.keyword))
    .filter((task) => matchesTimeRange(task, filters.timeRange, now))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
};

export const buildCenterTaskSource = (
  currentTasks: AgentTask[],
  historyTasks: AgentTask[],
  includeHistory: boolean
): AgentTask[] => {
  if (!includeHistory) {
    return currentTasks;
  }

  const tasksById = new Map<string, AgentTask>();

  for (const task of historyTasks) {
    tasksById.set(task.id, task);
  }

  for (const task of currentTasks) {
    tasksById.set(task.id, task);
  }

  return Array.from(tasksById.values());
};

export const getCenterFilterOptions = (tasks: AgentTask[]): CenterFilterOptions => ({
  providers: Array.from(new Set(tasks.map((task) => task.providerId))).sort(asciiFirstCompare),
  projects: Array.from(new Set(tasks.map((task) => task.projectName))).sort(asciiFirstCompare)
});

export const getTaskTimeline = (activities: AgentActivity[], taskId: string | null): AgentActivity[] => {
  if (!taskId) {
    return [];
  }

  return activities
    .filter((activity) => activity.taskId === taskId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
};
