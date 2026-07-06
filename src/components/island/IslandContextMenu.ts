/**
 * 灵动岛右键菜单
 *
 * 管理右键菜单的创建和交互逻辑。
 */

import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';

export interface ContextMenuOptions {
  isGlowBorderEnabled: boolean;
  isPinnedToTaskbar: boolean;
  isPositionLocked: boolean;
  onOpenSettings?: () => void;
  onToggleGlowBorder: () => void;
  onResetPosition: () => void;
  onToggleLock: () => void;
  onClose: () => void;
}

export function useIslandContextMenu() {
  /** 创建并显示右键菜单 */
  const showContextMenu = async (event: MouseEvent, options: ContextMenuOptions) => {
    event.preventDefault();
    event.stopPropagation();

    // 打开设置
    const openSettingsItem = await MenuItem.new({
      text: '打开设置',
      id: 'open_settings',
      action: async () => {
        await emit('open-settings-panel');
        options.onOpenSettings?.();
      },
    });

    // 切换流光边框
    const toggleGlowBorderItem = await MenuItem.new({
      text: options.isGlowBorderEnabled ? '关闭流光边框' : '开启流光边框',
      id: 'toggle_glow_border',
      enabled: true,
      action: options.onToggleGlowBorder,
    });

    // 重置位置
    const resetPositionItem = await MenuItem.new({
      text: options.isPinnedToTaskbar ? '重置位置 (已锁定)' : '重置位置',
      id: 'reset_position',
      enabled: !options.isPinnedToTaskbar,
      action: options.onResetPosition,
    });

    // 锁定位置
    const toggleLockItem = await MenuItem.new({
      text: options.isPositionLocked ? '解锁 (当前已锁定)' : '锁定',
      id: 'toggle_lock',
      enabled: !options.isPinnedToTaskbar,
      action: options.onToggleLock,
    });

    // 关闭灵动岛
    const closeItem = await MenuItem.new({
      text: '关闭',
      id: 'close',
      action: options.onClose,
    });

    // 创建菜单
    const position = new LogicalPosition(event.clientX, event.clientY);
    const menu = await Menu.new();
    await menu.append(openSettingsItem);
    await menu.append(toggleGlowBorderItem);
    await menu.append(resetPositionItem);
    await menu.append(toggleLockItem);
    await menu.append(closeItem);

    // 弹出菜单
    try {
      await menu.popup(position);
    } catch (error) {
      console.error('菜单弹出失败:', error);
    }
  };

  return {
    showContextMenu,
  };
}
