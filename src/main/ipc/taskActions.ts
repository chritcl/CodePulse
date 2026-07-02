import { spawn } from "node:child_process";
import { clipboard, shell } from "electron";
import type { AgentProvider, AgentStateSnapshot, AgentTask } from "../../shared/types/agent";

export interface TaskHistoryReader {
  getRecentTasks(limit?: number): AgentTask[];
}

export const findTaskOrThrow = (tasks: AgentTask[], taskId: string): AgentTask => {
  const task = tasks.find((item) => item.id === taskId);

  if (!task) {
    throw new Error("任务不存在");
  }

  return task;
};

export const findTaskFromSnapshotOrHistory = (
  tasks: AgentTask[],
  taskId: string,
  historyStore?: TaskHistoryReader
): AgentTask => {
  const task = tasks.find((item) => item.id === taskId);

  if (task) {
    return task;
  }

  const historyTask = historyStore?.getRecentTasks(500).find((item) => item.id === taskId);

  if (!historyTask) {
    throw new Error("任务不存在");
  }

  return historyTask;
};

type AgentOpenStrategy = "codexCli" | "projectDirectory";

const resolveAgentOpenStrategy = (task: AgentTask, providers: AgentProvider[]): AgentOpenStrategy => {
  const provider = providers.find((item) => item.id === task.providerId);

  if (provider?.adapterType === "codex" || task.providerId === "codex") {
    return "codexCli";
  }

  if (provider) {
    return "projectDirectory";
  }

  throw new Error("该任务暂不支持打开 Agent");
};

const statusLabels: Record<AgentTask["status"], string> = {
  idle: "空闲",
  detecting: "检测中",
  analyzing: "分析中",
  planning: "规划中",
  executing: "运行中",
  testing: "测试中",
  waiting: "等待确认",
  completed: "已完成",
  failed: "失败",
  disconnected: "已断开",
  stale: "数据过期",
  unknown: "未知"
};

export const buildTaskSummary = (task: AgentTask, provider?: AgentProvider): string =>
  [
    `任务：${task.title}`,
    `Agent：${provider?.name ?? task.providerId}`,
    `项目：${task.projectName}`,
    `状态：${statusLabels[task.status]}`,
    `阶段：${task.stage}`,
    `最近活动：${task.lastActivityText}`,
    task.waitingAction ? `等待处理：${task.waitingAction.description}` : null,
    task.errorMessage ? `错误：${task.errorMessage}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

export const copyTaskSummaryForTaskId = (
  snapshot: AgentStateSnapshot,
  taskId: string,
  historyStore?: TaskHistoryReader
): string => {
  const task = findTaskFromSnapshotOrHistory(snapshot.tasks, taskId, historyStore);
  const provider = snapshot.providers.find((item) => item.id === task.providerId);
  const summary = buildTaskSummary(task, provider);
  clipboard.writeText(summary);
  return summary;
};

const openCodexAgent = (task: AgentTask): void => {
  if (process.platform !== "win32") {
    throw new Error("当前系统暂不支持打开 Agent");
  }

  if (!task.projectPath?.trim()) {
    throw new Error("Agent 启动目录暂不可用");
  }

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NoExit", "-Command", "Set-Location -LiteralPath $args[0]; codex", task.projectPath],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }
  );
  child.unref();
};

export const openTaskProjectDirectory = async (task: AgentTask): Promise<void> => {
  if (!task.projectPath?.trim()) {
    throw new Error("任务项目目录暂不可用");
  }

  const openError = await shell.openPath(task.projectPath);

  if (openError) {
    throw new Error(`项目目录打开失败：${openError}`);
  }
};

const openAgentProjectDirectory = async (task: AgentTask): Promise<void> => {
  if (!task.projectPath?.trim()) {
    throw new Error("Agent 项目目录暂不可用");
  }

  const openError = await shell.openPath(task.projectPath);

  if (openError) {
    throw new Error(`Agent 项目目录打开失败：${openError}`);
  }
};

export const openAgentForTask = async (task: AgentTask, providers: AgentProvider[]): Promise<void> => {
  const strategy = resolveAgentOpenStrategy(task, providers);

  if (strategy === "codexCli") {
    openCodexAgent(task);
    return;
  }

  await openAgentProjectDirectory(task);
};

export const openAgentForTaskId = async (
  snapshot: AgentStateSnapshot,
  taskId: string,
  historyStore?: TaskHistoryReader
): Promise<void> => {
  const task = findTaskFromSnapshotOrHistory(snapshot.tasks, taskId, historyStore);

  await openAgentForTask(task, snapshot.providers);
};
