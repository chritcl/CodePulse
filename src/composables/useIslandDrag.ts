/**
 * 灵动岛拖拽 Composable
 *
 * 管理灵动岛的拖拽和位置锁定逻辑。
 */

import { getCurrentWindow } from '@tauri-apps/api/window';

export function useIslandDrag() {
  // ============================================================
  // 状态
  // ============================================================

  /** 鼠标按下 X 坐标 */
  let mouseDownX = 0;

  /** 鼠标按下 Y 坐标 */
  let mouseDownY = 0;

  /** 鼠标是否按下 */
  let isMouseDown = false;

  // ============================================================
  // 方法
  // ============================================================

  /** 处理鼠标按下 */
  const handleMouseDown = (event: MouseEvent) => {
    // 记录坐标，给后面的"点击展开"提供判断依据
    mouseDownX = event.clientX;
    mouseDownY = event.clientY;
    isMouseDown = true;
  };

  /** 处理鼠标移动 */
  const handleMouseMove = async (
    event: MouseEvent,
    isPinnedToTaskbar: boolean,
    isPositionLocked: boolean
  ) => {
    if (!isMouseDown) return;

    // 锁定位置时禁止拖拽
    if (isPinnedToTaskbar || isPositionLocked) return;

    if (Math.abs(event.clientX - mouseDownX) > 5 || Math.abs(event.clientY - mouseDownY) > 5) {
      isMouseDown = false;
      try {
        await getCurrentWindow().startDragging();
      } catch (error) {
        console.error('拖拽失败:', error);
      }
    }
  };

  /** 处理鼠标抬起 */
  const handleMouseUp = () => {
    isMouseDown = false;
  };

  /** 检查是否为点击（非拖拽） */
  const isClick = (event: MouseEvent): boolean => {
    return Math.abs(event.clientX - mouseDownX) <= 5 && Math.abs(event.clientY - mouseDownY) <= 5;
  };

  // ============================================================
  // 导出
  // ============================================================

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    isClick,
  };
}
