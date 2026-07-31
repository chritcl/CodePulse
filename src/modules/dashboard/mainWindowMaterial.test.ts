import { describe, expect, it, vi } from 'vitest';
import { Effect } from '@tauri-apps/api/window';
import { applyMainWindowMaterial } from './mainWindowMaterial';

describe('主窗口材质', () => {
  it('优先应用 Mica', async () => {
    const setEffects = vi.fn(async () => {});

    await expect(applyMainWindowMaterial(setEffects)).resolves.toBe('mica');
    expect(setEffects).toHaveBeenCalledOnce();
    expect(setEffects).toHaveBeenCalledWith({ effects: [Effect.Mica] });
  });

  it('Mica 失败后回退到 Acrylic', async () => {
    const setEffects = vi
      .fn()
      .mockRejectedValueOnce(new Error('Mica 不可用'))
      .mockResolvedValueOnce(undefined);

    await expect(applyMainWindowMaterial(setEffects)).resolves.toBe('acrylic');
    expect(setEffects).toHaveBeenNthCalledWith(2, { effects: [Effect.Acrylic] });
  });

  it('两种系统材质均失败时使用 CSS 回退', async () => {
    const setEffects = vi.fn(async () => {
      throw new Error('不可用');
    });

    await expect(applyMainWindowMaterial(setEffects)).resolves.toBe('fallback');
    expect(setEffects).toHaveBeenCalledTimes(2);
  });
});
