import { describe, expect, it, vi } from 'vitest';
import { useUpdateChecker } from './useUpdateChecker';

describe('useUpdateChecker', () => {
  it('未配置更新源时不会发起网络请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const checker = useUpdateChecker();

    await checker.silentCheckUpdate();

    expect(checker.isConfigured.value).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('手动检查时明确提示更新源未配置', async () => {
    const showDialog = vi.fn();
    const checker = useUpdateChecker();

    await checker.checkUpdate(showDialog);

    expect(showDialog).toHaveBeenCalledWith('检查更新', 'CodePulse 尚未配置更新源');
    expect(checker.isChecking.value).toBe(false);
  });
});
