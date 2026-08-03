import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MusicProgressControl from './MusicProgressControl.vue';

const baseProps = {
  positionMs: 10_000,
  durationMs: 269_000,
  isPending: false,
  failureId: 0,
};

describe('MusicProgressControl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('显示当前时间、总时长和可访问滑条', () => {
    const wrapper = mount(MusicProgressControl, { props: baseProps });
    const slider = wrapper.get<HTMLInputElement>('input[type="range"]');

    expect(wrapper.get('.progress-time-current').text()).toBe('0:10');
    expect(wrapper.get('.progress-time-total').text()).toBe('4:29');
    expect(slider.attributes()).toMatchObject({
      min: '0',
      max: '269000',
      step: '100',
      'aria-label': '播放进度',
      'aria-valuetext': '0:10 / 4:29',
    });
    expect(slider.element.value).toBe('10000');
  });

  it('拖动中只预览时间并在提交时发送一次跳转', async () => {
    const wrapper = mount(MusicProgressControl, { props: baseProps });
    const slider = wrapper.get<HTMLInputElement>('input[type="range"]');

    slider.element.value = '42000';
    await slider.trigger('input');

    expect(wrapper.get('.progress-time-current').text()).toBe('0:42');
    expect(wrapper.emitted('seek-to')).toBeUndefined();

    await slider.trigger('change');
    expect(wrapper.emitted('seek-to')).toEqual([[42_000]]);
  });

  it('请求期间锁定预览并在完成后恢复真实位置', async () => {
    const wrapper = mount(MusicProgressControl, { props: baseProps });
    const slider = wrapper.get<HTMLInputElement>('input[type="range"]');

    slider.element.value = '42000';
    await slider.trigger('input');
    await slider.trigger('change');
    await wrapper.setProps({ isPending: true, positionMs: 43_000 });

    expect(slider.element.disabled).toBe(true);
    expect(wrapper.get('.progress-time-current').text()).toBe('0:42');

    await wrapper.setProps({ isPending: false, positionMs: 43_000 });
    expect(wrapper.get('.progress-time-current').text()).toBe('0:43');
    expect(slider.element.value).toBe('43000');
  });

  it('跳转失败时短暂显示提示后恢复时间', async () => {
    const wrapper = mount(MusicProgressControl, { props: baseProps });

    await wrapper.setProps({ failureId: 1 });
    expect(wrapper.get('[role="status"]').text()).toBe('无法跳转');

    await vi.advanceTimersByTimeAsync(1_999);
    expect(wrapper.find('[role="status"]').exists()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.get('.progress-time-current').text()).toBe('0:10');
  });

  it('组件卸载时清理失败提示计时器', async () => {
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const wrapper = mount(MusicProgressControl, { props: baseProps });

    await wrapper.setProps({ failureId: 1 });
    wrapper.unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
