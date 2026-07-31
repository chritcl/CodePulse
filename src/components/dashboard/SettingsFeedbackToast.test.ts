import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SettingsFeedbackToast from './SettingsFeedbackToast.vue';

describe('SettingsFeedbackToast', () => {
  it('以可访问状态消息显示成功反馈', () => {
    const wrapper = mount(SettingsFeedbackToast, {
      props: {
        feedback: {
          kind: 'success',
          message: '音乐控制已开启',
        },
      },
    });

    expect(wrapper.get('[role="status"]').text()).toContain('音乐控制已开启');
    expect(wrapper.get('[role="status"]').classes()).toContain('is-success');
  });

  it('没有反馈时不渲染消息', () => {
    const wrapper = mount(SettingsFeedbackToast, {
      props: {
        feedback: null,
      },
    });

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});
