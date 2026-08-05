import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { ClaudeDisplayPreferencesPayload } from '@/shared/ipc/contracts';
import { CLAUDE_DISPLAY_PREFERENCES_UPDATED } from '@/shared/ipc/events';
import { readBoolean } from '@/shared/utils/storage';
import {
  createEventListenerRegistry,
  type EventListen,
} from '@/shared/utils/eventListenerRegistry';

export interface UseClaudeDisplayPreferencesOptions {
  listenEvent?: EventListen;
}

export const useClaudeDisplayPreferences = (options: UseClaudeDisplayPreferencesOptions = {}) => {
  const idleResident = ref(readBoolean('codepulse_claude_idle_resident'));
  const showOperationSummary = ref(readBoolean('codepulse_claude_show_operation_summary', true));
  const showTaskSummary = ref(readBoolean('codepulse_claude_show_task_summary'));
  const eventListeners = createEventListenerRegistry(options.listenEvent);
  let disposed = false;
  let started = false;
  let startTask: Promise<void> | null = null;

  const start = (): Promise<void> => {
    if (disposed || started) return startTask ?? Promise.resolve();
    started = true;
    const task = eventListeners
      .register<ClaudeDisplayPreferencesPayload>(CLAUDE_DISPLAY_PREFERENCES_UPDATED, (event) => {
        if (disposed) return;
        idleResident.value = event.payload.idleResident;
        showOperationSummary.value = event.payload.showOperationSummary;
        showTaskSummary.value = event.payload.showTaskSummary;
      })
      .finally(() => {
        if (!disposed) startTask = null;
      });
    startTask = task;
    return task;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    eventListeners.dispose();
  };

  if (getCurrentScope()) onScopeDispose(dispose);
  return { idleResident, showOperationSummary, showTaskSummary, start, dispose };
};
