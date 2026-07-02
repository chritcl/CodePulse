import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexAdapter, type CodexProcessProbe, type CodexStatusSource } from "./CodexAdapter";

const fixedNow = new Date("2026-07-01T03:00:00.000Z");

const createProbe = (processes: Awaited<ReturnType<CodexProcessProbe["listProcesses"]>>): CodexProcessProbe => ({
  listProcesses: async () => processes
});

const createStatusSource = (status: Awaited<ReturnType<CodexStatusSource["readStatus"]>>): CodexStatusSource => ({
  readStatus: async () => status
});

describe("CodexAdapter", () => {
  it("检测到 Codex 进程后生成运行中任务且不暴露命令参数", async () => {
    const adapter = new CodexAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: createProbe([
        {
          pid: 321,
          name: "codex.exe",
          commandLine: "codex --api-key sk-test-secret C:\\Users\\fengq\\secret-project"
        }
      ])
    });

    const detection = await adapter.detect();
    await adapter.start();
    const tasks = await adapter.getCurrentTasks();

    expect(detection.detected).toBe(true);
    expect(detection.provider.connectionStatus).toBe("connected");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("executing");
    expect(tasks[0]?.stage).toBe("进程运行");
    expect(tasks[0]?.progressType).toBe("indeterminate");
    expect(tasks[0]?.projectPath).toBeNull();
    expect(JSON.stringify(tasks[0])).not.toContain("sk-test-secret");
    expect(JSON.stringify(tasks[0])).not.toContain("secret-project");
  });

  it("未检测到 Codex 进程时降级为未运行状态", async () => {
    const events: string[] = [];
    const adapter = new CodexAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: createProbe([])
    });

    adapter.subscribe((event) => {
      if (event.type === "connection:changed") {
        events.push(event.status);
      }
    });

    await adapter.start();

    expect(await adapter.getConnectionStatus()).toBe("notRunning");
    expect(await adapter.getCurrentTasks()).toEqual([]);
    expect(events).toContain("notRunning");
  });

  it("额度不可用时返回空额度而不是 0%", async () => {
    const adapter = new CodexAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: createProbe([])
    });
    const quota = await adapter.getQuota();

    expect(quota.remainingPercent).toBeNull();
    expect(quota.total).toBeNull();
    expect(quota.errorMessage).toBe("额度暂不可用");
  });

  it("进程检测异常时转换为连接错误而不是抛出", async () => {
    const adapter = new CodexAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: {
        listProcesses: async () => {
          throw new Error("进程列表读取失败");
        }
      }
    });

    const detection = await adapter.detect();
    await adapter.refresh();

    expect(detection.detected).toBe(false);
    expect(detection.message).toBe("进程列表读取失败");
    expect(await adapter.getConnectionStatus()).toBe("error");
    expect(await adapter.getCurrentTasks()).toEqual([]);
  });

  it("优先从可配置状态源读取任务和额度", async () => {
    const adapter = new CodexAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: createProbe([]),
      statusSource: createStatusSource({
        tasks: [
          {
            id: "session-1",
            sessionId: "session-1",
            title: "实现状态源解析",
            projectName: "CodePulse",
            status: "testing",
            stage: "运行测试",
            updatedAt: fixedNow.toISOString(),
            lastActivityText: "29 项测试通过",
            progressType: "determinate",
            progressValue: 42
          }
        ],
        quota: {
          remainingPercent: 42,
          total: 100,
          used: 58,
          remaining: 42
        }
      })
    });

    await adapter.start();
    const tasks = await adapter.getCurrentTasks();
    const quota = await adapter.getQuota();

    expect(await adapter.getConnectionStatus()).toBe("connected");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("实现状态源解析");
    expect(tasks[0]?.status).toBe("testing");
    expect(tasks[0]?.progressValue).toBe(42);
    expect(quota.remainingPercent).toBe(42);
    expect(quota.errorMessage).toBeNull();
  });

  it("状态源没有数据时回退到进程检测", async () => {
    const adapter = new CodexAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: createProbe([
        {
          pid: 654,
          name: "codex.exe",
          commandLine: "codex"
        }
      ]),
      statusSource: createStatusSource(null)
    });

    await adapter.start();
    const tasks = await adapter.getCurrentTasks();

    expect(await adapter.getConnectionStatus()).toBe("connected");
    expect(tasks[0]?.sourceId).toBe("codex-process");
    expect(tasks[0]?.stage).toBe("进程运行");
  });

  it("状态源格式错误时降级为连接错误状态", async () => {
    const adapter = new CodexAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: createProbe([]),
      statusSource: createStatusSource({
        tasks: [
          {
            id: "bad-task",
            status: "running"
          }
        ]
      })
    });

    await adapter.refresh();

    expect(await adapter.getConnectionStatus()).toBe("error");
    expect(await adapter.getCurrentTasks()).toEqual([]);
  });

  it("可以从 UTF-8 JSON 状态文件读取状态源", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-codex-"));
    const statusFilePath = path.join(directory, "status.json");

    try {
      await writeFile(
        statusFilePath,
        `${JSON.stringify({
          tasks: [
            {
              id: "file-session",
              title: "读取状态文件",
              status: "executing",
              stage: "解析 JSON"
            }
          ]
        })}\n`,
        "utf8"
      );

      const adapter = new CodexAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        processProbe: createProbe([]),
        statusFilePath
      });

      await adapter.refresh();
      const tasks = await adapter.getCurrentTasks();

      expect(tasks[0]?.id).toBe("codex-status-file-session");
      expect(tasks[0]?.stage).toBe("解析 JSON");
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("运行期更新状态源路径后下一次刷新读取新状态文件", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-codex-hot-status-"));
    const statusFilePath = path.join(directory, "status.json");

    try {
      await writeFile(
        statusFilePath,
        `${JSON.stringify({
          tasks: [
            {
              id: "hot-status",
              title: "热更新状态源",
              status: "testing",
              stage: "读取新路径"
            }
          ],
          quota: {
            remainingPercent: 61
          }
        })}\n`,
        "utf8"
      );
      const adapter = new CodexAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        processProbe: createProbe([])
      });

      await adapter.refresh();
      await adapter.updateRuntimeConfig({
        statusFilePath
      });
      await adapter.refresh();
      const tasks = await adapter.getCurrentTasks();
      const quota = await adapter.getQuota();

      expect(await adapter.getConnectionStatus()).toBe("connected");
      expect(tasks[0]?.id).toBe("codex-status-hot-status");
      expect(tasks[0]?.stage).toBe("读取新路径");
      expect(quota.remainingPercent).toBe(61);
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("运行期清空状态源路径后不再沿用旧状态文件", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-codex-clear-status-"));
    const statusFilePath = path.join(directory, "status.json");

    try {
      await writeFile(
        statusFilePath,
        `${JSON.stringify({
          tasks: [
            {
              id: "old-status",
              title: "旧状态源",
              status: "executing"
            }
          ]
        })}\n`,
        "utf8"
      );
      const adapter = new CodexAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        processProbe: createProbe([]),
        statusFilePath
      });

      await adapter.refresh();
      await adapter.updateRuntimeConfig({
        statusFilePath: null
      });
      await adapter.refresh();

      expect(await adapter.getConnectionStatus()).toBe("notRunning");
      expect(await adapter.getCurrentTasks()).toEqual([]);
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("可以从 UTF-8 JSONL 日志文件读取最新任务和额度事件", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-codex-log-"));
    const logFilePath = path.join(directory, "codex.log");

    try {
      await writeFile(
        logFilePath,
        [
          JSON.stringify({
            type: "task",
            id: "session-1",
            title: "实现日志源解析",
            projectName: "CodePulse",
            status: "executing",
            stage: "读取日志",
            updatedAt: "2026-07-01T02:58:00.000Z"
          }),
          JSON.stringify({
            type: "task",
            id: "session-1",
            title: "实现日志源解析",
            projectName: "CodePulse",
            status: "waiting",
            stage: "等待确认",
            lastActivityText: "Codex 等待用户输入",
            updatedAt: "2026-07-01T02:59:00.000Z"
          }),
          JSON.stringify({
            type: "quota",
            remainingPercent: 33,
            isEstimated: true,
            capturedAt: "2026-07-01T02:59:30.000Z"
          })
        ].join("\n"),
        "utf8"
      );

      const adapter = new CodexAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        processProbe: createProbe([]),
        logFilePath
      });

      await adapter.refresh();
      const tasks = await adapter.getCurrentTasks();
      const quota = await adapter.getQuota();

      expect(await adapter.getConnectionStatus()).toBe("connected");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.id).toBe("codex-log-session-1");
      expect(tasks[0]?.status).toBe("waiting");
      expect(tasks[0]?.stage).toBe("等待确认");
      expect(tasks[0]?.lastActivityText).toBe("Codex 等待用户输入");
      expect(quota.remainingPercent).toBe(33);
      expect(quota.isEstimated).toBe(true);
      expect(quota.source).toBe("codex-log");
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("运行期更新日志源路径后下一次刷新读取新日志文件", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-codex-hot-log-"));
    const logFilePath = path.join(directory, "codex.log");

    try {
      await writeFile(
        logFilePath,
        [
          JSON.stringify({
            type: "task",
            id: "hot-log",
            title: "热更新日志源",
            status: "waiting",
            stage: "读取新日志",
            lastActivityText: "日志路径已更新"
          }),
          JSON.stringify({
            type: "quota",
            remainingPercent: 27
          })
        ].join("\n"),
        "utf8"
      );
      const adapter = new CodexAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        processProbe: createProbe([])
      });

      await adapter.refresh();
      await adapter.updateRuntimeConfig({
        logFilePath
      });
      await adapter.refresh();
      const tasks = await adapter.getCurrentTasks();
      const quota = await adapter.getQuota();

      expect(await adapter.getConnectionStatus()).toBe("connected");
      expect(tasks[0]?.id).toBe("codex-log-hot-log");
      expect(tasks[0]?.stage).toBe("读取新日志");
      expect(quota.remainingPercent).toBe(27);
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("日志源格式错误时降级为连接错误状态", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-codex-bad-log-"));
    const logFilePath = path.join(directory, "codex.log");

    try {
      await writeFile(logFilePath, "{bad json}\n", "utf8");

      const adapter = new CodexAdapter({
        now: () => fixedNow,
        scanIntervalMs: 0,
        processProbe: createProbe([]),
        logFilePath
      });

      await adapter.refresh();

      expect(await adapter.getConnectionStatus()).toBe("error");
      expect(await adapter.getCurrentTasks()).toEqual([]);
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });
});
