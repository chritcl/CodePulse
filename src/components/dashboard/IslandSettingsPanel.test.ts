import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '@/stores';
import IslandSettingsPanel from './IslandSettingsPanel.vue';
import panelSource from './IslandSettingsPanel.vue?raw';

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const styleModules = import.meta.glob('./IslandSettingsPanel.css');

describe('IslandSettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(emit).mockResolvedValue(undefined);
  });

  it('连续选择播放器时立即按点击顺序更新状态并广播，不直接写后端目标', async () => {
    const pinia = createPinia();
    const store = useSettingsStore(pinia);
    const wrapper = mount(IslandSettingsPanel, { global: { plugins: [pinia] } });
    const buttons = wrapper.findAll('.player-grid .capsule-btn');
    const qqMusic = buttons.find((button) => button.text().includes('QQ音乐'));
    const kugou = buttons.find((button) => button.text().includes('酷狗'));
    if (!qqMusic || !kugou) throw new Error('未找到播放器按钮');

    void qqMusic.trigger('click');
    void kugou.trigger('click');
    await nextTick();
    await Promise.resolve();

    expect(store.targetPlayer).toBe('kugou');
    expect(emit).toHaveBeenNthCalledWith(1, 'control-target-player', { player: 'qqmusic' });
    expect(emit).toHaveBeenNthCalledWith(2, 'control-target-player', { player: 'kugou' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('组件主体不超过三百行并通过外部作用域样式保留关键视觉规则', () => {
    expect(panelSource.split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(panelSource).toContain('<style scoped src="./IslandSettingsPanel.css"></style>');
    expect(styleModules).toHaveProperty('./IslandSettingsPanel.css');
  });
});
