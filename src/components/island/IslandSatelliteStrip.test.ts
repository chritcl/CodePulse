import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import IslandSatelliteStrip from './IslandSatelliteStrip.vue';
import type { IslandSatelliteItem } from '@/modules/island/display';

const items: IslandSatelliteItem[] = [
  { kind: 'agent', status: 'running', unreadCount: 0, label: 'Codex' },
  { kind: 'notification', status: 'unread', unreadCount: 3, label: '通知' },
  { kind: 'hardware', status: 'error', unreadCount: 0, label: '硬件' },
  {
    kind: 'music',
    status: 'running',
    unreadCount: 0,
    label: '音乐',
    iconUrl: 'cover.png',
  },
];

describe('IslandSatelliteStrip', () => {
  it('渲染卫星岛状态、角标和溢出入口', () => {
    const wrapper = mount(IslandSatelliteStrip, {
      props: {
        items,
        overflowCount: 2,
      },
    });

    expect(wrapper.findAll('.satellite-button')).toHaveLength(4);
    expect(wrapper.findAll('.satellite-button')[3].attributes('data-satellite-kind')).toBe('music');
    expect(wrapper.find('[data-satellite-kind="agent"] svg').exists()).toBe(true);
    expect(wrapper.find('[data-satellite-kind="agent"]').text()).not.toContain('AI');
    expect(wrapper.findAll('[data-flip-visual]')).toHaveLength(4);
    expect(wrapper.find('[data-satellite-kind="music"] [data-flip-visual] img').exists()).toBe(
      true
    );
    expect(wrapper.find('.satellite-badge').text()).toBe('3');
    expect(wrapper.find('.satellite-button.is-error').exists()).toBe(true);
    expect(wrapper.find('.satellite-more').text()).toBe('+2');
  });

  it('点击卫星岛时发送被选中的模块类型', async () => {
    const wrapper = mount(IslandSatelliteStrip, {
      props: {
        items,
        overflowCount: 0,
      },
    });

    await wrapper.findAll('.satellite-button')[3].trigger('click');

    const payload = wrapper.emitted('select')?.[0];
    expect(payload?.[0]).toBe('music');
    expect(payload?.[1]).toBeInstanceOf(MouseEvent);
  });

  it('根据岛屿主题切换卫星条明暗背景', () => {
    const darkWrapper = mount(IslandSatelliteStrip, {
      props: {
        items,
        overflowCount: 0,
      },
    });
    expect(darkWrapper.find('.satellite-strip').classes()).toContain('is-dark');

    const lightWrapper = mount(IslandSatelliteStrip, {
      props: {
        items,
        overflowCount: 0,
        theme: 'white',
      },
    });
    expect(lightWrapper.find('.satellite-strip').classes()).toContain('is-light');
  });
});
