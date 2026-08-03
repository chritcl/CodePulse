/**
 * 灵动岛状态仓库
 *
 * 管理灵动岛的显示状态和控制逻辑。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { emit, listen } from '@tauri-apps/api/event';
import { settingsCommands, windowCommands } from '@/shared/ipc/commands';
import { readBoolean, writeBoolean } from '@/shared/utils/storage';

const ISLAND_ENABLED_STORAGE_KEY = 'codepulse_island_enabled';

export const useIslandStore = defineStore('island', () => {
  // ============================================================
  // 状态
  // ============================================================

  /** 灵动岛是否可见 */
  const isVisible = ref(readBoolean(ISLAND_ENABLED_STORAGE_KEY, true));

  let stopListening: (() => void) | null = null;

  // ============================================================
  // 方法
  // ============================================================

  /** 切换灵动岛显示状态 */
  const toggleVisibility = async () => {
    const nextState = !isVisible.value;
    await emit('control-island-visibility', { show: nextState });
    isVisible.value = nextState;
    // 持久化开关状态
    writeBoolean(ISLAND_ENABLED_STORAGE_KEY, nextState);
  };

  /** 设置灵动岛可见性 */
  const setVisibility = (visible: boolean) => {
    isVisible.value = visible;
    writeBoolean(ISLAND_ENABLED_STORAGE_KEY, visible);
  };

  /** 监听灵动岛状态同步事件 */
  const startListening = async () => {
    if (stopListening) return;
    stopListening = await listen<{ visible: boolean }>('island-status-sync', (event) => {
      isVisible.value = event.payload.visible;
    });
  };

  /** 停止监听灵动岛状态同步事件 */
  const stopListeningEvents = () => {
    stopListening?.();
    stopListening = null;
  };

  /** 检查灵动岛初始状态 */
  const checkInitialState = async () => {
    // 如果用户上次关闭了灵动岛，直接保持关闭状态
    const enabled = readBoolean(ISLAND_ENABLED_STORAGE_KEY, true);
    if (!enabled) {
      isVisible.value = false;
      return;
    }

    // 等待 Widget 窗口就绪
    for (let i = 0; i < 6; i++) {
      try {
        const visible = await windowCommands.isWidgetVisible();
        if (visible) {
          isVisible.value = true;
          return;
        }
      } catch {
        /* 忽略 */
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    // 持久化开关已开启但窗口未显示时，主动补发一次显示命令
    await emit('control-island-visibility', { show: true });
    try {
      await settingsCommands.setIslandVisible(true);
    } catch {
      /* 忽略 */
    }
    isVisible.value = true;
  };

  // ============================================================
  // 导出
  // ============================================================

  return {
    // 状态
    isVisible,

    // 方法
    toggleVisibility,
    setVisibility,
    startListening,
    stopListeningEvents,
    checkInitialState,
  };
});
