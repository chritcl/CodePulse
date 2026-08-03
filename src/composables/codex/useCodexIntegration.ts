import { getCurrentScope, onScopeDispose, ref } from 'vue';
import { codexCommands } from '@/shared/ipc/commands';
import type {
  CodexIntegrationAction,
  CodexIntegrationActionResult,
  CodexIntegrationPreview,
  CodexIntegrationStatus,
} from '@/shared/ipc/contracts';
import { CODEX_INTEGRATION_UPDATED } from '@/shared/ipc/events';
import {
  createEventListenerRegistry,
  type EventListen,
} from '@/shared/utils/eventListenerRegistry';

export interface UseCodexIntegrationOptions {
  getStatus?: () => Promise<CodexIntegrationStatus>;
  requestPreview?: (action: CodexIntegrationAction) => Promise<CodexIntegrationPreview>;
  confirmPreview?: (previewId: string) => Promise<CodexIntegrationActionResult>;
  listenEvent?: EventListen;
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
};

export const useCodexIntegration = (options: UseCodexIntegrationOptions = {}) => {
  const getStatus = options.getStatus ?? codexCommands.getIntegrationStatus;
  const requestPreview = options.requestPreview ?? codexCommands.previewIntegration;
  const confirmPreviewRequest = options.confirmPreview ?? codexCommands.confirmIntegration;
  const status = ref<CodexIntegrationStatus | null>(null);
  const preview = ref<CodexIntegrationPreview | null>(null);
  const lastResult = ref<CodexIntegrationActionResult | null>(null);
  const errorMessage = ref<string | null>(null);
  const isChecking = ref(false);
  const isActing = ref(false);
  const eventListeners = createEventListenerRegistry(options.listenEvent);
  let disposed = false;
  let started = false;
  let statusGeneration = 0;
  let actionGeneration = 0;
  let startTask: Promise<void> | null = null;

  const isCurrentStatus = (generation: number) => !disposed && generation === statusGeneration;
  const isCurrentAction = (generation: number) => !disposed && generation === actionGeneration;

  const refresh = async () => {
    if (disposed) return;
    const generation = ++statusGeneration;
    isChecking.value = true;
    errorMessage.value = null;

    try {
      const nextStatus = await getStatus();
      if (isCurrentStatus(generation)) status.value = nextStatus;
    } catch (error) {
      if (isCurrentStatus(generation)) {
        errorMessage.value = getErrorMessage(error, '读取 Codex 集成状态失败');
      }
    } finally {
      if (isCurrentStatus(generation)) isChecking.value = false;
    }
  };

  const start = (): Promise<void> => {
    if (disposed || started) return startTask ?? Promise.resolve();
    started = true;
    const task = (async () => {
      await eventListeners.register<CodexIntegrationStatus>(CODEX_INTEGRATION_UPDATED, (event) => {
        if (disposed) return;
        statusGeneration += 1;
        status.value = event.payload;
        preview.value = null;
      });
      if (!disposed) await refresh();
    })().finally(() => {
      if (!disposed) startTask = null;
    });
    startTask = task;
    return task;
  };

  const previewAction = async (action: CodexIntegrationAction) => {
    if (disposed || isActing.value) return null;
    const generation = ++actionGeneration;
    isActing.value = true;
    preview.value = null;
    lastResult.value = null;
    errorMessage.value = null;

    try {
      const nextPreview = await requestPreview(action);
      if (!isCurrentAction(generation)) return null;
      preview.value = nextPreview;
      return nextPreview;
    } catch (error) {
      if (isCurrentAction(generation)) {
        errorMessage.value = getErrorMessage(error, '生成 Codex 集成预览失败');
      }
      return null;
    } finally {
      if (isCurrentAction(generation)) isActing.value = false;
    }
  };

  const confirmPreview = async () => {
    const currentPreview = preview.value;
    if (disposed || isActing.value || !currentPreview?.canConfirm) return null;
    const generation = ++actionGeneration;
    isActing.value = true;
    errorMessage.value = null;

    try {
      const result = await confirmPreviewRequest(currentPreview.id);
      if (!isCurrentAction(generation)) return null;
      preview.value = null;
      lastResult.value = result;
      await refresh();
      return result;
    } catch (error) {
      if (isCurrentAction(generation)) {
        errorMessage.value = getErrorMessage(error, '确认 Codex 集成操作失败');
      }
      return null;
    } finally {
      if (isCurrentAction(generation)) isActing.value = false;
    }
  };

  const cancelPreview = () => {
    if (disposed || isActing.value) return;
    preview.value = null;
    errorMessage.value = null;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    statusGeneration += 1;
    actionGeneration += 1;
    isChecking.value = false;
    isActing.value = false;
    eventListeners.dispose();
  };

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    status,
    preview,
    lastResult,
    errorMessage,
    isChecking,
    isActing,
    start,
    refresh,
    previewAction,
    confirmPreview,
    cancelPreview,
    dispose,
  };
};
