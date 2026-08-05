import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@tauri-apps/api/event';
import type { ClaudeIntegrationStatus, ClaudeStatusSnapshot } from '@/shared/ipc/contracts';
import { useSettingsStore } from '@/stores';
import ClaudeIntegrationSettings from './ClaudeIntegrationSettings.vue';

const composableMocks = vi.hoisted(() => ({
  useClaudeIntegration: vi.fn(),
  useClaudeStatus: vi.fn(),
}));
const commandMocks = vi.hoisted(() => ({
  setTaskSummaryCapture: vi.fn(async () => {}),
}));

vi.mock('@/composables', () => composableMocks);
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(async () => {}) }));
vi.mock('@/shared/ipc/commands', () => ({ claudeCommands: commandMocks }));

const integrationStatus = (
  patch: Partial<ClaudeIntegrationStatus> = {}
): ClaudeIntegrationStatus => ({
  cli: 'ready',
  cliVersion: '2.1.221',
  minimumCliVersion: '2.1.221',
  hook: 'not_installed',
  bridge: 'ready',
  settingsFile: 'C:\\Users\\tester\\.claude\\settings.json',
  bridgeFile: 'C:\\Users\\tester\\AppData\\Roaming\\CodePulse\\codepulse-claude-bridge.exe',
  cliFile: 'C:\\Users\\tester\\.local\\bin\\claude.exe',
  disableAllHooks: false,
  allowManagedHooksOnly: false,
  message: null,
  ...patch,
});

const emptySnapshot: ClaudeStatusSnapshot = {
  revision: 1,
  generatedAtMs: 1,
  sessions: [],
  representativeSession: null,
  hasWaitingApproval: false,
  hasFailedTask: false,
  listenerStatus: 'waiting_for_event',
};

const createIntegration = (statusPatch: Partial<ClaudeIntegrationStatus> = {}) => ({
  status: ref(integrationStatus(statusPatch)),
  preview: ref(null),
  lastResult: ref(null),
  errorMessage: ref(null),
  isChecking: ref(false),
  isActing: ref(false),
  start: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  previewAction: vi.fn(async () => null),
  confirmPreview: vi.fn(async () => null),
  cancelPreview: vi.fn(),
});

let integration: ReturnType<typeof createIntegration>;

describe('ClaudeIntegrationSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    integration = createIntegration();
    composableMocks.useClaudeIntegration.mockReturnValue(integration);
    composableMocks.useClaudeStatus.mockReturnValue({
      snapshot: ref(emptySnapshot),
      start: vi.fn(async () => {}),
    });
  });

  const mountSettings = () => {
    const pinia = createPinia();
    return {
      wrapper: mount(ClaudeIntegrationSettings, { global: { plugins: [pinia] } }),
      settings: useSettingsStore(pinia),
    };
  };

  it('展示 CLI、Hook 与监听状态并在挂载时同步默认摘要偏好', async () => {
    integration.status.value = integrationStatus({ hook: 'installed' });
    const { wrapper } = mountSettings();
    await nextTick();

    expect(wrapper.text()).toContain('CLI：已就绪 · 2.1.221');
    expect(wrapper.text()).toContain('CodePulse Hook：已安装');
    expect(wrapper.text()).toContain('监听状态：等待事件');
    expect(integration.start).toHaveBeenCalledOnce();
    expect(commandMocks.setTaskSummaryCapture).toHaveBeenCalledWith(false);
  });

  it('配置无法解析时禁止安装或修复', () => {
    integration.status.value = integrationStatus({ hook: 'manual_intervention' });
    const { wrapper } = mountSettings();

    expect(
      wrapper.get('[aria-label="预览安装或修复 Claude Code 集成"]').attributes('disabled')
    ).toBeDefined();
  });

  it('默认隐藏任务摘要并在偏好开启后展示', async () => {
    const latestSession = {
      taskKey: 'claude:session:session-1',
      sessionId: 'session-1',
      phase: 'running_tests' as const,
      effectivePhase: 'running_tests' as const,
      projectName: 'CodePulse',
      taskSummary: '验证 Claude Code 状态岛',
      children: [],
      lastActivityAtMs: 2_000,
    };
    composableMocks.useClaudeStatus.mockReturnValue({
      snapshot: ref({
        ...emptySnapshot,
        listenerStatus: 'running',
        sessions: [latestSession],
        representativeSession: latestSession,
      }),
      start: vi.fn(async () => {}),
    });
    const { wrapper, settings } = mountSettings();

    expect(wrapper.text()).toContain('最近事件：运行测试 · CLI');
    expect(wrapper.text()).not.toContain('验证 Claude Code 状态岛');

    settings.showClaudeTaskSummary = true;
    await nextTick();

    expect(wrapper.text()).toContain('验证 Claude Code 状态岛');
  });

  it('更改显示偏好只同步摘要捕获与 Widget 显示', async () => {
    const { wrapper, settings } = mountSettings();

    await wrapper.get<HTMLInputElement>('[aria-label="Claude Code 空闲时常驻"]').setValue(true);
    await wrapper
      .get<HTMLInputElement>('[aria-label="显示 Claude Code 脱敏操作摘要"]')
      .setValue(false);
    await wrapper
      .get<HTMLInputElement>('[aria-label="显示 Claude Code 脱敏任务摘要"]')
      .setValue(true);

    expect(settings.claudeIdleResident).toBe(true);
    expect(settings.showClaudeOperationSummary).toBe(false);
    expect(settings.showClaudeTaskSummary).toBe(true);
    expect(commandMocks.setTaskSummaryCapture).toHaveBeenLastCalledWith(true);
    expect(emit).toHaveBeenLastCalledWith('claude-display-preferences-updated', {
      idleResident: true,
      showOperationSummary: false,
      showTaskSummary: true,
    });
    expect(integration.previewAction).not.toHaveBeenCalled();
    expect(integration.confirmPreview).not.toHaveBeenCalled();
  });

  it('CLI 缺失时仍允许卸载可解析配置中的已有标记', () => {
    integration.status.value = integrationStatus({
      cli: 'missing',
      cliVersion: null,
      hook: 'installed',
    });
    const { wrapper } = mountSettings();

    expect(
      wrapper.get('[aria-label="预览卸载 Claude Code 集成"]').attributes('disabled')
    ).toBeUndefined();
  });
});
