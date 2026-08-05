import { shallowMount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import type { useSettingsActions } from '@/composables/dashboard/useSettingsActions';
import SettingsDetailView from './SettingsDetailView.vue';

type SettingsActions = ReturnType<typeof useSettingsActions>;
const actions = {} as SettingsActions;

describe('SettingsDetailView', () => {
  it('按分类展示对应标题和面板，并提供返回设置首页按钮', async () => {
    const wrapper = shallowMount(SettingsDetailView, {
      props: {
        category: 'appearance',
        actions,
        appVersion: '2.3.8',
        isCheckingUpdate: false,
        hasNewVersion: false,
      },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.text()).toContain('外观与动效');
    expect(wrapper.findComponent({ name: 'AppearanceSettingsPanel' }).exists()).toBe(true);

    await wrapper.get('[aria-label="返回设置首页"]').trigger('click');
    expect(wrapper.emitted('back')).toHaveLength(1);
  });

  it('Codex 分类继续使用现有集成面板', () => {
    const wrapper = shallowMount(SettingsDetailView, {
      props: {
        category: 'codex',
        actions,
        appVersion: '2.3.8',
        isCheckingUpdate: false,
        hasNewVersion: false,
      },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.findComponent({ name: 'CodexIntegrationSettings' }).exists()).toBe(true);
  });

  it('Claude 分类使用独立的 CLI 集成面板', () => {
    const wrapper = shallowMount(SettingsDetailView, {
      props: {
        category: 'claude',
        actions,
        appVersion: '2.3.8',
        isCheckingUpdate: false,
        hasNewVersion: false,
      },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.findComponent({ name: 'ClaudeIntegrationSettings' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'CodexIntegrationSettings' }).exists()).toBe(false);
  });
});
