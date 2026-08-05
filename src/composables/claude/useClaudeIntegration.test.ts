import { describe, expect, it, vi } from 'vitest';
import type { Event, UnlistenFn } from '@tauri-apps/api/event';
import type {
  ClaudeIntegrationAction,
  ClaudeIntegrationActionResult,
  ClaudeIntegrationPreview,
  ClaudeIntegrationStatus,
} from '@/shared/ipc/contracts';
import type { EventListen } from '@/shared/utils/eventListenerRegistry';
import { useClaudeIntegration } from './useClaudeIntegration';

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

const status = (hook: ClaudeIntegrationStatus['hook']): ClaudeIntegrationStatus => ({
  cli: 'ready',
  cliVersion: '2.1.221',
  minimumCliVersion: '2.1.221',
  hook,
  bridge: 'ready',
  settingsFile: 'C:\\Users\\tester\\.claude\\settings.json',
  bridgeFile: 'C:\\Users\\tester\\AppData\\Roaming\\CodePulse\\codepulse-claude-bridge.exe',
  cliFile: 'C:\\Users\\tester\\.local\\bin\\claude.exe',
  disableAllHooks: false,
  allowManagedHooksOnly: false,
  message: null,
});

const preview = (action: ClaudeIntegrationAction): ClaudeIntegrationPreview => ({
  id: `preview-${action}`,
  action,
  targetFile: 'C:\\Users\\tester\\.claude\\settings.json',
  bridgeFile: 'C:\\Users\\tester\\AppData\\Roaming\\CodePulse\\codepulse-claude-bridge.exe',
  changes: ['仅更新 CodePulse 标记'],
  warnings: [],
  canConfirm: true,
});

const result = (action: ClaudeIntegrationAction): ClaudeIntegrationActionResult => ({
  action,
  backupFile: 'settings.json.codepulse-1.bak',
  bridgeCleanupPending: false,
  listenerStartFailed: false,
});

const event = <T>(payload: T): Event<T> => ({
  event: 'claude-integration-updated',
  id: 1,
  payload,
});

describe('useClaudeIntegration', () => {
  it('实时检查事件先到时不允许较旧的初始检查覆盖它', async () => {
    const initialCheck = deferred<ClaudeIntegrationStatus>();
    let listener: ((received: Event<ClaudeIntegrationStatus>) => void) | undefined;
    const listenEvent: EventListen = async (_eventName, registered) => {
      listener = registered as (received: Event<ClaudeIntegrationStatus>) => void;
      return () => {};
    };
    const integration = useClaudeIntegration({
      getStatus: () => initialCheck.promise,
      listenEvent,
    });

    const starting = integration.start();
    await flushPromises();
    listener?.(event(status('installed')));
    initialCheck.resolve(status('not_installed'));
    await starting;

    expect(integration.status.value?.hook).toBe('installed');
  });

  it('预览处理中拒绝重复动作，并保留第一份有效预览', async () => {
    const pendingPreview = deferred<ClaudeIntegrationPreview>();
    const requestPreview = vi.fn(() => pendingPreview.promise);
    const integration = useClaudeIntegration({ requestPreview });

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
      .fn<() => Promise<ClaudeIntegrationStatus>>()
      .mockResolvedValueOnce(status('not_installed'))
      .mockResolvedValueOnce(status('installed'));
    const confirmPreview = vi
      .fn<(previewId: string) => Promise<ClaudeIntegrationActionResult>>()
      .mockResolvedValue(result('install_or_repair'));
    const integration = useClaudeIntegration({
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
    expect(integration.lastResult.value?.backupFile).toBe('settings.json.codepulse-1.bak');
    expect(integration.status.value?.hook).toBe('installed');
  });

  it('释放后忽略迟到检查结果并解除桌面事件监听器', async () => {
    const pendingCheck = deferred<ClaudeIntegrationStatus>();
    const unlisten = vi.fn<UnlistenFn>();
    const integration = useClaudeIntegration({
      getStatus: () => pendingCheck.promise,
      listenEvent: async () => unlisten,
    });

    const starting = integration.start();
    await flushPromises();
    integration.dispose();
    pendingCheck.resolve(status('installed'));
    await starting;

    expect(integration.status.value).toBeNull();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
