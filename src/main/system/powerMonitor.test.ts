import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

const powerMonitorMock = vi.hoisted(() => ({
  handlers: new Map<string, Handler[]>(),
  on: vi.fn((event: string, handler: Handler) => {
    powerMonitorMock.handlers.set(event, [...(powerMonitorMock.handlers.get(event) ?? []), handler]);
  }),
  off: vi.fn((event: string, handler: Handler) => {
    powerMonitorMock.handlers.set(
      event,
      (powerMonitorMock.handlers.get(event) ?? []).filter((item) => item !== handler)
    );
  }),
  emit: (event: string, ...args: unknown[]) => {
    for (const handler of powerMonitorMock.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}));

vi.mock("electron", () => ({
  powerMonitor: powerMonitorMock
}));

describe("SystemPowerMonitor", () => {
  beforeEach(() => {
    powerMonitorMock.handlers.clear();
    powerMonitorMock.on.mockClear();
    powerMonitorMock.off.mockClear();
  });

  it("系统休眠和恢复时调用恢复流程并记录状态", async () => {
    let currentNow = new Date("2026-07-02T06:00:00.000Z");
    const onSuspend = vi.fn();
    const onResume = vi.fn();
    const { SystemPowerMonitor } = await import("./powerMonitor");
    const monitor = new SystemPowerMonitor({
      onSuspend,
      onResume,
      now: () => currentNow
    });

    monitor.start();
    powerMonitorMock.emit("suspend");
    currentNow = new Date("2026-07-02T06:05:00.000Z");
    powerMonitorMock.emit("resume");
    await Promise.resolve();

    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(monitor.getStatus()).toEqual({
      suspended: false,
      lastSuspendedAt: "2026-07-02T06:00:00.000Z",
      lastResumedAt: "2026-07-02T06:05:00.000Z",
      lastError: null
    });
  });

  it("恢复流程失败时记录明确错误并允许停止监听", async () => {
    const onMonitorError = vi.fn();
    const { SystemPowerMonitor } = await import("./powerMonitor");
    const monitor = new SystemPowerMonitor({
      onSuspend: vi.fn(),
      onResume: vi.fn().mockRejectedValue(new Error("刷新失败")),
      onMonitorError
    });

    monitor.start();
    powerMonitorMock.emit("resume");
    await Promise.resolve();
    monitor.stop();
    powerMonitorMock.emit("resume");
    await Promise.resolve();

    expect(onMonitorError).toHaveBeenCalledWith("系统恢复处理失败：刷新失败");
    expect(monitor.getStatus().lastError).toBe("系统恢复处理失败：刷新失败");
    expect(powerMonitorMock.off).toHaveBeenCalledWith("suspend", expect.any(Function));
    expect(powerMonitorMock.off).toHaveBeenCalledWith("resume", expect.any(Function));
  });
});
