import { describe, expect, it, vi } from 'vitest';
import { createSettingsActionCoordinator } from './settingsActionCoordinator';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('设置操作协调器', () => {
  it('同步成功时保留新值并发送成功反馈', async () => {
    let value = false;
    const feedback = vi.fn();
    const coordinator = createSettingsActionCoordinator(feedback);

    await expect(
      coordinator.apply({
        key: 'music',
        getValue: () => value,
        setValue: (next) => {
          value = next;
        },
        nextValue: true,
        sync: async () => {},
        successMessage: '音乐控制已开启',
        errorMessage: '无法开启音乐控制',
      })
    ).resolves.toBe(true);

    expect(value).toBe(true);
    expect(feedback).toHaveBeenCalledWith({
      kind: 'success',
      message: '音乐控制已开启',
    });
  });

  it('最新同步失败时回滚原值并发送错误反馈', async () => {
    let value = false;
    const feedback = vi.fn();
    const coordinator = createSettingsActionCoordinator(feedback);

    await expect(
      coordinator.apply({
        key: 'hardware',
        getValue: () => value,
        setValue: (next) => {
          value = next;
        },
        nextValue: true,
        sync: async () => {
          throw new Error('同步失败');
        },
        successMessage: '硬件监控已开启',
        errorMessage: '无法开启硬件监控',
      })
    ).resolves.toBe(false);

    expect(value).toBe(false);
    expect(feedback).toHaveBeenCalledWith({
      kind: 'error',
      message: '无法开启硬件监控',
    });
  });

  it('旧请求迟到失败时不会覆盖更新值或错误提示', async () => {
    let value = false;
    const first = deferred<void>();
    const second = deferred<void>();
    const feedback = vi.fn();
    const coordinator = createSettingsActionCoordinator(feedback);

    const firstAction = coordinator.apply({
      key: 'music',
      getValue: () => value,
      setValue: (next) => {
        value = next;
      },
      nextValue: true,
      sync: () => first.promise,
      successMessage: '音乐控制已开启',
      errorMessage: '首次操作失败',
    });
    const secondAction = coordinator.apply({
      key: 'music',
      getValue: () => value,
      setValue: (next) => {
        value = next;
      },
      nextValue: false,
      sync: () => second.promise,
      successMessage: '音乐控制已关闭',
      errorMessage: '第二次操作失败',
    });

    second.resolve();
    await expect(secondAction).resolves.toBe(true);
    first.reject(new Error('迟到失败'));
    await expect(firstAction).resolves.toBe(false);

    expect(value).toBe(false);
    expect(feedback).toHaveBeenCalledTimes(1);
    expect(feedback).toHaveBeenCalledWith({
      kind: 'success',
      message: '音乐控制已关闭',
    });
  });
});
