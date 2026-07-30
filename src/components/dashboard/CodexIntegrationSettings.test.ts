import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { nextTick, ref, type Ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@tauri-apps/api/event';
import type {
  CodexIntegrationAction,
  CodexIntegrationActionResult,
  CodexIntegrationPreview,
  CodexIntegrationStatus,
  CodexStatusSnapshot,
} from '@/shared/ipc/contracts';
import { useSettingsStore } from '@/stores';
import CodexIntegrationSettings from './CodexIntegrationSettings.vue';

const composableMocks = vi.hoisted(() => ({
  useCodexIntegration: vi.fn(),
  useCodexStatus: vi.fn(),
}));

vi.mock('@/composables', () => composableMocks);
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));

interface IntegrationMock {
  status: Ref<CodexIntegrationStatus | null>;
  preview: Ref<CodexIntegrationPreview | null>;
  lastResult: Ref<CodexIntegrationActionResult | null>;
  errorMessage: Ref<string | null>;
  isChecking: Ref<boolean>;
  isActing: Ref<boolean>;
  start: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  previewAction: ReturnType<typeof vi.fn>;
  confirmPreview: ReturnType<typeof vi.fn>;
  cancelPreview: ReturnType<typeof vi.fn>;
}

const integrationStatus = (
  patch: Partial<CodexIntegrationStatus> = {}
): CodexIntegrationStatus => ({
  selectedConfig: 'hooks_json',
  globalHooks: 'enabled',
  hook: 'waiting_trust',
  bridge: 'ready',
  codexHomeExists: true,
  selectedConfigFile: 'C:\\Users\\tester\\.codex\\hooks.json',
  bridgeFile: 'C:\\Users\\tester\\AppData\\Roaming\\CodePulse\\codepulse-codex-bridge.exe',
  message: null,
  ...patch,
});

const integrationPreview = (
  action: CodexIntegrationAction = 'install_or_repair'
): CodexIntegrationPreview => ({
  id: 'preview-1',
  action,
  targetFile: 'C:\\Users\\tester\\.codex\\hooks.json',
  bridgeFile: 'C:\\Users\\tester\\AppData\\Roaming\\CodePulse\\codepulse-codex-bridge.exe',
  changes: ['新增 7 个 CodePulse Hook 标记'],
  warnings: ['需要在 Codex 中确认信任'],
  canConfirm: true,
});

const codexSnapshot = (listenerStatus: CodexStatusSnapshot['listenerStatus']) =>
  ({
    revision: 1,
    generatedAtMs: 1_784_001_234_567,
    tasks: [],
    representativeTask: null,
    hasWaitingApproval: false,
    hasFailedTask: false,
    listenerStatus,
  }) satisfies CodexStatusSnapshot;

let integration: IntegrationMock;

