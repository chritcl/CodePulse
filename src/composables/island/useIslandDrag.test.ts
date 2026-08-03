import { describe, expect, it, vi } from 'vitest';
import { useIslandDrag } from './useIslandDrag';

function createDeferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createMouseEvent(clientX: number, clientY: number) {
  return new MouseEvent('mousemove', { clientX, clientY });
}

describe('灵动岛拖拽', () => {
  it('位移未超过阈值时不启动拖拽', async () => {
    const startIslandDrag = vi.fn().mockResolvedValue(undefined);
    const drag = useIslandDrag({ startIslandDrag });

    drag.handleMouseDown(createMouseEvent(10, 10));
    await drag.handleMouseMove(createMouseEvent(15, 15), {
      targetWidth: 420,
      targetHeight: 206,
      isPinned: false,
      isPositionLocked: false,
    });

    expect(startIslandDrag).not.toHaveBeenCalled();
    expect(drag.isDragging.value).toBe(false);
  });

  it.each([
    { isPinned: true, isPositionLocked: false },
    { isPinned: false, isPositionLocked: true },
  ])('停靠或锁定位置时不启动拖拽', async ({ isPinned, isPositionLocked }) => {
    const startIslandDrag = vi.fn().mockResolvedValue(undefined);
    const drag = useIslandDrag({ startIslandDrag });

    drag.handleMouseDown(createMouseEvent(10, 10));
    await drag.handleMouseMove(createMouseEvent(30, 30), {
      targetWidth: 420,
      targetHeight: 206,
      isPinned,
      isPositionLocked,
    });

    expect(startIslandDrag).not.toHaveBeenCalled();
    expect(drag.isDragging.value).toBe(false);
  });

  it('原生拖拽命令结束前持续保持拖拽态', async () => {
    const deferred = createDeferred();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const startIslandDrag = vi.fn(() => deferred.promise);
    const drag = useIslandDrag({ startIslandDrag, onDragStart, onDragEnd });

    drag.handleMouseDown(createMouseEvent(10, 10));
    const dragging = drag.handleMouseMove(createMouseEvent(30, 30), {
      targetWidth: 420,
      targetHeight: 206,
      isPinned: false,
      isPositionLocked: false,
    });

    expect(drag.isDragging.value).toBe(true);
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onDragEnd).not.toHaveBeenCalled();
    expect(startIslandDrag).toHaveBeenCalledWith({
      targetWidth: 420,
      targetHeight: 206,
      isPinned: false,
    });

    deferred.resolve();
    await dragging;

    expect(drag.isDragging.value).toBe(false);
    expect(onDragEnd).toHaveBeenCalledOnce();
  });

  it('原生拖拽命令失败时也会退出拖拽态', async () => {
    const error = new Error('原生拖拽失败');
    const deferred = createDeferred();
    const onDragEnd = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drag = useIslandDrag({
      startIslandDrag: () => deferred.promise,
      onDragEnd,
    });

    drag.handleMouseDown(createMouseEvent(10, 10));
    const dragging = drag.handleMouseMove(createMouseEvent(30, 30), {
      targetWidth: 420,
      targetHeight: 206,
      isPinned: false,
      isPositionLocked: false,
    });

    deferred.reject(error);
    await dragging;

    expect(drag.isDragging.value).toBe(false);
    expect(onDragEnd).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith('拖拽失败:', error);

    consoleError.mockRestore();
  });
});
