import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SettingsHome from './SettingsHome.vue';

const mountHome = () =>
  mount(SettingsHome, {
    props: {
      islandVisible: true,
      musicEnabled: false,
      notificationsEnabled: true,
      navigationDisabled: false,
    },
  });

describe('SettingsHome', () => {
  it('展示五个固定设置分类', () => {
    const wrapper = mountHome();

    expect(wrapper.findAll('[data-settings-category]')).toHaveLength(5);
    expect(wrapper.text()).toContain('外观与动效');
    expect(wrapper.text()).toContain('岛屿内容');
    expect(wrapper.text()).toContain('系统与应用');
    expect(wrapper.text()).toContain('Codex 集成');
    expect(wrapper.text()).toContain('Claude Code 集成');
  });

  it('点击分类卡只发送分类导航事件', async () => {
    const wrapper = mountHome();

    await wrapper.get('[data-settings-category="appearance"]').trigger('click');

    expect(wrapper.emitted('open-category')).toEqual([['appearance']]);
    expect(wrapper.emitted('toggle-music')).toBeUndefined();
  });

  it('快速控制带分别提交灵动岛、音乐和通知开关', async () => {
    const wrapper = mountHome();

    await wrapper.get('input[aria-label="灵动岛"]').setValue(false);
    await wrapper.get('input[aria-label="音乐控制"]').setValue(true);
    await wrapper.get('input[aria-label="消息通知"]').setValue(false);

    expect(wrapper.emitted('toggle-island')).toEqual([[false]]);
    expect(wrapper.emitted('toggle-music')).toEqual([[true]]);
    expect(wrapper.emitted('toggle-notifications')).toEqual([[false]]);
  });
});
