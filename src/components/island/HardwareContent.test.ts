import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import HardwareContent from './HardwareContent.vue';

describe('HardwareContent', () => {
  it('以双栏进度展示真实 CPU 和内存占用', () => {
    const wrapper = mount(HardwareContent, {
      props: {
        cpuUsage: 92,
        memUsage: 67,
      },
    });

    expect(wrapper.findAll('.resource-group')).toHaveLength(2);
    expect(wrapper.text()).toContain('CPU');
    expect(wrapper.text()).toContain('92%');
    expect(wrapper.text()).toContain('RAM');
    expect(wrapper.text()).toContain('67%');
    expect(wrapper.text()).not.toContain('GPU');
    expect(
      wrapper.findAll<HTMLElement>('.resource-bar-fill').map((bar) => bar.element.style.width)
    ).toEqual(['92%', '67%']);
    expect(
      wrapper.findAll('[role="progressbar"]').map((bar) => bar.attributes('aria-valuenow'))
    ).toEqual(['92', '67']);
  });

  it('仅对达到严重阈值的指标使用高负载样式', () => {
    const wrapper = mount(HardwareContent, {
      props: {
        cpuUsage: 90,
        memUsage: 89,
      },
    });

    const values = wrapper.findAll('.resource-value');
    const fills = wrapper.findAll('.resource-bar-fill');
    expect(values[0]?.classes()).toContain('high-usage');
    expect(fills[0]?.classes()).toContain('high-usage');
    expect(values[1]?.classes()).not.toContain('high-usage');
    expect(fills[1]?.classes()).not.toContain('high-usage');
  });
});
