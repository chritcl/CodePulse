import { describe, expect, it } from "vitest";
import { CustomCommandAdapter, type CustomCommandConfig, type CustomCommandRunner } from "./CustomCommandAdapter";

const fixedNow = new Date("2026-07-01T03:00:00.000Z");

const baseConfig: CustomCommandConfig = {
  enabled: true,
  authorized: true,
  commandPath: "agent-status.exe",
  args: ["--json"],
  workingDirectory: null,
  timeoutMs: 2000,
  outputLimitBytes: 4096
};

describe("CustomCommandAdapter", () => {
  it("默认禁用时不会执行命令并返回未启用状态", async () => {
    let runCount = 0;
    const runner: CustomCommandRunner = {
      run: async () => {
        runCount += 1;
        return {
          stdout: "{}",
          stderr: "",
          exitCode: 0
        };
      }
    };
    const adapter = new CustomCommandAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      runner,
      config: {
        ...baseConfig,
        enabled: false
      }
    });

    const detection = await adapter.detect();
    await adapter.refresh();

    expect(runCount).toBe(0);
    expect(detection.detected).toBe(false);
    expect(detection.provider.enabled).toBe(false);
    expect(detection.message).toBe("自定义命令未启用");
    expect(await adapter.getConnectionStatus()).toBe("notFound");
    expect(await adapter.getCurrentTasks()).toEqual([]);
  });

  it("未明确授权时不会执行命令并返回权限状态", async () => {
    let runCount = 0;
    const runner: CustomCommandRunner = {
      run: async () => {
        runCount += 1;
        return {
          stdout: "{}",
          stderr: "",
          exitCode: 0
        };
      }
    };
    const adapter = new CustomCommandAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      runner,
      config: {
        ...baseConfig,
        authorized: false
      }
    });

    await adapter.refresh();

    expect(runCount).toBe(0);
    expect(await adapter.getConnectionStatus()).toBe("permissionDenied");
    expect(await adapter.getCurrentTasks()).toEqual([]);
  });

  it("运行期更新授权和命令配置后无需重启即可执行新命令", async () => {
    let request: Parameters<CustomCommandRunner["run"]>[0] | null = null;
    let runCount = 0;
    const runner: CustomCommandRunner = {
      run: async (nextRequest) => {
        request = nextRequest;
        runCount += 1;

        return {
          stdout: JSON.stringify({
            tasks: [
              {
                id: "hot-update",
                title: "热更新任务",
                projectName: "CodePulse",
                status: "executing"
              }
            ]
          }),
          stderr: "",
          exitCode: 0
        };
      }
    };
    const adapter = new CustomCommandAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      runner,
      config: {
        ...baseConfig,
        authorized: false,
        commandPath: null,
        args: [],
        workingDirectory: null
      }
    });

    await adapter.refresh();
    await adapter.updateRuntimeConfig({
      authorized: true,
      commandPath: "C:\\Tools\\agent-status.exe",
      args: [" --json ", "--safe"],
      workingDirectory: " C:\\Users\\fengq\\agent ",
      timeoutMs: 4000,
      outputLimitBytes: 8192
    });
    await adapter.refresh();

    expect(runCount).toBe(1);
    expect(request).toEqual({
      commandPath: "C:\\Tools\\agent-status.exe",
      args: ["--json", "--safe"],
      workingDirectory: "C:\\Users\\fengq\\agent",
      timeoutMs: 4000,
      outputLimitBytes: 8192
    });
    expect(await adapter.getConnectionStatus()).toBe("connected");
    expect((await adapter.getCurrentTasks())[0]?.id).toBe("custom-command-hot-update");
  });

  it("执行授权命令后解析任务和额度且脱敏敏感输出", async () => {
    let request: Parameters<CustomCommandRunner["run"]>[0] | null = null;
    const runner: CustomCommandRunner = {
      run: async (nextRequest) => {
        request = nextRequest;

        return {
          stdout: JSON.stringify({
            tasks: [
              {
                id: "session-1",
                title: "同步自定义 Agent 状态",
                projectName: "CodePulse",
                status: "executing",
                stage: "读取命令输出",
                lastActivityText: "agent --api-key sk-test-secret C:\\Users\\fengq\\secret-project",
                progressType: "determinate",
                progressValue: 120,
                commandLine: "agent --token ghp_secret_token"
              }
            ],
            quota: {
              remainingPercent: 44,
              isEstimated: true
            }
          }),
          stderr: "",
          exitCode: 0
        };
      }
    };
    const adapter = new CustomCommandAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      runner,
      config: baseConfig
    });

    await adapter.refresh();
    const tasks = await adapter.getCurrentTasks();
    const quota = await adapter.getQuota();

    expect(request).toEqual({
      commandPath: "agent-status.exe",
      args: ["--json"],
      workingDirectory: null,
      timeoutMs: 2000,
      outputLimitBytes: 4096
    });
    expect(await adapter.getConnectionStatus()).toBe("connected");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("custom-command-session-1");
    expect(tasks[0]?.status).toBe("executing");
    expect(tasks[0]?.progressValue).toBe(100);
    expect(JSON.stringify(tasks[0])).not.toContain("sk-test-secret");
    expect(JSON.stringify(tasks[0])).not.toContain("secret-project");
    expect(JSON.stringify(tasks[0])).not.toContain("ghp_secret_token");
    expect(JSON.stringify(tasks[0])).not.toContain("commandLine");
    expect(JSON.stringify(tasks[0])).not.toContain("agent-status.exe");
    expect(quota.remainingPercent).toBe(44);
    expect(quota.isEstimated).toBe(true);
  });

  it("命令执行超时时转为明确错误状态", async () => {
    const errorCodes: string[] = [];
    const runner: CustomCommandRunner = {
      run: async () => {
        throw Object.assign(new Error("spawn timeout"), {
          code: "ETIMEDOUT"
        });
      }
    };
    const adapter = new CustomCommandAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      runner,
      config: baseConfig
    });

    adapter.subscribe((event) => {
      if (event.type === "error:raised") {
        errorCodes.push(event.code);
      }
    });

    await adapter.refresh();

    expect(await adapter.getConnectionStatus()).toBe("error");
    expect(await adapter.getCurrentTasks()).toEqual([]);
    expect(errorCodes).toContain("CUSTOM_COMMAND_TIMEOUT");
  });

  it("命令输出无法解析时转为明确错误状态", async () => {
    const errorCodes: string[] = [];
    const runner: CustomCommandRunner = {
      run: async () => ({
        stdout: "{bad json}",
        stderr: "",
        exitCode: 0
      })
    };
    const adapter = new CustomCommandAdapter({
      now: () => fixedNow,
      scanIntervalMs: 0,
      runner,
      config: baseConfig
    });

    adapter.subscribe((event) => {
      if (event.type === "error:raised") {
        errorCodes.push(event.code);
      }
    });

    await adapter.refresh();

    expect(await adapter.getConnectionStatus()).toBe("error");
    expect(await adapter.getCurrentTasks()).toEqual([]);
    expect(errorCodes).toContain("CUSTOM_COMMAND_PARSE_FAILED");
  });
});
