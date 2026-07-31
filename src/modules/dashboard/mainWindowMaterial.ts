import { Effect, type Effects } from '@tauri-apps/api/window';

export type MainWindowMaterial = 'mica' | 'acrylic' | 'fallback';
export type SetWindowEffects = (effects: Effects) => Promise<void>;

export const applyMainWindowMaterial = async (
  setEffects: SetWindowEffects
): Promise<MainWindowMaterial> => {
  try {
    await setEffects({ effects: [Effect.Mica] });
    return 'mica';
  } catch {
    try {
      await setEffects({ effects: [Effect.Acrylic] });
      return 'acrylic';
    } catch {
      return 'fallback';
    }
  }
};
