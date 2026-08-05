import { getCurrentScope, onScopeDispose, ref } from 'vue';
import { claudeCommands } from '@/shared/ipc/commands';
import type { ClaudeStatusSnapshot } from '@/shared/ipc/contracts';
import { CLAUDE_SNAPSHOT_UPDATED } from '@/shared/ipc/events';
import {
  createEventListenerRegistry,
  type EventListen,
} from '@/shared/utils/eventListenerRegistry';

export interface UseClaudeStatusOptions {
  getSnapshot?: () => Promise<ClaudeStatusSnapshot>;
  listenEvent?: EventListen;
}

const createEmptySnapshot = (): ClaudeStatusSnapshot => ({
  revision: 0,
  generatedAtMs: 0,
  sessions: [],
  representativeSession: null,
  hasWaitingApproval: false,
  hasFailedTask: false,
  listenerStatus: 'stopped',
});

export const useClaudeStatus = (options: UseClaudeStatusOptions = {}) => {
  const getSnapshot = options.getSnapshot ?? claudeCommands.getStatusSnapshot;
  const snapshot = ref<ClaudeStatusSnapshot>(createEmptySnapshot());
  const isLoading = ref(false);
  const eventListeners = createEventListenerRegistry(options.listenEvent);
  let disposed = false;
  let started = false;
  let generation = 0;
  let startTask: Promise<void> | null = null;

  const applySnapshot = (nextSnapshot: ClaudeStatusSnapshot) => {
    if (disposed || nextSnapshot.revision < snapshot.value.revision) return;
    snapshot.value = nextSnapshot;
  };

  const start = (): Promise<void> => {
    if (disposed || started) return startTask ?? Promise.resolve();
    started = true;
    isLoading.value = true;
    const requestGeneration = generation;
    const task = (async () => {
      await eventListeners.register<ClaudeStatusSnapshot>(CLAUDE_SNAPSHOT_UPDATED, (event) => {
        applySnapshot(event.payload);
      });
      if (disposed || generation !== requestGeneration) return;
      try {
        applySnapshot(await getSnapshot());
      } catch (error) {
        if (!disposed && generation === requestGeneration) {
          console.error('读取 Claude Code 状态快照失败:', error);
        }
      }
    })().finally(() => {
      if (!disposed && generation === requestGeneration) {
        isLoading.value = false;
        startTask = null;
      }
    });
    startTask = task;
    return task;
  };

  const dispose = () => {
    if (disposed) return;
    generation += 1;
    disposed = true;
    isLoading.value = false;
    eventListeners.dispose();
  };

  if (getCurrentScope()) onScopeDispose(dispose);
  return { snapshot, isLoading, start, dispose };
};
