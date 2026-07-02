import { describe, expect, it } from "vitest";
import type { AgentActivity, AgentTask } from "../../../shared/types/agent";
import { buildCenterTaskSource, filterCenterTasks, getCenterFilterOptions, getTaskTimeline } from "./centerTaskFilters";

const fixedNow = new Date("2026-07-01T12:00:00.000Z");

const makeTask = (partial: Partial<AgentTask> & Pick<AgentTask, "id" | "status">): AgentTask => ({
  id: partial.id,
  providerId: partial.providerId ?? "codex",
  sessionId: `${partial.id}-session`,
  title: partial.title ?? `${partial.id} 任务`,
  projectName: partial.projectName ?? "默认项目",
  projectPath: partial.projectPath ?? null,
  status: partial.status,
  stage: partial.stage ?? "执行阶段",
  priority: partial.priority ?? "executing",
  startedAt: partial.startedAt ?? "2026-07-01T08:00:00.000Z",
  updatedAt: partial.updatedAt ?? "2026-07-01T10:00:00.000Z",
  completedAt: partial.completedAt ?? null,
  lastActivityAt: partial.lastActivityAt ?? partial.updatedAt ?? "2026-07-01T10:00:00.000Z",
  lastActivityText: partial.lastActivityText ?? "正在处理文件",
  progressType: partial.progressType ?? "unavailable",
  progressValue: partial.progressValue ?? null,
  completedSteps: partial.completedSteps ?? null,
  totalSteps: partial.totalSteps ?? null,
  waitingAction: partial.waitingAction ?? null,
  errorCode: partial.errorCode ?? null,
  errorMessage: partial.errorMessage ?? null,
  sourceId: partial.sourceId ?? "test"
});

const makeActivity = (id: string, taskId: string, createdAt: string): AgentActivity => ({
  id,
  taskId,
  providerId: "codex",
  type: "message",
  title: `${id} 活动`,
  description: "活动描述",
  createdAt,
  metadata: {}
});

describe("任务中心筛选逻辑", () => {
  it("按状态分组、关键词、数据源、项目和时间范围筛选任务", () => {
    const tasks = [
      makeTask({
        id: "running",
        status: "executing",
        title: "生成发布说明",
        projectName: "CodePulse",
        providerId: "codex",
        updatedAt: "2026-07-01T10:00:00.000Z"
      }),
      makeTask({
        id: "waiting",
        status: "waiting",
        title: "等待用户确认",
        projectName: "CodePulse",
        providerId: "codex",
        updatedAt: "2026-07-01T09:00:00.000Z"
      }),
      makeTask({
        id: "failed",
        status: "failed",
        title: "同步设计稿失败",
        projectName: "设计系统",
        providerId: "mock",
        updatedAt: "2026-06-29T09:00:00.000Z"
      }),
      makeTask({
        id: "completed",
        status: "completed",
        title: "完成构建验证",
        projectName: "CodePulse",
        providerId: "codex",
        updatedAt: "2026-06-20T09:00:00.000Z"
      })
    ];

    expect(
      filterCenterTasks(tasks, {
        status: "running",
        keyword: "发布",
        providerId: "codex",
        projectName: "CodePulse",
        timeRange: "last24h",
        now: fixedNow
      }).map((task) => task.id)
    ).toEqual(["running"]);

    expect(
      filterCenterTasks(tasks, {
        status: "history",
        keyword: "",
        providerId: null,
        projectName: null,
        timeRange: "all",
        now: fixedNow
      }).map((task) => task.id)
    ).toEqual(["failed", "completed"]);
  });

  it("生成项目和数据源筛选选项并按名称稳定排序", () => {
    const tasks = [
      makeTask({ id: "a", status: "executing", providerId: "mock", projectName: "设计系统" }),
      makeTask({ id: "b", status: "waiting", providerId: "codex", projectName: "CodePulse" }),
      makeTask({ id: "c", status: "failed", providerId: "codex", projectName: "CodePulse" })
    ];

    expect(getCenterFilterOptions(tasks)).toEqual({
      providers: ["codex", "mock"],
      projects: ["CodePulse", "设计系统"]
    });
  });

  it("只展示当前任务活动并按时间倒序排列", () => {
    const activities = [
      makeActivity("old", "task-1", "2026-07-01T08:00:00.000Z"),
      makeActivity("other", "task-2", "2026-07-01T11:00:00.000Z"),
      makeActivity("new", "task-1", "2026-07-01T10:00:00.000Z")
    ];

    expect(getTaskTimeline(activities, "task-1").map((activity) => activity.id)).toEqual(["new", "old"]);
    expect(getTaskTimeline(activities, null)).toEqual([]);
  });

  it("历史模式会合并持久化历史任务并让当前快照覆盖同 ID 记录", () => {
    const currentTasks = [
      makeTask({
        id: "current",
        status: "executing",
        title: "当前运行任务"
      }),
      makeTask({
        id: "done",
        status: "completed",
        title: "当前完成标题",
        updatedAt: "2026-07-01T11:00:00.000Z"
      })
    ];
    const historyTasks = [
      makeTask({
        id: "done",
        status: "completed",
        title: "历史旧标题",
        updatedAt: "2026-06-30T11:00:00.000Z"
      }),
      makeTask({
        id: "old-failed",
        status: "failed",
        title: "历史失败任务"
      })
    ];

    expect(buildCenterTaskSource(currentTasks, historyTasks, false).map((item) => item.id)).toEqual(["current", "done"]);
    expect(buildCenterTaskSource(currentTasks, historyTasks, true)).toMatchObject([
      {
        id: "done",
        title: "当前完成标题"
      },
      {
        id: "old-failed",
        title: "历史失败任务"
      },
      {
        id: "current",
        title: "当前运行任务"
      }
    ]);
  });
});
