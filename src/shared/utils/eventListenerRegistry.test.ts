import { describe, expect, it, vi } from 'vitest';
import type { Event, UnlistenFn } from '@tauri-apps/api/event';
import { createEventListenerRegistry, type EventListen } from './eventListenerRegistry';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const event = <T>(payload: T): Event<T> => ({ event: '测试事件', id: 1, payload });

describe('createEventListenerRegistry', () => {
  it('销毁时清理全部监听器且重复销毁保持幂等', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const listenEvent: EventListen = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const registry = createEventListenerRegistry(listenEvent);

    await registry.register('事件一', () => {});
    await registry.register('事件二', () => {});
    registry.dispose();
    registry.dispose();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('销毁早于注册完成时立即清理迟到的监听器', async () => {
    const registration = deferred<UnlistenFn>();
    const unlisten = vi.fn();
    const listenEvent: EventListen = vi.fn(() => registration.promise);
    const registry = createEventListenerRegistry(listenEvent);

    const pending = registry.register('迟到事件', () => {});
    registry.dispose();
    registration.resolve(unlisten);
    await pending;

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('销毁后事件回调不会继续写入状态', async () => {
    let callback: ((event: Event<number>) => void) | undefined;
    const handler = vi.fn();
    const listenEvent: EventListen = vi.fn(async (_name, registered) => {
      callback = registered as (event: Event<number>) => void;
      return vi.fn();
    });
    const registry = createEventListenerRegistry(listenEvent);

    await registry.register<number>('计数事件', handler);
    callback?.(event(1));
    registry.dispose();
    callback?.(event(2));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event(1));
  });

  it('单个清理函数抛错不会阻断其余监听器清理', async () => {
    const first = vi.fn(() => {
      throw new Error('清理失败');
    });
    const second = vi.fn();
    const listenEvent: EventListen = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const registry = createEventListenerRegistry(listenEvent);

    await registry.register('事件一', () => {});
    await registry.register('事件二', () => {});
    expect(() => registry.dispose()).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('销毁后不再向底层注册新监听器', async () => {
    const listenEvent: EventListen = vi.fn(async () => vi.fn());
    const registry = createEventListenerRegistry(listenEvent);
    registry.dispose();

    await registry.register('无效事件', () => {});

    expect(listenEvent).not.toHaveBeenCalled();
  });

  it('异步事件处理失败时统一记录错误且不产生未处理拒绝', async () => {
    let callback: ((event: Event<number>) => void) | undefined;
    const listenEvent: EventListen = vi.fn(async (_name, registered) => {
      callback = registered as (event: Event<number>) => void;
      return vi.fn();
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = createEventListenerRegistry(listenEvent);
    await registry.register<number>('失败事件', async () => {
      throw new Error('处理失败');
    });

    callback?.(event(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith('事件处理失败:', expect.any(Error));
    consoleError.mockRestore();
  });

  it('单个底层监听注册失败不会阻断后续注册和清理', async () => {
    const unlisten = vi.fn();
    const listenEvent: EventListen = vi
      .fn()
      .mockRejectedValueOnce(new Error('首次注册失败'))
      .mockResolvedValueOnce(unlisten);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = createEventListenerRegistry(listenEvent);

    await expect(registry.register('失败事件', () => {})).resolves.toBeUndefined();
    await registry.register('成功事件', () => {});
    registry.dispose();

    expect(consoleError).toHaveBeenCalledWith('注册事件监听失败:', '失败事件', expect.any(Error));
    expect(listenEvent).toHaveBeenCalledTimes(2);
    expect(unlisten).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
