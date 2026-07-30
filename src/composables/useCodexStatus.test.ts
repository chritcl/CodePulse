import { describe, expect, it, vi } from 'vitest';
import type { Event, UnlistenFn } from '@tauri-apps/api/event';
import type { CodexStatusSnapshot, CodexTaskPhase } from '@/shared/ipc/contracts';
import type { EventListen } from '@/shared/utils/eventListenerRegistry';
import { useCodexStatus } from './useCodexStatus';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const flushPromises = async () => {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
};

const snapshot = (revision: number, phase: CodexTaskPhase = 'analyzing'): CodexStatusSnapshot => ({
  revision,
  generatedAtMs: 1_784_001_234_567 + revision,
  tasks: [
    {
      sessionId: `session-${revision}`,
      source: 'cli',
      phase,
      projectName: 'CodePulse',
      taskSummary: '实现 Codex 状态岛',
      lastActivityAtMs: 1_784_001_234_500 + revision,
    },
  ],
  representativeTask: {
    sessionId: `session-${revision}`,
    source: 'cli',
    phase,
    projectName: 'CodePulse',
    taskSummary: '实现 Codex 状态岛',
    lastActivityAtMs: 1_784_001_234_500 + revision,
  },
  hasWaitingApproval: phase === 'waiting_approval',
  hasFailedTask: phase === 'failed',
  listenerStatus: 'running',
});

const event = <T>(payload: T): Event<T> => ({
  event: 'codex-snapshot-updated',
  id: 1,
  payload,
});

describe('useCodexStatus', () => {
  it('接收新快照并忽略 revision 更旧的迟到事件', async () => {
    let listener: ((received: Event<CodexStatusSnapshot>) => void) | undefined;
    const listenEvent: EventListen = async (_eventName, registered) => {
      listener = registered as (received: Event<CodexStatusSnapshot>) => void;
      return () => {};
    };
    const status = useCodexStatus({
      getSnapshot: async () => snapshot(3),
      listenEvent,
    });

    await status.start();
    listener?.(event(snapshot(5, 'waiting_approval')));
    listener?.(event(snapshot(4, 'failed')));

    expect(status.snapshot.value.revision).toBe(5);
    expect(status.snapshot.value.representativeTask?.phase).toBe('waiting_approval');
  });

  it('释放后不接受迟到读取结果，并清理桌面事件监听器', async () => {
    const request = deferred<CodexStatusSnapshot>();
    const unlisten = vi.fn<UnlistenFn>();
    const listenEvent: EventListen = async () => unlisten;
    const status = useCodexStatus({
      getSnapshot: () => request.promise,
      listenEvent,
    });

    const starting = status.start();
    await flushPromises();
    status.dispose();
    request.resolve(snapshot(8));
    await starting;

    expect(status.snapshot.value.revision).toBe(0);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('实时事件先到时不允许较旧的初始快照覆盖它', async () => {
    const request = deferred<CodexStatusSnapshot>();
    let listener: ((received: Event<CodexStatusSnapshot>) => void) | undefined;
    const listenEvent: EventListen = async (_eventName, registered) => {
      listener = registered as (received: Event<CodexStatusSnapshot>) => void;
      return () => {};
    };
    const status = useCodexStatus({
      getSnapshot: () => request.promise,
      listenEvent,
    });

    const starting = status.start();
    await flushPromises();
    listener?.(event(snapshot(6, 'waiting_approval')));
    request.resolve(snapshot(5, 'running_tests'));
    await starting;

    expect(status.snapshot.value.revision).toBe(6);
    expect(status.snapshot.value.representativeTask?.phase).toBe('waiting_approval');
  });
});
