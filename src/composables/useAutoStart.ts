/**
 * 开机自启动 Composable
 *
 * 管理开机自启动状态和切换逻辑。
 */

import { onMounted } from 'vue';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useSettingsStore } from '@/stores';

export function useAutoStart(showDialog: (title: string, message: string) => void) {
  const settingsStore = useSettingsStore();

  /** 切换自启动 */
  const toggleAutoStart = async () => {
    try {
      if (settingsStore.autoStart) {
        await enable();
      } else {
        await disable();
      }
    } catch {
      settingsStore.setAutoStart(!settingsStore.autoStart);
      showDialog('设置失败', '无法修改开机自启动状态，请检查系统权限。');
    }
  };

  /** 初始化自启动状态 */
  const initialize = async () => {
    try {
      settingsStore.setAutoStart(await isEnabled());
    } catch (e) {
      console.error('获取自启动状态失败:', e);
    }
  };

  onMounted(() => {
    initialize();
  });

  return {
    autoStart: settingsStore.autoStart,
    toggleAutoStart,
    initialize,
  };
}
