import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import IslandSatelliteStrip from './IslandSatelliteStrip.vue';
import type { IslandSatelliteItem } from '@/modules/island/display';

const items: IslandSatelliteItem[] = [
  { kind: 'notification', status: 'unread', unreadCount: 3, label: '通知' },
  { kind: 'hardware', status: 'error', unreadCount: 0, label: '硬件' },
  { kind: 'music', status: 'running', unreadCount: 0, label: '音乐' },
];

describe('IslandSatelliteStrip', () => {
  it('渲染卫星岛状态、角标和溢出入口', () => {
    const wrapper = mount(IslandSatelliteStrip, {
      props: {
        items,
        overflowCount: 2,
      },
    });

    expect(wrapper.findAll('.satellite-button')).toHaveLength(3);
    expect(wrapper.findAll('.satellite-button')[2].attributes('data-satellite-kind')).toBe('music');
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

    await wrapper.findAll('.satellite-button')[2].trigger('click');

    const payload = wrapper.emitted('select')?.[0];
    expect(payload?.[0]).toBe('music');
    expect(payload?.[1]).toBeInstanceOf(MouseEvent);
  });
});
