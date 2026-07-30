import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { effectScope, ref } from 'vue';
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
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('详情收起时先保留窗口尺寸直到离场内容移除', async () => {
    vi.useFakeTimers();
    const islandWindow = useIslandWindow();
    islandWindow.currentWidth.value = 420;
    islandWindow.currentHeight.value = 182;

    const resize = islandWindow.animateIslandSize(260, 42);

    expect(invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(160);
    expect(invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(40);
    await resize;

    expect(invoke).toHaveBeenCalledWith('start_island_animation', {
      startWidth: 420,
      startHeight: 182,
      targetWidth: 260,
      targetHeight: 42,
      isPinned: false,
      durationMs: 280,
    });
  });

  it('关闭弹簧后使用短窗口过渡时长', async () => {
    const islandWindow = useIslandWindow({ springEnabled: ref(false) });
    islandWindow.currentWidth.value = 260;
    islandWindow.currentHeight.value = 42;

    await islandWindow.animateIslandSize(420, 182);

    expect(invoke).toHaveBeenCalledWith('start_island_animation', {
      startWidth: 260,
      startHeight: 42,
      targetWidth: 420,
      targetHeight: 182,
      isPinned: false,
      durationMs: 160,
    });
  });

  it('新的尺寸调整会取消尚未开始的窗口收缩', async () => {
    vi.useFakeTimers();
    const islandWindow = useIslandWindow();
    islandWindow.currentWidth.value = 420;
    islandWindow.currentHeight.value = 182;

    const staleResize = islandWindow.animateIslandSize(260, 42);
    const latestResize = islandWindow.animateIslandSize(420, 206);

    await staleResize;
    await latestResize;
    await vi.advanceTimersByTimeAsync(200);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('start_island_animation', {
      startWidth: 420,
      startHeight: 182,
      targetWidth: 420,
      targetHeight: 206,
      isPinned: false,
      durationMs: 280,
    });
  });

  it('作用域释放时取消尚未开始的窗口收缩', async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const islandWindow = scope.run(() => useIslandWindow())!;
    islandWindow.currentWidth.value = 420;
    islandWindow.currentHeight.value = 182;

    const resize = islandWindow.animateIslandSize(260, 42);
    scope.stop();
    await resize;
    await vi.advanceTimersByTimeAsync(200);

    expect(invoke).not.toHaveBeenCalled();
  });

  it('拖拽期间只保留最后一个尺寸目标并在结束后执行一次', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const islandWindow = useIslandWindow();
    islandWindow.currentWidth.value = 420;
    islandWindow.currentHeight.value = 206;

    islandWindow.suspendSizeAnimation();
    await islandWindow.animateIslandSize(380, 162);
    await islandWindow.animateIslandSize(460, 226);

    expect(invoke).not.toHaveBeenCalled();

    await islandWindow.resumeSizeAnimation();
    await islandWindow.resumeSizeAnimation();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('start_island_animation', {
      startWidth: 420,
      startHeight: 206,
      targetWidth: 460,
      targetHeight: 226,
      isPinned: false,
      durationMs: 280,
    });
  });

  it('拖拽结束时尺寸目标没有变化则不调用 Rust', async () => {
    const islandWindow = useIslandWindow();
    islandWindow.currentWidth.value = 420;
    islandWindow.currentHeight.value = 206;

    islandWindow.suspendSizeAnimation();
    await islandWindow.animateIslandSize(420, 206);
    await islandWindow.resumeSizeAnimation();

    expect(invoke).not.toHaveBeenCalled();
  });

  it('拖拽开始会取消尚未执行的延迟收缩', async () => {
    vi.useFakeTimers();
    const islandWindow = useIslandWindow();
    islandWindow.currentWidth.value = 420;
    islandWindow.currentHeight.value = 182;

    const resize = islandWindow.animateIslandSize(260, 42);
    islandWindow.suspendSizeAnimation();

    await resize;
    await vi.advanceTimersByTimeAsync(200);

    expect(invoke).not.toHaveBeenCalled();
  });
});
