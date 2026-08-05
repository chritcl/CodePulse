import { getCurrentScope, onScopeDispose, ref } from 'vue';
import { claudeCommands } from '@/shared/ipc/commands';
import type {
  ClaudeIntegrationAction,
  ClaudeIntegrationActionResult,
  ClaudeIntegrationPreview,
  ClaudeIntegrationStatus,
} from '@/shared/ipc/contracts';
import { CLAUDE_INTEGRATION_UPDATED } from '@/shared/ipc/events';
import {
  createEventListenerRegistry,
  type EventListen,
} from '@/shared/utils/eventListenerRegistry';

export interface UseClaudeIntegrationOptions {
  getStatus?: () => Promise<ClaudeIntegrationStatus>;
  requestPreview?: (action: ClaudeIntegrationAction) => Promise<ClaudeIntegrationPreview>;
  confirmPreview?: (previewId: string) => Promise<ClaudeIntegrationActionResult>;
  listenEvent?: EventListen;
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
};

export const useClaudeIntegration = (options: UseClaudeIntegrationOptions = {}) => {
  const getStatus = options.getStatus ?? claudeCommands.getIntegrationStatus;
  const requestPreview = options.requestPreview ?? claudeCommands.previewIntegration;
  const confirmPreviewRequest = options.confirmPreview ?? claudeCommands.confirmIntegration;
  const status = ref<ClaudeIntegrationStatus | null>(null);
  const preview = ref<ClaudeIntegrationPreview | null>(null);
  const lastResult = ref<ClaudeIntegrationActionResult | null>(null);
  const errorMessage = ref<string | null>(null);
  const isChecking = ref(false);
  const isActing = ref(false);
  const eventListeners = createEventListenerRegistry(options.listenEvent);
  let disposed = false;
  let started = false;
  let statusGeneration = 0;
  let actionGeneration = 0;
  let startTask: Promise<void> | null = null;

  const refresh = async () => {
    if (disposed) return;
    const generation = ++statusGeneration;
    isChecking.value = true;
    errorMessage.value = null;
    try {
      const nextStatus = await getStatus();
      if (!disposed && generation === statusGeneration) status.value = nextStatus;
    } catch (error) {
      if (!disposed && generation === statusGeneration) {
        errorMessage.value = getErrorMessage(error, '读取 Claude Code 集成状态失败');
      }
    } finally {
      if (!disposed && generation === statusGeneration) isChecking.value = false;
    }
  };

  const start = (): Promise<void> => {
    if (disposed || started) return startTask ?? Promise.resolve();
    started = true;
    const task = (async () => {
      await eventListeners.register<ClaudeIntegrationStatus>(
        CLAUDE_INTEGRATION_UPDATED,
        (event) => {
          if (disposed) return;
          statusGeneration += 1;
          status.value = event.payload;
          preview.value = null;
        }
      );
      if (!disposed) await refresh();
    })().finally(() => {
      if (!disposed) startTask = null;
    });
    startTask = task;
    return task;
  };

  const previewAction = async (action: ClaudeIntegrationAction) => {
    if (disposed || isActing.value) return null;
    const generation = ++actionGeneration;
    isActing.value = true;
    preview.value = null;
    lastResult.value = null;
    errorMessage.value = null;
    try {
      const nextPreview = await requestPreview(action);
      if (disposed || generation !== actionGeneration) return null;
      preview.value = nextPreview;
      return nextPreview;
    } catch (error) {
      if (!disposed && generation === actionGeneration) {
        errorMessage.value = getErrorMessage(error, '生成 Claude Code 集成预览失败');
      }
      return null;
    } finally {
      if (!disposed && generation === actionGeneration) isActing.value = false;
    }
  };

  const confirmPreview = async () => {
    const current = preview.value;
    if (disposed || isActing.value || !current?.canConfirm) return null;
    const generation = ++actionGeneration;
    isActing.value = true;
    errorMessage.value = null;
    try {
      const result = await confirmPreviewRequest(current.id);
      if (disposed || generation !== actionGeneration) return null;
      preview.value = null;
      lastResult.value = result;
      await refresh();
      return result;
    } catch (error) {
      if (!disposed && generation === actionGeneration) {
        errorMessage.value = getErrorMessage(error, '确认 Claude Code 集成操作失败');
      }
      return null;
    } finally {
      if (!disposed && generation === actionGeneration) isActing.value = false;
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
