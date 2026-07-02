import { describe, expect, it } from "vitest";
import {
  IpcValidationError,
  readHistoryLimit,
  readIslandMode,
  readOptionalProviderId,
  readOptionalTaskId,
  readPartialSettings,
  readProviderEnabled,
  readSnoozeUntil,
  readTaskId,
  toIpcError
} from "./validation";

describe("IPC 参数校验", () => {
  it("读取任务 ID 时会去除首尾空白并拒绝空值", () => {
    expect(readTaskId(" task-1 ")).toBe("task-1");
    expect(() => readTaskId(" ")).toThrow(IpcValidationError);
  });

  it("可选 ID 只接受未传或非空字符串", () => {
    expect(readOptionalTaskId(undefined)).toBeUndefined();
    expect(readOptionalTaskId(" task-1 ")).toBe("task-1");
    expect(readOptionalProviderId(undefined)).toBeUndefined();
    expect(readOptionalProviderId(" codex ")).toBe("codex");
    expect(() => readOptionalProviderId(12)).toThrow("数据源 ID 无效");
  });

  it("只允许预定义动态岛模式", () => {
    expect(readIslandMode("expanded")).toBe("expanded");
    expect(() => readIslandMode("fullscreen")).toThrow("动态岛模式无效");
  });

  it("读取稍后提醒时间时必须是有效 ISO 时间", () => {
    expect(readSnoozeUntil("2026-07-01T03:00:00.000Z")).toBe("2026-07-01T03:00:00.000Z");
    expect(() => readSnoozeUntil("明天")).toThrow("稍后提醒时间无效");
  });

  it("读取启用状态时校验数据源 ID 和布尔值", () => {
    expect(readProviderEnabled(" codex ", true)).toEqual({
      providerId: "codex",
      enabled: true
    });
    expect(readProviderEnabled("custom-command", false)).toEqual({
      providerId: "custom-command",
      enabled: false
    });
    expect(() => readProviderEnabled("codex", "true")).toThrow("启用状态无效");
    expect(() => readProviderEnabled("unknown-provider", true)).toThrow("数据源 ID 无效");
  });

  it("读取历史记录数量时限制范围并提供默认值", () => {
    expect(readHistoryLimit(undefined)).toBe(100);
    expect(readHistoryLimit(50)).toBe(50);
    expect(() => readHistoryLimit(0)).toThrow("历史记录数量无效");
    expect(() => readHistoryLimit(501)).toThrow("历史记录数量无效");
    expect(() => readHistoryLimit("50")).toThrow("历史记录数量无效");
  });

  it("设置更新只允许白名单字段和合法取值", () => {
    expect(
      readPartialSettings({
        display: {
          islandMode: "normal",
          opacity: 0.8,
          islandCustomPosition: {
            displayId: " primary ",
            x: -80,
            y: 120
          }
        },
        notifications: {
          quietHoursStart: "22:30",
          quotaWarningPercent: 25
        },
        providers: {
          codex: {
            enabled: false,
            statusFilePath: " C:\\Users\\fengq\\codex-status.json ",
            logFilePath: " C:\\Users\\fengq\\codex.log "
          },
          process: {
            enabled: false
          },
          log: {
            enabled: true,
            logFilePath: " C:\\Users\\fengq\\agent.log "
          },
          mock: {
            enabled: false
          },
          customCommand: {
            enabled: true,
            authorized: true,
            commandPath: " C:\\Tools\\agent-status.exe ",
            args: [" --json ", "--safe"],
            workingDirectory: " C:\\Users\\fengq\\agent ",
            timeoutMs: 3000,
            outputLimitBytes: 8192
          }
        },
        paused: true
      })
    ).toEqual({
      display: {
        islandMode: "normal",
        opacity: 0.8,
        islandCustomPosition: {
          displayId: "primary",
          x: -80,
          y: 120
        }
      },
      notifications: {
        quietHoursStart: "22:30",
        quotaWarningPercent: 25
      },
      providers: {
        codex: {
          enabled: false,
          statusFilePath: "C:\\Users\\fengq\\codex-status.json",
          logFilePath: "C:\\Users\\fengq\\codex.log"
        },
        process: {
          enabled: false
        },
        log: {
          enabled: true,
          logFilePath: "C:\\Users\\fengq\\agent.log"
        },
        mock: {
          enabled: false
        },
        customCommand: {
          enabled: true,
          authorized: true,
          commandPath: "C:\\Tools\\agent-status.exe",
          args: ["--json", "--safe"],
          workingDirectory: "C:\\Users\\fengq\\agent",
          timeoutMs: 3000,
          outputLimitBytes: 8192
        }
      },
      paused: true
    });

    expect(() => readPartialSettings({ display: { opacity: 2 } })).toThrow("透明度必须在 0 到 1 之间");
    expect(() => readPartialSettings({ display: { islandCustomPosition: { displayId: "primary", x: "0", y: 1 } } })).toThrow(
      "动态岛自定义位置无效"
    );
    expect(() => readPartialSettings({ notifications: { quietHoursStart: "99:99" } })).toThrow("勿扰时间格式无效");
    expect(() => readPartialSettings({ providers: { codex: { enabled: "false" } } })).toThrow("Codex 数据源启用状态无效");
    expect(() => readPartialSettings({ providers: { codex: { statusFilePath: 12 } } })).toThrow("Codex 状态源路径无效");
    expect(() => readPartialSettings({ providers: { codex: { logFilePath: 12 } } })).toThrow("Codex 日志源路径无效");
    expect(() => readPartialSettings({ providers: { process: { enabled: "false" } } })).toThrow("本机进程数据源启用状态无效");
    expect(() => readPartialSettings({ providers: { log: { enabled: "true" } } })).toThrow("通用日志数据源启用状态无效");
    expect(() => readPartialSettings({ providers: { log: { logFilePath: 12 } } })).toThrow("通用日志源路径无效");
    expect(() => readPartialSettings({ providers: { mock: { enabled: "false" } } })).toThrow("模拟数据源启用状态无效");
    expect(() => readPartialSettings({ providers: { customCommand: { commandPath: 12 } } })).toThrow("自定义命令路径无效");
    expect(() => readPartialSettings({ providers: { customCommand: { args: ["--json", 12] } } })).toThrow("自定义命令参数无效");
    expect(() => readPartialSettings({ providers: { customCommand: { timeoutMs: 500 } } })).toThrow("自定义命令超时时间无效");
    expect(() => readPartialSettings({ providers: { customCommand: { outputLimitBytes: 100 } } })).toThrow("自定义命令输出限制无效");
    expect(() => readPartialSettings({ providers: { customCommand: { elevated: true } } })).toThrow("自定义命令数据源设置字段无效");
    expect(() => readPartialSettings({ unknown: true })).toThrow("设置字段无效");
  });

  it("校验错误会归一化为 IPC_VALIDATION_ERROR", () => {
    expect(toIpcError(new IpcValidationError("任务 ID 无效"))).toEqual({
      code: "IPC_VALIDATION_ERROR",
      message: "任务 ID 无效"
    });
    expect(toIpcError(new Error("读取失败"))).toEqual({
      code: "IPC_ERROR",
      message: "读取失败"
    });
  });
});
