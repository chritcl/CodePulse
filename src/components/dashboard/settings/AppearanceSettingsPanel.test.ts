import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import type { useSettingsActions } from '@/composables/dashboard/useSettingsActions';
import AppearanceSettingsPanel from './AppearanceSettingsPanel.vue';

type SettingsActions = ReturnType<typeof useSettingsActions>;

const createActions = () =>
  ({
    setThemeMode: vi.fn(async () => true),
    setIslandTheme: vi.fn(async () => true),
    setSpringAnimationEnabled: vi.fn(async () => true),
    previewOpacity: vi.fn(),
    commitOpacity: vi.fn(),
  }) as unknown as SettingsActions;

describe('AppearanceSettingsPanel', () => {
  it('主题选择和不透明度输入通过统一设置操作提交', async () => {
    const actions = createActions();
    const wrapper = mount(AppearanceSettingsPanel, {
      props: { actions },
      global: { plugins: [createPinia()] },
    });

    await wrapper.get('[data-theme-mode="dark"]').trigger('click');
    await wrapper.get('input[type="range"]').setValue(72);
    await wrapper.get('input[type="range"]').trigger('change');

    expect(actions.setThemeMode).toHaveBeenCalledWith('dark');
    expect(actions.previewOpacity).toHaveBeenCalledWith(72);
    expect(actions.commitOpacity).toHaveBeenCalledWith(72);
  });
});
