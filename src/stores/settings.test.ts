import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './settings';

describe('useSettingsStore 的 Codex 显示偏好', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('以不常驻、显示脱敏操作摘要为默认值，并独立持久化修改', async () => {
    const settings = useSettingsStore();

    expect(settings.codexIdleResident).toBe(false);
    expect(settings.showCodexOperationSummary).toBe(true);

    settings.codexIdleResident = true;
    settings.showCodexOperationSummary = false;
    await nextTick();

    expect(localStorage.getItem('nsd_codex_idle_resident')).toBe('true');
    expect(localStorage.getItem('nsd_codex_show_operation_summary')).toBe('false');
  });
});
