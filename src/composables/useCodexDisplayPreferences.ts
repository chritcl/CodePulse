import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { CodexDisplayPreferencesPayload } from '@/shared/ipc/contracts';
import { CODEX_DISPLAY_PREFERENCES_UPDATED } from '@/shared/ipc/events';
import { readBoolean } from '@/shared/utils/storage';
import {
  createEventListenerRegistry,
  type EventListen,
} from '@/shared/utils/eventListenerRegistry';

export interface UseCodexDisplayPreferencesOptions {
  listenEvent?: EventListen;
}

export const useCodexDisplayPreferences = (options: UseCodexDisplayPreferencesOptions = {}) => {
  const idleResident = ref(readBoolean('nsd_codex_idle_resident'));
  const showOperationSummary = ref(readBoolean('nsd_codex_show_operation_summary', true));
  const eventListeners = createEventListenerRegistry(options.listenEvent);
  let disposed = false;
  let started = false;
  let startTask: Promise<void> | null = null;

  const start = (): Promise<void> => {
    if (disposed || started) return startTask ?? Promise.resolve();
    started = true;
    const task = eventListeners
      .register<CodexDisplayPreferencesPayload>(CODEX_DISPLAY_PREFERENCES_UPDATED, (event) => {
        if (disposed) return;
        idleResident.value = event.payload.idleResident;
        showOperationSummary.value = event.payload.showOperationSummary;
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

  return { idleResident, showOperationSummary, start, dispose };
};
