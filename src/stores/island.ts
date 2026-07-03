/**
 * 灵动岛 Store
 *
 * 管理灵动岛的显示状态和控制逻辑。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const useIslandStore = defineStore('island', () => {
  // ============================================================
  // 状态
  // ============================================================

  /** 灵动岛是否可见 */
  const isVisible = ref(false);

  /** 是否显示灵动岛设置面板 */
  const showSettings = ref(false);

  // ============================================================
  // 方法
  // ============================================================

  /** 切换灵动岛显示状态 */
  const toggleVisibility = async () => {
    const nextState = !isVisible.value;
    await emit('control-island-visibility', { show: nextState });
    isVisible.value = nextState;
  };

  /** 设置灵动岛可见性 */
  const setVisibility = (visible: boolean) => {
    isVisible.value = visible;
  };

  /** 切换设置面板显示状态 */
  const toggleSettings = () => {
    showSettings.value = !showSettings.value;
  };

  /** 打开设置面板 */
  const openSettings = () => {
    showSettings.value = true;
  };

  /** 监听灵动岛状态同步事件 */
  const startListening = async () => {
    await listen<{ visible: boolean }>('island-status-sync', (event) => {
      isVisible.value = event.payload.visible;
    });

    await listen('open-settings-panel', async () => {
      showSettings.value = true;

      // 唤醒并聚焦主窗口
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.unminimize();
      await appWindow.setFocus();
    });
  };

  /** 检查灵动岛初始状态 */
  const checkInitialState = async () => {
    for (let i = 0; i < 6; i++) {
      try {
        const visible = await invoke<boolean>('is_widget_visible');
        if (visible) {
          isVisible.value = true;
          return;
        }
      } catch {
        /* 忽略 */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    isVisible.value = false;
  };

  // ============================================================
  // 导出
  // ============================================================

  return {
    // 状态
    isVisible,
    showSettings,

    // 方法
    toggleVisibility,
    setVisibility,
    toggleSettings,
    openSettings,
    startListening,
    checkInitialState,
  };
});
