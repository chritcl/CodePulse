import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIslandWindow } from './useIslandWindow';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  currentMonitor: vi.fn().mockResolvedValue(null),
  getCurrentWindow: vi.fn(() => ({
    hide: vi.fn(),
    innerSize: vi.fn().mockResolvedValue({ width: 260, height: 42 }),
    setPosition: vi.fn(),
    setSize: vi.fn(),
    show: vi.fn(),
  })),
  PhysicalPosition: class {
    constructor(
      public x: number,
      public y: number
    ) {}
  },
  PhysicalSize: class {
    constructor(
      public width: number,
      public height: number
    ) {}
  },
}));

describe('useIslandWindow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('窗口级样式不输出圆角遮罩', () => {
    const islandWindow = useIslandWindow();

    expect(islandWindow.islandStyle.value).toMatchObject({
      backgroundColor: 'transparent',
      borderRadius: '0',
      width: '100vw',
      height: '100vh',
    });
  });

  it('展开态表面样式跟随灵动岛主题', () => {
    const islandWindow = useIslandWindow();

    islandWindow.setTheme('white');

    expect(islandWindow.focusSurfaceStyle.value).toMatchObject({
      backgroundColor: 'rgba(255, 255, 255, 1)',
      color: '#000000',
    });
  });
});
