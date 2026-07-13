import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';

export type EventListen = <T>(
  eventName: string,
  handler: (event: Event<T>) => void
) => Promise<UnlistenFn>;

type EventHandler<T> = (event: Event<T>) => void | Promise<void>;

/** 统一管理异步注册的桌面事件监听器 */
export const createEventListenerRegistry = (listenEvent: EventListen = listen) => {
  const listeners = new Set<UnlistenFn>();
  let disposed = false;

  const safelyUnlisten = (unlisten: UnlistenFn) => {
    try {
      unlisten();
    } catch {
      // 单个监听器清理失败时继续清理其余监听器
    }
  };

  const reportHandlerError = (error: unknown) => {
    console.error('事件处理失败:', error);
  };

  const register = async <T>(eventName: string, handler: EventHandler<T>): Promise<void> => {
    if (disposed) return;
    let unlisten: UnlistenFn;
    try {
      unlisten = await listenEvent<T>(eventName, (event) => {
        if (disposed) return;
        try {
          void Promise.resolve(handler(event)).catch(reportHandlerError);
        } catch (error) {
          reportHandlerError(error);
        }
      });
    } catch (error) {
      console.error('注册事件监听失败:', eventName, error);
      return;
    }
    if (disposed) {
      safelyUnlisten(unlisten);
      return;
    }
    listeners.add(unlisten);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const currentListeners = [...listeners];
    listeners.clear();
    currentListeners.forEach(safelyUnlisten);
  };

  return { register, dispose };
};
