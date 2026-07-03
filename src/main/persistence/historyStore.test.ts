import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentActivity, AgentProvider, AgentStateSnapshot, AgentTask } from "../../shared/types/agent";
import { HistoryStore, type DiagnosticEvent } from "./historyStore";

const provider: AgentProvider = {
  id: "codex",
  name: "Codex",
  icon: "C",
  adapterType: "codex",
  enabled: true,
  connectionStatus: "connected",
  lastConnectedAt: "2026-07-01T08:00:00.000Z",
  lastErrorAt: null,
  capabilities: []
};

const task: AgentTask = {
  id: "task-1",
  providerId: "codex",
  sessionId: "session-1",
  title: "整理任务历史",
  projectName: "CodePulse",
  projectPath: "C:\\Users\\fengq\\Desktop\\Work\\杂\\CodePulse",
  status: "executing",
  stage: "落库",
  priority: "executing",
  startedAt: "2026-07-01T08:00:00.000Z",
  updatedAt: "2026-07-01T09:00:00.000Z",
  completedAt: null,
  lastActivityAt: "2026-07-01T09:00:00.000Z",
  lastActivityText: "写入任务历史",
  progressType: "unavailable",
  progressValue: null,
  completedSteps: null,
  totalSteps: null,
  waitingAction: null,
  errorCode: null,
  errorMessage: null,
  sourceId: "test"
};

const activity: AgentActivity = {
  id: "activity-1",
  taskId: "task-1",
  providerId: "codex",
  type: "message",
  title: "历史写入",
  description: "保存当前快照",
  createdAt: "2026-07-01T09:00:00.000Z",
  metadata: {
    step: 1
  }
};

const snapshot = (tasks: AgentTask[], activities: AgentActivity[]): AgentStateSnapshot => ({
  version: 1,
  generatedAt: "2026-07-01T09:00:00.000Z",
  providers: [provider],
  tasks,
  activities,
  quotas: [],
  summary: {
    status: "executing",
    label: "运行中",
    runningTaskCount: 1,
    waitingTaskCount: 0,
    failedTaskCount: 0,
    completedTaskCount: 0,
    disconnectedProviderCount: 0,
    quotaCriticalProviderCount: 0,
    primaryTaskId: "task-1",
    aggregateText: "1 个任务运行中",
    hasStaleData: false,
    updatedAt: "2026-07-01T09:00:00.000Z"
  }
});

