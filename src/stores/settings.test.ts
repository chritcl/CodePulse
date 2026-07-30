import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './settings';

describe('useSettingsStore 的 Codex 显示偏好', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('默认关闭任务摘要，并独立持久化三项偏好', async () => {
    const settings = useSettingsStore();

    expect(settings.codexIdleResident).toBe(false);
    expect(settings.showCodexOperationSummary).toBe(true);
    expect(settings.showCodexTaskSummary).toBe(false);

    settings.codexIdleResident = true;
    settings.showCodexOperationSummary = false;
    settings.showCodexTaskSummary = true;
    await nextTick();

    expect(localStorage.getItem('nsd_codex_idle_resident')).toBe('true');
    expect(localStorage.getItem('nsd_codex_show_operation_summary')).toBe('false');
    expect(localStorage.getItem('nsd_codex_show_task_summary')).toBe('true');
  });

  it('弹簧动画默认开启并持久化关闭状态', async () => {
    const settings = useSettingsStore();

    expect(settings.enableSpringAnimation).toBe(true);

    settings.enableSpringAnimation = false;
    await nextTick();

    expect(localStorage.getItem('nsd_spring_animation')).toBe('false');
  });
});