describe('CodexIntegrationSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    integration = {
      status: ref(integrationStatus()),
      preview: ref(null),
      lastResult: ref(null),
      errorMessage: ref(null),
      isChecking: ref(false),
      isActing: ref(false),
      start: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      previewAction: vi.fn(async (action: CodexIntegrationAction) => {
        const nextPreview = integrationPreview(action);
        integration.preview.value = nextPreview;
        return nextPreview;
      }),
      confirmPreview: vi.fn(async (): Promise<CodexIntegrationActionResult> => ({
        action: 'install_or_repair',
        backupFile: 'hooks.json.codepulse-1.bak',
        bridgeCleanupPending: false,
        listenerStartFailed: false,
      })),
      cancelPreview: vi.fn(() => {
        integration.preview.value = null;
      }),
    };
    composableMocks.useCodexIntegration.mockReturnValue(integration);
    composableMocks.useCodexStatus.mockReturnValue({
      snapshot: ref(codexSnapshot('waiting_for_event')),
      start: vi.fn(async () => {}),
    });
    vi.mocked(emit).mockResolvedValue(undefined);
  });

  const mountSettings = () => {
    const pinia = createPinia();
    return {
      wrapper: mount(CodexIntegrationSettings, { global: { plugins: [pinia] } }),
      settings: useSettingsStore(pinia),
    };
  };

  it('展示 Rust 集成检查和当前监听状态，并在挂载时开始读取', async () => {
    const { wrapper } = mountSettings();
    await nextTick();

    expect(wrapper.text()).toContain('全局 Hooks：已启用');
    expect(wrapper.text()).toContain('CodePulse Hook：等待 Codex 信任');
    expect(wrapper.text()).toContain('监听状态：等待事件');
    expect(integration.start).toHaveBeenCalledTimes(1);
    expect(composableMocks.useCodexStatus).toHaveBeenCalledTimes(1);
  });

  it('收到真实事件后将等待信任的 Hook 展示为已安装', () => {
    composableMocks.useCodexStatus.mockReturnValue({
      snapshot: ref(codexSnapshot('running')),
      start: vi.fn(async () => {}),
    });
    const { wrapper } = mountSettings();

    expect(wrapper.text()).toContain('CodePulse Hook：已安装');
    expect(wrapper.text()).toContain('监听状态：正常监听');
  });

  it('展示 Rust 快照中最近事件的阶段、来源与脱敏摘要', () => {
    const latestTask = {
      sessionId: 'session-1',
      source: 'cli' as const,
      phase: 'running_tests' as const,
      taskSummary: '验证 Codex 状态岛',
      lastActivityAtMs: 1_784_001_234_567,
    };
    composableMocks.useCodexStatus.mockReturnValue({
      snapshot: ref({
        ...codexSnapshot('running'),
        tasks: [latestTask],
        representativeTask: latestTask,
      }),
      start: vi.fn(async () => {}),
    });
    const { wrapper } = mountSettings();

    expect(wrapper.text()).toContain('最近事件：运行测试 · Codex CLI');
    expect(wrapper.text()).toContain('验证 Codex 状态岛');
  });

  it('先显示安装预览，再只通过预览标识确认操作', async () => {
    const { wrapper } = mountSettings();

    await wrapper.get('[aria-label="预览安装或修复"]').trigger('click');
    await nextTick();

    expect(integration.previewAction).toHaveBeenCalledWith('install_or_repair');
    expect(wrapper.text()).toContain('新增 7 个 CodePulse Hook 标记');
    expect(wrapper.text()).toContain('需要在 Codex 中确认信任');

    await wrapper.get('[aria-label="确认 Codex 集成操作"]').trigger('click');

    expect(integration.confirmPreview).toHaveBeenCalledTimes(1);
  });

  it('取消预览不触发确认，并清除预览界面', async () => {
    integration.preview.value = integrationPreview('uninstall');
    const { wrapper } = mountSettings();

    await wrapper.get('[aria-label="取消 Codex 集成预览"]').trigger('click');
    await nextTick();

    expect(integration.cancelPreview).toHaveBeenCalledTimes(1);
    expect(integration.confirmPreview).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="确认 Codex 集成操作"]').exists()).toBe(false);
  });

  it('更改显示偏好只同步 Widget 显示，不请求 Hook 安装操作', async () => {
    const { wrapper, settings } = mountSettings();

    await wrapper.get<HTMLInputElement>('[aria-label="Codex 空闲时常驻"]').setValue(true);
    await wrapper.get<HTMLInputElement>('[aria-label="显示 Codex 脱敏操作摘要"]').setValue(false);

    expect(settings.codexIdleResident).toBe(true);
    expect(settings.showCodexOperationSummary).toBe(false);
    expect(emit).toHaveBeenLastCalledWith('codex-display-preferences-updated', {
      idleResident: true,
      showOperationSummary: false,
    });
    expect(integration.previewAction).not.toHaveBeenCalled();
    expect(integration.confirmPreview).not.toHaveBeenCalled();
  });

  it('将异步操作失败原因显示为可读提示', () => {
    integration.errorMessage.value = '配置已变化，请重新生成预览';
    const { wrapper } = mountSettings();

    expect(wrapper.get('[role="alert"]').text()).toContain('配置已变化，请重新生成预览');
  });

  it('显示确认后无需回滚的 Bridge 待清理和监听器启动提示', () => {
    integration.lastResult.value = {
      action: 'uninstall',
      backupFile: 'hooks.json.codepulse-1.bak',
      bridgeCleanupPending: true,
      listenerStartFailed: true,
    };
    const { wrapper } = mountSettings();

    expect(wrapper.text()).toContain('Bridge 待手动清理');
    expect(wrapper.text()).toContain('本地接收器未能启动');
    expect(wrapper.text()).toContain('hooks.json.codepulse-1.bak');
  });
});
