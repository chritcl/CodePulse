/**
 * 灵动岛窗口 Composable
 *
 * 管理灵动岛窗口的大小、位置和显示状态。
 */

import { ref, computed, type CSSProperties } from 'vue';
import {
  getCurrentWindow,
  currentMonitor,
  PhysicalPosition,
  PhysicalSize,
} from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { readBoolean, readEnum, readNumber, writeBoolean } from '@/shared/utils/storage';

const ISLAND_THEMES = ['black', 'white'] as const;

export function useIslandWindow() {
  // ============================================================
  // 状态
  // ============================================================

  /** 当前窗口宽度 */
  const currentWidth = ref(260);

  /** 当前窗口高度 */
  const currentHeight = ref(42);

  /** 灵动岛透明度 */
  const islandOpacity = ref(readNumber('nsd_island_opacity', 100));

  /** 灵动岛主题 */
  const islandTheme = ref(readEnum('nsd_island_theme', 'black', ISLAND_THEMES));

  /** 是否置于任务栏 */
  const isPinnedToTaskbar = ref(readBoolean('nsd_pin_taskbar'));

  /** 是否锁定位置 */
  const isPositionLocked = ref(readBoolean('nsd_position_locked'));

  // ============================================================
  // 计算属性
  // ============================================================

  /** 灵动岛样式 */
  const islandStyle = computed<CSSProperties>(() => {
    return {
      color: islandTheme.value === 'white' ? '#000000' : '#ffffff',
      width: '100vw',
      height: '100vh',
      borderRadius: '0',
      position: 'relative',
      backgroundColor: 'transparent',
    };
  });

  /** 核心内容样式 */
  const coreContentStyle = computed(() => {
    const linear = islandOpacity.value / 100;
    const alpha = Math.pow(linear, 1 / 2.2);
    const innerRadius = '98px';

    if (islandTheme.value === 'white') {
      return {
        backgroundColor: `rgba(255, 255, 255, ${alpha})`,
        borderRadius: innerRadius,
      };
    }
    return {
      backgroundColor: `rgba(0, 0, 0, ${alpha})`,
      borderRadius: innerRadius,
    };
  });

  /** 展开态表面样式 */
  const focusSurfaceStyle = computed<CSSProperties>(() => {
    const linear = islandOpacity.value / 100;
    const alpha = Math.pow(linear, 1 / 2.2);

    if (islandTheme.value === 'white') {
      return {
        backgroundColor: `rgba(255, 255, 255, ${alpha})`,
        color: '#000000',
      };
    }

    return {
      backgroundColor: `rgba(0, 0, 0, ${alpha})`,
      color: '#ffffff',
    };
  });

  /** 流光边框透明度 */
  const glowOpacity = computed(() => {
    const linear = islandOpacity.value / 100;
    return Math.pow(linear, 1 / 2.2);
  });

  // ============================================================
  // 方法
  // ============================================================

  /** 调整窗口位置到顶部居中 */
  const adjustWindowPosition = async () => {
    try {
      const appWindow = getCurrentWindow();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const monitor = await currentMonitor();

      if (monitor) {
        const scaleFactor = window.devicePixelRatio;

        const WINDOW_INIT_WIDTH = currentWidth.value;
        const WINDOW_INIT_HEIGHT = currentHeight.value;
        await appWindow.setSize(
          new PhysicalSize(
            Math.ceil(WINDOW_INIT_WIDTH * scaleFactor),
            Math.ceil(WINDOW_INIT_HEIGHT * scaleFactor)
          )
        );

        const monitorWidthPhysical = monitor.size.width;
        const monitorLeftPhysical = monitor.position.x;
        const monitorTopPhysical = monitor.position.y;

        const windowSize = await appWindow.innerSize();
        const windowWidthPhysical = windowSize.width;

        const x = monitorLeftPhysical + (monitorWidthPhysical - windowWidthPhysical) / 2;
        const y = monitorTopPhysical + 12 * scaleFactor;

        await appWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
      }
    } catch (error) {
      console.error('调整窗口位置失败:', error);
    } finally {
      try {
        await getCurrentWindow().show();
      } catch (e) {
        console.error(e);
      }
    }
  };

  /** 停靠到左下角 */
  const snapToBottomLeft = async () => {
    try {
      const appWindow = getCurrentWindow();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const monitor = await currentMonitor();

      if (monitor) {
        const scaleFactor = window.devicePixelRatio;

        const WINDOW_INIT_WIDTH = currentWidth.value;
        const WINDOW_INIT_HEIGHT = currentHeight.value;
        await appWindow.setSize(
          new PhysicalSize(
            Math.ceil(WINDOW_INIT_WIDTH * scaleFactor),
            Math.ceil(WINDOW_INIT_HEIGHT * scaleFactor)
          )
        );

        const monitorLeftPhysical = monitor.position.x;
        const monitorTopPhysical = monitor.position.y;
        const monitorHeightPhysical = monitor.size.height;

        const x = monitorLeftPhysical + 10 * scaleFactor;
        const y =
          monitorTopPhysical + monitorHeightPhysical - (WINDOW_INIT_HEIGHT + 3) * scaleFactor;

        await appWindow.hide();
        await appWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
        await appWindow.show();
      }
    } catch (error) {
      console.error('停靠左下角失败:', error);
    }
  };

  /** 动画调整灵动岛大小 */
  const animateIslandSize = async (targetWidth: number, targetHeight: number) => {
    try {
      await invoke('start_island_animation', {
        startWidth: currentWidth.value,
        startHeight: currentHeight.value,
        targetWidth: targetWidth,
        targetHeight: targetHeight,
        isPinned: isPinnedToTaskbar.value,
      });
    } catch (err) {
      console.error('呼叫 Rust 动画失败:', err);
    }
  };

  /** 设置透明度 */
  const setOpacity = (opacity: number) => {
    islandOpacity.value = opacity;
  };

  /** 设置主题 */
  const setTheme = (theme: string) => {
    islandTheme.value = theme === 'white' ? 'white' : 'black';
  };

  /** 设置是否置于任务栏 */
  const setPinnedToTaskbar = (pinned: boolean) => {
    isPinnedToTaskbar.value = pinned;
  };

  /** 设置是否锁定位置 */
  const setPositionLocked = (locked: boolean) => {
    isPositionLocked.value = locked;
    writeBoolean('nsd_position_locked', locked);
  };

  // ============================================================
  // 导出
  // ============================================================

  return {
    // 状态
    currentWidth,
    currentHeight,
    islandOpacity,
    islandTheme,
    isPinnedToTaskbar,
    isPositionLocked,

    // 计算属性
    islandStyle,
    coreContentStyle,
    focusSurfaceStyle,
    glowOpacity,

    // 方法
    adjustWindowPosition,
    snapToBottomLeft,
    animateIslandSize,
    setOpacity,
    setTheme,
    setPinnedToTaskbar,
    setPositionLocked,
  };
}
