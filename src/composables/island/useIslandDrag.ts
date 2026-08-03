/**
 * 灵动岛拖拽组合式逻辑
 *
 * 管理灵动岛的拖拽生命周期和位置锁定逻辑。
 */

import { getCurrentScope, onScopeDispose, ref } from 'vue';
import { windowCommands } from '@/shared/ipc/commands';
import type { IslandDragStartPayload } from '@/shared/ipc/contracts';

export interface IslandDragMoveOptions extends IslandDragStartPayload {
  isPositionLocked: boolean;
}

export interface UseIslandDragOptions {
  startIslandDrag?: (payload: IslandDragStartPayload) => Promise<void>;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function useIslandDrag(options: UseIslandDragOptions = {}) {
  const startIslandDrag = options.startIslandDrag ?? windowCommands.startIslandDrag;

  /** 原生窗口拖拽是否仍在进行 */
  const isDragging = ref(false);

  /** 鼠标按下 X 坐标 */
  let mouseDownX = 0;

  /** 鼠标按下 Y 坐标 */
  let mouseDownY = 0;

  /** 鼠标是否按下 */
  let isMouseDown = false;

  /** 当前组合式逻辑是否已经销毁 */
  let disposed = false;

  /** 处理鼠标按下 */
  const handleMouseDown = (event: MouseEvent) => {
    mouseDownX = event.clientX;
    mouseDownY = event.clientY;
    isMouseDown = true;
  };

  /** 处理鼠标移动 */
  const handleMouseMove = async (event: MouseEvent, moveOptions: IslandDragMoveOptions) => {
    if (!isMouseDown || isDragging.value) return;

    if (moveOptions.isPinned || moveOptions.isPositionLocked) return;

    const movedBeyondThreshold =
      Math.abs(event.clientX - mouseDownX) > 5 || Math.abs(event.clientY - mouseDownY) > 5;
    if (!movedBeyondThreshold) return;

    isMouseDown = false;
    isDragging.value = true;

    try {
      options.onDragStart?.();
      await startIslandDrag({
        targetWidth: moveOptions.targetWidth,
        targetHeight: moveOptions.targetHeight,
        isPinned: moveOptions.isPinned,
      });
    } catch (error) {
      console.error('拖拽失败:', error);
    } finally {
      isDragging.value = false;
      if (!disposed) {
        options.onDragEnd?.();
      }
    }
  };

  /** 处理鼠标抬起 */
  const handleMouseUp = () => {
    isMouseDown = false;
  };

  /** 检查是否为点击（非拖拽） */
  const isClick = (event: MouseEvent): boolean => {
    if (isDragging.value) return false;
    return Math.abs(event.clientX - mouseDownX) <= 5 && Math.abs(event.clientY - mouseDownY) <= 5;
  };

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      isMouseDown = false;
      isDragging.value = false;
    });
  }

  return {
    isDragging,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    isClick,
  };
}
