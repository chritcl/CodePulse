import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ExplorerRestartMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Explorer 进程 ID 变化时触发一次恢复回调", async () => {
    const probe = {
      getExplorerProcessIds: vi.fn().mockResolvedValueOnce([120]).mockResolvedValueOnce([260]).mockResolvedValueOnce([260])
    };
    const onExplorerRestart = vi.fn();
    const { ExplorerRestartMonitor } = await import("./explorerMonitor");
    const monitor = new ExplorerRestartMonitor({
      probe,
      pollIntervalMs: 1000,
      onExplorerRestart
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(onExplorerRestart).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it("Explorer 探测失败时上报监控错误但不触发恢复", async () => {
    const probe = {
      getExplorerProcessIds: vi.fn().mockRejectedValue(new Error("读取进程失败"))
    };
    const onExplorerRestart = vi.fn();
    const onMonitorError = vi.fn();
    const { ExplorerRestartMonitor } = await import("./explorerMonitor");
    const monitor = new ExplorerRestartMonitor({
      probe,
      pollIntervalMs: 1000,
      onExplorerRestart,
      onMonitorError
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onExplorerRestart).not.toHaveBeenCalled();
    expect(onMonitorError).toHaveBeenCalledWith("读取进程失败");
    monitor.stop();
  });
});
