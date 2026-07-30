import { getCurrentScope, onScopeDispose, ref } from 'vue';
import { codexCommands } from '@/shared/ipc/commands';
import type { CodexStatusSnapshot } from '@/shared/ipc/contracts';
import { CODEX_SNAPSHOT_UPDATED } from '@/shared/ipc/events';
import {
  createEventListenerRegistry,
  type EventListen,
} from '@/shared/utils/eventListenerRegistry';

export interface UseCodexStatusOptions {
  getSnapshot?: () => Promise<CodexStatusSnapshot>;
  listenEvent?: EventListen;
}

const createEmptySnapshot = (): CodexStatusSnapshot => ({
  revision: 0,
  generatedAtMs: 0,
  tasks: [],
  representativeTask: null,
  hasWaitingApproval: false,
  hasFailedTask: false,
  listenerStatus: 'stopped',
});

export const useCodexStatus = (options: UseCodexStatusOptions = {}) => {
  const getSnapshot = options.getSnapshot ?? codexCommands.getStatusSnapshot;
  const snapshot = ref<CodexStatusSnapshot>(createEmptySnapshot());
  const isLoading = ref(false);
  const eventListeners = createEventListenerRegistry(options.listenEvent);
  let disposed = false;
  let started = false;
  let generation = 0;
  let startTask: Promise<void> | null = null;

  const isCurrent = (requestGeneration: number) => !disposed && generation === requestGeneration;

  const applySnapshot = (nextSnapshot: CodexStatusSnapshot) => {
    if (disposed || nextSnapshot.revision < snapshot.value.revision) return;
    snapshot.value = nextSnapshot;
  };

  const start = (): Promise<void> => {
    if (disposed || started) return startTask ?? Promise.resolve();
    started = true;
    isLoading.value = true;
    const requestGeneration = generation;
    const task = (async () => {
      await eventListeners.register<CodexStatusSnapshot>(CODEX_SNAPSHOT_UPDATED, (event) => {
        applySnapshot(event.payload);
      });
      if (!isCurrent(requestGeneration)) return;

      try {
        applySnapshot(await getSnapshot());
      } catch (error) {
        if (isCurrent(requestGeneration)) console.error('读取 Codex 状态快照失败:', error);
      }
    })().finally(() => {
      if (isCurrent(requestGeneration)) {
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
