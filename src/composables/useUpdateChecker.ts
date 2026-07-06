/**
 * 更新检查 Composable
 *
 * 管理应用更新检查逻辑。
 */

import { ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';

export function useUpdateChecker() {
  /** 是否正在检查 */
  const isChecking = ref(false);

  /** 是否有新版本 */
  const hasNewVersion = ref(false);

  /** 解析版本号 */
  const parseVersion = (v: string): number[] => {
    const match = v.match(/\d+\.\d+\.\d+/);
    if (match) {
      return match[0].split('.').map(Number);
    }
    return [0, 0, 0];
  };

  /** 静默检查更新 */
  const silentCheckUpdate = async () => {
    try {
      const localVersionStr = await getVersion();
      const response = await fetch(
        'https://api.github.com/repos/GEORGEWWWU/NetSpeed-Dynamic/releases/latest',
        {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Tauri-App-NetSpeed-Dynamic',
          },
        }
      );

      if (!response.ok) return;

      const data = await response.json();
      const remoteVersionStr = data.tag_name;
      const local = parseVersion(localVersionStr);
      const remote = parseVersion(remoteVersionStr);

      for (let i = 0; i < 3; i++) {
        const rNum = remote[i] || 0;
        const lNum = local[i] || 0;
        if (rNum > lNum) {
          hasNewVersion.value = true;
          break;
        } else if (rNum < lNum) {
          break;
        }
      }
    } catch {
      // 静默模式失败就当无事发生
    }
  };

  /** 检查更新 (带对话框) */
  const checkUpdate = async (
    showDialog: (
      title: string,
      message: string,
      isConfirm?: boolean,
      onConfirm?: (() => void) | null
    ) => void
  ) => {
    if (isChecking.value) return;
    isChecking.value = true;

    try {
      const localVersionStr = await getVersion();

      // 10 秒超时控制器
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        'https://api.github.com/repos/GEORGEWWWU/NetSpeed-Dynamic/releases/latest',
        {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Tauri-App-NetSpeed-Dynamic',
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (response.status === 404) {
        showDialog('检查更新', '未找到可用版本');
        return;
      }

      if (!response.ok) {
        showDialog('检查更新', '检查更新失败，请稍后再试');
        return;
      }

      const data = await response.json();
      const remoteVersionStr = data.tag_name;
      const local = parseVersion(localVersionStr);
      const remote = parseVersion(remoteVersionStr);

      let findNew = false;
      for (let i = 0; i < 3; i++) {
        const rNum = remote[i] || 0;
        const lNum = local[i] || 0;
        if (rNum > lNum) {
          findNew = true;
          break;
        } else if (rNum < lNum) {
          break;
        }
      }

      if (findNew) {
        hasNewVersion.value = true;
        showDialog(
          '发现新版本',
          `发现新版本 ${remoteVersionStr}！当前版本为 v${localVersionStr}。是否前往 GitHub 下载更新？`,
          true,
          () => {
            openUrl(data.html_url);
            hasNewVersion.value = false;
          }
        );
      } else {
        hasNewVersion.value = false;
        showDialog('提示', '当前已是最新版本！');
      }
    } catch (error: unknown) {
      console.error('检查更新时出错:', error);
      if (error instanceof Error && error.name === 'AbortError') {
        showDialog('网络超时', '连接 GitHub 超时，请检查网络或稍后再试');
      } else {
        showDialog('网络错误', '请求失败，请检查您的网络连接');
      }
    } finally {
      isChecking.value = false;
    }
  };

  return {
    isChecking,
    hasNewVersion,
    silentCheckUpdate,
    checkUpdate,
  };
}
