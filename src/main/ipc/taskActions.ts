import { spawn } from "node:child_process";
import { shell } from "electron";
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
