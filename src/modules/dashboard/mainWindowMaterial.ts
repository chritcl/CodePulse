export type MainWindowMaterial = 'fallback';
export type ClearWindowEffects = () => Promise<void>;

export const applyMainWindowMaterial = async (
  clearEffects: ClearWindowEffects
): Promise<MainWindowMaterial> => {
  try {
    await clearEffects();
  } catch {
    // 部分 Windows 版本不支持清理窗口材质，此时继续使用 CSS 背景
  }
  return 'fallback';
};
