import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainWindowTitleBar from './MainWindowTitleBar.vue';

const windowMocks = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}),
  hide: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => windowMocks),
}));

describe('MainWindowTitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('提供可拖拽标题栏与当前页面标题', () => {
    const wrapper = mount(MainWindowTitleBar, {
      props: { pageTitle: '设置' },
    });

    expect(wrapper.find('[data-tauri-drag-region]').exists()).toBe(true);
    expect(wrapper.text()).toContain('设置');
  });

  it('窗口按钮执行最小化和隐藏到托盘', async () => {
    const wrapper = mount(MainWindowTitleBar, {
      props: { pageTitle: 'CodePulse' },
    });

    await wrapper.get('[aria-label="最小化窗口"]').trigger('click');
    await wrapper.get('[aria-label="隐藏到托盘"]').trigger('click');

    expect(windowMocks.minimize).toHaveBeenCalledOnce();
    expect(windowMocks.hide).toHaveBeenCalledOnce();
  });
});
