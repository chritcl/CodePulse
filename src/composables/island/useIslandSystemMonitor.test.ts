import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIslandSystemMonitor } from './useIslandSystemMonitor';

describe('灵动岛系统监控', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('根据累计字节差值更新网速和高流量状态', async () => {
    const commands = {
      getNetworkStats: vi
        .fn()
        .mockResolvedValueOnce([100, 50] as [number, number])
        .mockResolvedValueOnce([1_048_676, 150] as [number, number]),
      getHardwareStats: vi.fn(),
      getNetworkLatency: vi.fn().mockResolvedValue(20),
    };
    const monitor = useIslandSystemMonitor({
      hardwareEnabled: ref(false),
      rotationEnabled: ref(false),
      commands,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(800);

    expect(monitor.downloadSpeed.value).toBe('1.0 MB/s');
    expect(monitor.uploadSpeed.value).toBe('100 B/s');
    expect(monitor.isHighDownload.value).toBe(true);
    expect(monitor.isHighUpload.value).toBe(false);
    monitor.stop();
  });

  it('低流量断网超过保护期后进入错误状态并通知', async () => {
    let now = 0;
    const onToast = vi.fn();
    const commands = {
      getNetworkStats: vi.fn().mockResolvedValue([100, 50] as [number, number]),
      getHardwareStats: vi.fn(),
      getNetworkLatency: vi.fn().mockRejectedValue(new Error('离线')),
    };
    const monitor = useIslandSystemMonitor({
      hardwareEnabled: ref(false),
      rotationEnabled: ref(false),
      commands,
      now: () => now,
      onToast,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.networkStatus.value).toBe('warning');

    now = 6_000;
    await vi.advanceTimersByTimeAsync(5_500);

    expect(monitor.networkStatus.value).toBe('error');
    expect(onToast).toHaveBeenCalledWith('网络连接已断开', 'sys');
    monitor.stop();
  });

  it('连续高负载后触发强状态并在低于恢复阈值后解除', async () => {
    const commands = {
      getNetworkStats: vi.fn().mockResolvedValue([100, 50] as [number, number]),
      getHardwareStats: vi
        .fn()
        .mockResolvedValueOnce([95, 8_000, 16_000] as [number, number, number])
        .mockResolvedValueOnce([96, 8_000, 16_000] as [number, number, number])
        .mockResolvedValueOnce([80, 8_000, 16_000] as [number, number, number]),
      getNetworkLatency: vi.fn().mockResolvedValue(20),
    };
    const monitor = useIslandSystemMonitor({
      hardwareEnabled: ref(true),
      rotationEnabled: ref(false),
      commands,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(800);
    expect(monitor.hardwareStrongActive.value).toBe(false);

    await vi.advanceTimersByTimeAsync(800);
    expect(monitor.hardwareStrongActive.value).toBe(true);
    expect(monitor.hardwareVisualStatus.value).toBe('error');

    await vi.advanceTimersByTimeAsync(800);
    expect(monitor.hardwareStrongActive.value).toBe(false);
    expect(monitor.hardwareVisualStatus.value).toBe('warning');
    monitor.stop();
  });

  it('将真实 CPU 和内存换算为经过裁剪的数值百分比', async () => {
    const commands = {
      getNetworkStats: vi.fn().mockResolvedValue([100, 50] as [number, number]),
      getHardwareStats: vi
        .fn()
        .mockResolvedValueOnce([56.6, 15_550, 32_000] as [number, number, number])
        .mockResolvedValueOnce([140.2, 18_000, 16_000] as [number, number, number])
        .mockResolvedValueOnce([-4.2, 0, 0] as [number, number, number]),
      getNetworkLatency: vi.fn().mockResolvedValue(20),
    };
    const monitor = useIslandSystemMonitor({
      hardwareEnabled: ref(true),
      rotationEnabled: ref(false),
      commands,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(800);
    expect(monitor.cpuUsage.value).toBe(57);
    expect(monitor.memUsage.value).toBe(49);

    await vi.advanceTimersByTimeAsync(800);
    expect(monitor.cpuUsage.value).toBe(100);
    expect(monitor.memUsage.value).toBe(100);

    await vi.advanceTimersByTimeAsync(800);
    expect(monitor.cpuUsage.value).toBe(0);
    expect(monitor.memUsage.value).toBe(0);
    monitor.stop();
  });

  it('停止后丢弃尚未完成的旧请求并清理定时器', async () => {
    let resolveStats: ((value: [number, number]) => void) | undefined;
    const commands = {
      getNetworkStats: vi
        .fn()
        .mockResolvedValueOnce([100, 50] as [number, number])
        .mockImplementationOnce(
          () =>
            new Promise<[number, number]>((resolve) => {
              resolveStats = resolve;
            })
        ),
      getHardwareStats: vi.fn(),
      getNetworkLatency: vi.fn().mockResolvedValue(20),
    };
    const monitor = useIslandSystemMonitor({
      hardwareEnabled: ref(false),
      rotationEnabled: ref(false),
      commands,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(800);
    monitor.stop();
    resolveStats?.([1_048_676, 150]);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(monitor.downloadSpeed.value).toBe('0 KB/s');
    expect(commands.getNetworkStats).toHaveBeenCalledTimes(2);
  });
});