describe("HistoryStore", () => {
  it("保存任务和活动历史并可重新打开读取", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-history-"));
    const filePath = path.join(directory, "history.sqlite");

    try {
      const store = new HistoryStore(filePath);
      await store.load();
      await store.saveSnapshot(snapshot([task], [activity]));

      expect(store.getRecentTasks().map((item) => item.id)).toEqual(["task-1"]);
      expect(store.getTaskActivities("task-1").map((item) => item.id)).toEqual(["activity-1"]);

      await store.close();

      const reopened = new HistoryStore(filePath);
      await reopened.load();

      expect(reopened.getRecentTasks()[0]).toMatchObject({
        id: "task-1",
        title: "整理任务历史",
        status: "executing"
      });
      expect(reopened.getTaskActivities("task-1")[0]).toMatchObject({
        id: "activity-1",
        title: "历史写入"
      });

      await reopened.close();
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("重复保存同一任务时更新历史记录而不是重复插入", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-history-"));
    const filePath = path.join(directory, "history.sqlite");

    try {
      const store = new HistoryStore(filePath);
      await store.load();
      await store.saveSnapshot(snapshot([task], []));
      await store.saveSnapshot(
        snapshot(
          [
            {
              ...task,
              status: "completed",
              priority: "completed",
              completedAt: "2026-07-01T10:00:00.000Z",
              updatedAt: "2026-07-01T10:00:00.000Z"
            }
          ],
          []
        )
      );

      const tasks = store.getRecentTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        id: "task-1",
        status: "completed",
        completedAt: "2026-07-01T10:00:00.000Z"
      });

      await store.close();
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("单次保存失败后仍允许后续快照继续写入", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-history-"));
    const filePath = path.join(directory, "history.sqlite");

    try {
      const store = new HistoryStore(filePath);
      await store.load();
      const brokenMetadata = {} as Record<string, unknown>;
      brokenMetadata.self = brokenMetadata;

      await expect(
        store.saveSnapshot(
          snapshot(
            [],
            [
              {
                ...activity,
                id: "activity-broken",
                metadata: brokenMetadata as AgentActivity["metadata"]
              }
            ]
          )
        )
      ).rejects.toThrow();

      await store.saveSnapshot(snapshot([task], [activity]));

      expect(store.getRecentTasks().map((item) => item.id)).toEqual(["task-1"]);
      expect(store.getTaskActivities("task-1").map((item) => item.id)).toEqual(["activity-1"]);

      await store.close();
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("历史数据库损坏时会备份旧文件并重建空库", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-history-"));
    const filePath = path.join(directory, "history.sqlite");

    try {
      await writeFile(filePath, Buffer.from("这不是 SQLite 数据库", "utf8"));

      const store = new HistoryStore(filePath);
      await store.load();

      const files = await readdir(directory);
      expect(files.some((file) => file.startsWith("history.sqlite.corrupt-"))).toBe(true);
      expect(store.getRecentTasks()).toEqual([]);
      expect(store.getRuntimeStatus()).toMatchObject({
        loaded: true,
        recoveredFromCorruption: true,
        lastCorruptBackupPath: expect.stringContaining("history.sqlite.corrupt-")
      });
      expect(store.getRecentDiagnosticEvents(1)[0]).toMatchObject({
        level: "error",
        source: "database",
        title: "历史数据库损坏",
        message: expect.stringContaining("历史数据库")
      });

      await store.saveSnapshot(snapshot([task], [activity]));
      expect(store.getRecentTasks().map((item) => item.id)).toEqual(["task-1"]);

      await store.close();
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("保存快照后会按保留期清理过期任务和活动", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-history-"));
    const filePath = path.join(directory, "history.sqlite");
    let currentNow = new Date("2026-06-20T09:00:00.000Z");
    const oldTask: AgentTask = {
      ...task,
      id: "old-task",
      sessionId: "old-session",
      updatedAt: "2026-06-20T09:00:00.000Z",
      lastActivityAt: "2026-06-20T09:00:00.000Z"
    };
    const oldActivity: AgentActivity = {
      ...activity,
      id: "old-activity",
      taskId: "old-task",
      createdAt: "2026-06-20T09:00:00.000Z"
    };
    const freshTask: AgentTask = {
      ...task,
      id: "fresh-task",
      sessionId: "fresh-session",
      updatedAt: "2026-07-02T09:00:00.000Z",
      lastActivityAt: "2026-07-02T09:00:00.000Z"
    };
    const freshActivity: AgentActivity = {
      ...activity,
      id: "fresh-activity",
      taskId: "fresh-task",
      createdAt: "2026-07-02T09:00:00.000Z"
    };

    try {
      const store = new HistoryStore(filePath, undefined, {
        retentionDays: 7,
        now: () => currentNow
      });
      await store.load();
      await store.saveSnapshot(snapshot([oldTask], [oldActivity]));

      expect(store.getRecentTasks().map((item) => item.id)).toEqual(["old-task"]);

      currentNow = new Date("2026-07-02T09:00:00.000Z");
      await store.saveSnapshot(snapshot([freshTask], [freshActivity]));

      expect(store.getRecentTasks().map((item) => item.id)).toEqual(["fresh-task"]);
      expect(store.getTaskActivities("old-task")).toEqual([]);
      expect(store.getTaskActivities("fresh-task").map((item) => item.id)).toEqual(["fresh-activity"]);
      expect(store.getRuntimeStatus()).toMatchObject({
        lastCleanupAt: "2026-07-02T09:00:00.000Z",
        lastCleanupDeletedTaskCount: 1,
        lastCleanupDeletedActivityCount: 1
      });

      await store.close();
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("保存诊断事件并可重新打开读取", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-history-"));
    const filePath = path.join(directory, "history.sqlite");
    const diagnosticEvent: DiagnosticEvent = {
      id: "diagnostic-1",
      level: "error",
      source: "database",
      title: "数据库损坏",
      message: "历史数据库完整性检查失败",
      createdAt: "2026-07-02T09:00:00.000Z",
      metadata: {
        backupPath: "C:\\Users\\fengq\\AppData\\Roaming\\CodePulse\\history.sqlite.corrupt"
      }
    };

    try {
      const store = new HistoryStore(filePath);
      await store.load();
      await store.recordDiagnosticEvent(diagnosticEvent);

      expect(store.getRecentDiagnosticEvents()).toMatchObject([
        {
          id: "diagnostic-1",
          level: "error",
          source: "database",
          title: "数据库损坏"
        }
      ]);

      await store.close();

      const reopened = new HistoryStore(filePath);
      await reopened.load();

      expect(reopened.getRecentDiagnosticEvents(5)[0]).toMatchObject({
        id: "diagnostic-1",
        message: "历史数据库完整性检查失败",
        metadata: {
          backupPath: "C:\\Users\\fengq\\AppData\\Roaming\\CodePulse\\history.sqlite.corrupt"
        }
      });

      await reopened.close();
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });
});
