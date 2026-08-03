import { describe, expect, it, vi } from 'vitest';
import type { Event, UnlistenFn } from '@tauri-apps/api/event';
import type {
  CodexIntegrationAction,
  CodexIntegrationActionResult,
  CodexIntegrationPreview,
  CodexIntegrationStatus,
} from '@/shared/ipc/contracts';
import type { EventListen } from '@/shared/utils/eventListenerRegistry';
import { useCodexIntegration } from './useCodexIntegration';

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

const status = (hook: CodexIntegrationStatus['hook']): CodexIntegrationStatus => ({
  selectedConfig: 'hooks_json',
  globalHooks: 'enabled',
  hook,
  bridge: 'ready',
  codexHomeExists: true,
  selectedConfigFile: 'C:\\Users\\tester\\.codex\\hooks.json',
  bridgeFile: 'C:\\Users\\tester\\AppData\\Roaming\\CodePulse\\codepulse-codex-bridge.exe',
  message: null,
});

const preview = (action: CodexIntegrationAction): CodexIntegrationPreview => ({
  id: `preview-${action}`,
  action,
  targetFile: 'C:\\Users\\tester\\.codex\\hooks.json',
  bridgeFile: 'C:\\Users\\tester\\AppData\\Roaming\\CodePulse\\codepulse-codex-bridge.exe',
  changes: ['仅更新 CodePulse 标记'],
  warnings: [],
  canConfirm: true,
});

const result = (action: CodexIntegrationAction): CodexIntegrationActionResult => ({
  action,
  backupFile: 'hooks.json.codepulse-1.bak',
  bridgeCleanupPending: false,
  listenerStartFailed: false,
});

const event = <T>(payload: T): Event<T> => ({
  event: 'codex-integration-updated',
  id: 1,
  payload,
});

describe('useCodexIntegration', () => {
  it('实时检查事件先到时不允许较旧的初始检查覆盖它', async () => {
    const initialCheck = deferred<CodexIntegrationStatus>();
    let listener: ((received: Event<CodexIntegrationStatus>) => void) | undefined;
    const listenEvent: EventListen = async (_eventName, registered) => {
      listener = registered as (received: Event<CodexIntegrationStatus>) => void;
      return () => {};
    };
    const integration = useCodexIntegration({
      getStatus: () => initialCheck.promise,
      listenEvent,
    });

    const starting = integration.start();
    await flushPromises();
    listener?.(event(status('waiting_trust')));
    initialCheck.resolve(status('not_installed'));
    await starting;

    expect(integration.status.value?.hook).toBe('waiting_trust');
  });

  it('预览处理中拒绝重复动作，并保留第一份有效预览', async () => {
    const pendingPreview = deferred<CodexIntegrationPreview>();
    const requestPreview = vi.fn(() => pendingPreview.promise);
    const integration = useCodexIntegration({ requestPreview });

    const first = integration.previewAction('install_or_repair');
    const duplicate = integration.previewAction('uninstall');
    pendingPreview.resolve(preview('install_or_repair'));

    await expect(first).resolves.toMatchObject({ action: 'install_or_repair' });
    await expect(duplicate).resolves.toBeNull();
    expect(requestPreview).toHaveBeenCalledTimes(1);
    expect(integration.preview.value?.action).toBe('install_or_repair');
  });

  it('确认预览后刷新检查状态并清除一次性预览', async () => {
    const getStatus = vi
      .fn<() => Promise<CodexIntegrationStatus>>()
      .mockResolvedValueOnce(status('not_installed'))
      .mockResolvedValueOnce(status('waiting_trust'));
    const confirmPreview = vi
      .fn<(previewId: string) => Promise<CodexIntegrationActionResult>>()
      .mockResolvedValue(result('install_or_repair'));
    const integration = useCodexIntegration({
      getStatus,
      requestPreview: async () => preview('install_or_repair'),
      confirmPreview,
    });

    await integration.refresh();
    await integration.previewAction('install_or_repair');
    await expect(integration.confirmPreview()).resolves.toMatchObject({
      action: 'install_or_repair',
    });

    expect(confirmPreview).toHaveBeenCalledWith('preview-install_or_repair');
    expect(integration.preview.value).toBeNull();
    expect(integration.lastResult.value?.backupFile).toBe('hooks.json.codepulse-1.bak');
    expect(integration.status.value?.hook).toBe('waiting_trust');
  });

  it('释放后忽略迟到检查结果并解除桌面事件监听器', async () => {
    const pendingCheck = deferred<CodexIntegrationStatus>();
    const unlisten = vi.fn<UnlistenFn>();
    const integration = useCodexIntegration({
      getStatus: () => pendingCheck.promise,
      listenEvent: async () => unlisten,
    });

    const starting = integration.start();
    await flushPromises();
    integration.dispose();
    pendingCheck.resolve(status('waiting_trust'));
    await starting;

    expect(integration.status.value).toBeNull();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
