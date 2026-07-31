import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import type { useSettingsActions } from '@/composables/useSettingsActions';
import { useSettingsStore } from '@/stores';
import IslandSettingsPanel from './IslandSettingsPanel.vue';
import panelSource from './IslandSettingsPanel.vue?raw';

type SettingsActions = ReturnType<typeof useSettingsActions>;

const createActions = () =>
  ({
    setTargetPlayer: vi.fn(async () => true),
    setMusicEnabled: vi.fn(async () => true),
    setNotificationsEnabled: vi.fn(async () => true),
    setHardwareEnabled: vi.fn(async () => true),
    setDisplayStrategy: vi.fn(async () => true),
  }) as unknown as SettingsActions;

describe('IslandSettingsPanel', () => {
  it('通过设置操作协调器切换音乐平台', async () => {
    const pinia = createPinia();
    const actions = createActions();
    const wrapper = mount(IslandSettingsPanel, {
      props: { actions },
      global: { plugins: [pinia] },
    });

    await wrapper.get('[data-player="qqmusic"]').trigger('click');

    expect(actions.setTargetPlayer).toHaveBeenCalledWith('qqmusic');
  });

  it('将消息模式和轮换模式呈现为三段展示策略', async () => {
    const pinia = createPinia();
    const store = useSettingsStore(pinia);
    store.enableRotation = true;
    const actions = createActions();
    const wrapper = mount(IslandSettingsPanel, {
      props: { actions },
      global: { plugins: [pinia] },
    });

    expect(wrapper.get('[data-display-strategy="rotation"]').classes()).toContain('is-selected');
    await wrapper.get('[data-display-strategy="message"]').trigger('click');

    expect(actions.setDisplayStrategy).toHaveBeenCalledWith('message');
  });

  it('组件主体保持职责边界并使用外部详情样式', () => {
    expect(panelSource.split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(panelSource).toContain('<style scoped src="./IslandSettingsPanel.css"></style>');
  });
});
