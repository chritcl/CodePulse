import { describe, expect, it, vi } from 'vitest';
import { createMusicTargetCoordinator } from './musicTargetCoordinator';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('musicTargetCoordinator', () => {
  it('后续目标写入必须等待前一次完成', async () => {
    const firstWrite = deferred<void>();
    const writeTarget = vi
      .fn<(player: string) => Promise<void>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    const coordinator = createMusicTargetCoordinator(writeTarget);

    const first = coordinator.select('netease').committed;
    const second = coordinator.select('qqmusic').committed;
    await Promise.resolve();
    expect(writeTarget).toHaveBeenCalledTimes(1);

    firstWrite.resolve();
    await Promise.all([first, second]);
    expect(writeTarget.mock.calls.map(([player]) => player)).toEqual(['netease', 'qqmusic']);
  });

  it('前一次写入失败不会阻断后续目标', async () => {
    const writeTarget = vi
      .fn<(player: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('写入失败'))
      .mockResolvedValueOnce(undefined);
    const coordinator = createMusicTargetCoordinator(writeTarget);

    const first = coordinator.select('netease').committed;
    const second = coordinator.select('qqmusic').committed;

    await expect(first).rejects.toThrow('写入失败');
    await expect(second).resolves.toBeUndefined();
    expect(writeTarget).toHaveBeenCalledTimes(2);
  });

  it('等待旧目标时如果被新目标取代则继续等待最新提交', async () => {
    const firstWrite = deferred<void>();
    const writeTarget = vi
      .fn<(player: string) => Promise<void>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    const coordinator = createMusicTargetCoordinator(writeTarget);

    coordinator.select('netease');
    const waiting = coordinator.waitForCurrent();
    const latest = coordinator.select('qqmusic');
    firstWrite.reject(new Error('过期写入失败'));

    await expect(waiting).resolves.toBe(latest);
  });

  it('停止造成的失效不能跨越重启继续等待', async () => {
    const firstWrite = deferred<void>();
    const writeTarget = vi
      .fn<(player: string) => Promise<void>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    const coordinator = createMusicTargetCoordinator(writeTarget);

    coordinator.select('netease');
    const waiting = coordinator.waitForCurrent();
    coordinator.invalidate();
    const restarted = coordinator.select('qqmusic');
    firstWrite.resolve();

    await expect(waiting).resolves.toBeNull();
    await expect(restarted.committed).resolves.toBeUndefined();
  });
});
