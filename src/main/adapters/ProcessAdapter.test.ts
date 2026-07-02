import { describe, expect, it } from "vitest";
import { ProcessAdapter, type ProcessInfo, type ProcessProbe } from "./ProcessAdapter";

const fixedNow = new Date("2026-07-01T03:00:00.000Z");

const createProbe = (processes: ProcessInfo[]): ProcessProbe => ({
  listProcesses: async () => processes
});

describe("ProcessAdapter", () => {
  it("检测到已知 Agent 进程后生成运行中任务且不暴露命令行参数", async () => {
    const adapter = new ProcessAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: createProbe([
        {
          pid: 3021,
          name: "claude.exe",
          commandLine: "claude --api-key sk-test-secret C:\\Users\\fengq\\secret-project"
        }
      ])
    });

    const detection = await adapter.detect();
    await adapter.start();
    const tasks = await adapter.getCurrentTasks();

    expect(detection.detected).toBe(true);
    expect(detection.provider.connectionStatus).toBe("connected");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      providerId: "process",
      title: "Claude Code 进程运行中",
      status: "executing",
      stage: "进程运行",
      progressType: "indeterminate",
      projectPath: null,
      sourceId: "process-claude-code"
    });
    expect(JSON.stringify(tasks[0])).toContain("PID 3021");
    expect(JSON.stringify(tasks[0])).not.toContain("sk-test-secret");
    expect(JSON.stringify(tasks[0])).not.toContain("secret-project");
  });

  it("未发现已知 Agent 进程时返回未运行状态和空任务", async () => {
    const events: string[] = [];
    const adapter = new ProcessAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: createProbe([
        {
          pid: 11,
          name: "notepad.exe",
          commandLine: "notepad.exe"
        }
      ])
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

  it("进程探测异常时转为连接错误而不是抛出", async () => {
    const adapter = new ProcessAdapter({
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

  it("额度不可用时返回空额度而不是 0%", async () => {
    const adapter = new ProcessAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      processProbe: createProbe([])
    });

    const quota = await adapter.getQuota();

    expect(quota.remainingPercent).toBeNull();
    expect(quota.total).toBeNull();
    expect(quota.errorMessage).toBe("额度暂不可用");
  });
});
