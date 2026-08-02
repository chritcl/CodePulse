import { describe, expect, it, vi } from 'vitest';
import { applyMainWindowMaterial } from './mainWindowMaterial';

describe('主窗口材质', () => {
  it('透明圆角主窗口清除原生材质并使用 CSS 背景', async () => {
    const clearEffects = vi.fn(async () => {});

    await expect(applyMainWindowMaterial(clearEffects)).resolves.toBe('fallback');
    expect(clearEffects).toHaveBeenCalledOnce();
    expect(clearEffects).toHaveBeenCalledWith();
  });

  it('系统不支持清理原生材质时仍使用 CSS 背景', async () => {
    const clearEffects = vi.fn(async () => {
      throw new Error('不支持清理窗口材质');
    });

    await expect(applyMainWindowMaterial(clearEffects)).resolves.toBe('fallback');
    expect(clearEffects).toHaveBeenCalledOnce();
  });
});
