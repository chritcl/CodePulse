import { describe, expect, it, vi } from 'vitest';
import { useSettingsFeedback } from './useSettingsFeedback';

describe('useSettingsFeedback', () => {
  it('成功反馈在 1.6 秒后自动消失', () => {
    vi.useFakeTimers();
    const feedback = useSettingsFeedback();

    feedback.show({
      kind: 'success',
      message: '设置已应用',
    });
    expect(feedback.current.value?.message).toBe('设置已应用');

    vi.advanceTimersByTime(1599);
    expect(feedback.current.value).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(feedback.current.value).toBeNull();

    feedback.dispose();
    vi.useRealTimers();
  });

  it('错误反馈保留四秒，并在新反馈出现时替换旧定时器', () => {
    vi.useFakeTimers();
    const feedback = useSettingsFeedback();

    feedback.show({
      kind: 'error',
      message: '同步失败',
    });
    vi.advanceTimersByTime(2000);
    feedback.show({
      kind: 'success',
      message: '已恢复',
    });
    vi.advanceTimersByTime(1600);

    expect(feedback.current.value).toBeNull();

    feedback.dispose();
    vi.useRealTimers();
  });
});
