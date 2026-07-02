import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LogAdapter } from "./LogAdapter";

const fixedNow = new Date("2026-07-01T03:00:00.000Z");

describe("LogAdapter", () => {
  it("可以从 UTF-8 JSONL 日志文件读取最新任务和额度事件", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-log-"));
    const logFilePath = path.join(directory, "agent.log");

    try {
      await writeFile(
        logFilePath,
        [
          JSON.stringify({
            type: "task",
            id: "session-1",
            title: "实现通用日志接入",
            projectName: "CodePulse",
            status: "executing",
            stage: "读取日志",
            progressType: "determinate",
            progressValue: 18,
            updatedAt: "2026-07-01T02:58:00.000Z"
          }),
          JSON.stringify({
            type: "task",
            id: "session-1",
            title: "实现通用日志接入",
            projectName: "CodePulse",
            status: "waiting",
            stage: "等待确认",
            lastActivityText: "Agent 等待用户确认",
            updatedAt: "2026-07-01T02:59:00.000Z"
          }),
          JSON.stringify({
            type: "quota",
            remainingPercent: 28,
            total: 100,
            used: 72,
            remaining: 28,
            isEstimated: true,
            capturedAt: "2026-07-01T02:59:30.000Z"
          })
        ].join("\n"),
        "utf8"
      );

      const adapter = new LogAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        logFilePath
      });

      await adapter.refresh();
      const tasks = await adapter.getCurrentTasks();
      const quota = await adapter.getQuota();

      expect(await adapter.getConnectionStatus()).toBe("connected");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.id).toBe("log-session-1");
      expect(tasks[0]?.providerId).toBe("log");
      expect(tasks[0]?.status).toBe("waiting");
      expect(tasks[0]?.stage).toBe("等待确认");
      expect(tasks[0]?.lastActivityText).toBe("Agent 等待用户确认");
      expect(tasks[0]?.progressValue).toBeNull();
      expect(quota.remainingPercent).toBe(28);
      expect(quota.isEstimated).toBe(true);
      expect(quota.source).toBe("log");
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("运行期更新日志源路径后下一次刷新读取新日志文件", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-log-hot-"));
    const logFilePath = path.join(directory, "agent.log");

    try {
      await writeFile(
        logFilePath,
        [
          JSON.stringify({
            type: "task",
            id: "hot-log",
            title: "热更新通用日志",
            projectName: "CodePulse",
            status: "executing",
            stage: "读取新路径"
          }),
          JSON.stringify({
            type: "quota",
            remainingPercent: 53
          })
        ].join("\n"),
        "utf8"
      );
      const adapter = new LogAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0
      });

      await adapter.refresh();
      await adapter.updateRuntimeConfig({
        logFilePath
      });
      await adapter.refresh();
      const tasks = await adapter.getCurrentTasks();
      const quota = await adapter.getQuota();

      expect(await adapter.getConnectionStatus()).toBe("connected");
      expect(tasks[0]?.id).toBe("log-hot-log");
      expect(tasks[0]?.stage).toBe("读取新路径");
      expect(quota.remainingPercent).toBe(53);
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("运行期清空日志源路径后不再沿用旧日志文件", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-log-clear-"));
    const logFilePath = path.join(directory, "agent.log");

    try {
      await writeFile(
        logFilePath,
        `${JSON.stringify({
          type: "task",
          id: "old-log",
          title: "旧日志源",
          status: "executing"
        })}\n`,
        "utf8"
      );
      const adapter = new LogAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        logFilePath
      });

      await adapter.refresh();
      await adapter.updateRuntimeConfig({
        logFilePath: null
      });
      await adapter.refresh();

      expect(await adapter.getConnectionStatus()).toBe("notFound");
      expect(await adapter.getCurrentTasks()).toEqual([]);
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("日志源未配置时返回明确状态和空任务", async () => {
    const adapter = new LogAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0
    });

    const detection = await adapter.detect();
    await adapter.refresh();

    expect(detection.detected).toBe(false);
    expect(detection.message).toBe("日志源未配置");
    expect(await adapter.getConnectionStatus()).toBe("notFound");
    expect(await adapter.getCurrentTasks()).toEqual([]);
  });

  it("日志源格式错误时降级为连接错误而不是抛出", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-log-bad-"));
    const logFilePath = path.join(directory, "agent.log");
    const errorCodes: string[] = [];

    try {
      await writeFile(logFilePath, "{bad json}\n", "utf8");

      const adapter = new LogAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        logFilePath
      });

      adapter.subscribe((event) => {
        if (event.type === "error:raised") {
          errorCodes.push(event.code);
        }
      });

      const detection = await adapter.detect();
      await adapter.refresh();

      expect(detection.detected).toBe(false);
      expect(detection.message).toBe("日志源数据格式无法解析");
      expect(await adapter.getConnectionStatus()).toBe("error");
      expect(await adapter.getCurrentTasks()).toEqual([]);
      expect(errorCodes).toContain("LOG_SOURCE_READ_FAILED");
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("额度不可用时返回空额度而不是 0%", async () => {
    const adapter = new LogAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0
    });

    const quota = await adapter.getQuota();

    expect(quota.remainingPercent).toBeNull();
    expect(quota.total).toBeNull();
    expect(quota.errorMessage).toBe("额度暂不可用");
  });

  it("只读取白名单任务字段且不暴露命令行敏感内容", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-log-secret-"));
    const logFilePath = path.join(directory, "agent.log");

    try {
      await writeFile(
        logFilePath,
        `${JSON.stringify({
          type: "task",
          id: "session-secret",
          title: "安全字段过滤",
          projectName: "CodePulse",
          status: "executing",
          stage: "读取日志",
          commandLine: "agent --api-key sk-test-secret C:\\Users\\fengq\\secret-project"
        })}\n`,
        "utf8"
      );

      const adapter = new LogAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        logFilePath
      });

      await adapter.refresh();
      const tasks = await adapter.getCurrentTasks();

      expect(tasks).toHaveLength(1);
      expect(JSON.stringify(tasks[0])).not.toContain("sk-test-secret");
      expect(JSON.stringify(tasks[0])).not.toContain("secret-project");
      expect(JSON.stringify(tasks[0])).not.toContain("commandLine");
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });
});
