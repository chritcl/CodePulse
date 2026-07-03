/**
 * 主题 Composable
 *
 * 管理主题切换逻辑，包括系统主题监听。
 */

import { onMounted, onUnmounted } from 'vue';
import { useSettingsStore } from '@/stores';

export function useTheme() {
  const settingsStore = useSettingsStore();

  let systemThemeMedia: MediaQueryList | null = null;

  /** 应用主题 */
  const applyTheme = () => {
    const root = document.documentElement;

    if (settingsStore.themeMode === 'dark') {
      root.classList.add('dark-theme');
    } else if (settingsStore.themeMode === 'light') {
      root.classList.remove('dark-theme');
    } else if (settingsStore.themeMode === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      if (media.matches) {
        root.classList.add('dark-theme');
      } else {
        root.classList.remove('dark-theme');
      }
    }
  };

  /** 处理系统主题变更 */
  const handleSystemThemeUpdate = () => {
    if (settingsStore.themeMode === 'system') {
      applyTheme();
    }
  };

  /** 处理主题模式变更 */
  const handleThemeChange = (mode: string) => {
    settingsStore.setThemeMode(mode as 'light' | 'dark' | 'system');
    applyTheme();
  };

  /** 初始化主题 */
  const initialize = () => {
    applyTheme();
    systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    systemThemeMedia.addEventListener('change', handleSystemThemeUpdate);
  };

  /** 清理 */
  const cleanup = () => {
    systemThemeMedia?.removeEventListener('change', handleSystemThemeUpdate);
  };

  // 生命周期
  onMounted(() => {
    initialize();
  });

  onUnmounted(() => {
    cleanup();
  });

  return {
    themeMode: settingsStore.themeMode,
    applyTheme,
    handleThemeChange,
    initialize,
    cleanup,
  };
}
