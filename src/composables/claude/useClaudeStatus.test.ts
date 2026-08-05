import { describe, expect, it, vi } from 'vitest';
import type { Event } from '@tauri-apps/api/event';
import type { ClaudeStatusSnapshot } from '@/shared/ipc/contracts';
import { useClaudeStatus } from './useClaudeStatus';

const emptySnapshot = (revision: number): ClaudeStatusSnapshot => ({
  revision,
  generatedAtMs: revision,
  sessions: [],
  representativeSession: null,
  hasWaitingApproval: false,
  hasFailedTask: false,
  listenerStatus: 'waiting_for_event',
});

describe('useClaudeStatus', () => {
  it('监听快照事件并在释放时注销监听器', async () => {
    let listener: ((event: Event<ClaudeStatusSnapshot>) => void) | undefined;
    const unlisten = vi.fn();
    const listenEvent = vi.fn(async (_event, handler) => {
      listener = handler as (event: Event<ClaudeStatusSnapshot>) => void;
      return unlisten;
    });
    const status = useClaudeStatus({
      getSnapshot: async () => emptySnapshot(1),
      listenEvent,
    });

    await status.start();
    listener?.({ event: 'claude-snapshot-updated', id: 1, payload: emptySnapshot(2) });
    expect(status.snapshot.value.revision).toBe(2);

    status.dispose();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('忽略晚于事件返回的旧初始快照', async () => {
    let resolveSnapshot: ((snapshot: ClaudeStatusSnapshot) => void) | undefined;
    let listener: ((event: Event<ClaudeStatusSnapshot>) => void) | undefined;
    const status = useClaudeStatus({
      getSnapshot: () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        }),
      listenEvent: async (_event, handler) => {
        listener = handler as (event: Event<ClaudeStatusSnapshot>) => void;
        return () => {};
      },
    });

    const start = status.start();
    await vi.waitFor(() => expect(resolveSnapshot).toBeTypeOf('function'));
    listener?.({ event: 'claude-snapshot-updated', id: 1, payload: emptySnapshot(3) });
    resolveSnapshot?.(emptySnapshot(1));
    await start;

    expect(status.snapshot.value.revision).toBe(3);
    status.dispose();
  });
});
