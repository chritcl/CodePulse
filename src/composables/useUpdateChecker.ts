/**
 * 更新检查 Composable
 *
 * 当前尚未配置 CodePulse 发布源，保留统一接口以便后续接入新仓库。
 */

import { ref } from 'vue';

const IS_UPDATE_SOURCE_CONFIGURED = false;

export function useUpdateChecker() {
  /** 是否正在检查 */
  const isChecking = ref(false);

  /** 是否有新版本 */
  const hasNewVersion = ref(false);

  /** 是否已配置发布源 */
  const isConfigured = ref(IS_UPDATE_SOURCE_CONFIGURED);

  /** 静默检查更新，未配置发布源时保持空操作。 */
  const silentCheckUpdate = async () => {
    if (!isConfigured.value) return;
  };

  /** 检查更新并通过对话框说明当前状态。 */
  const checkUpdate = async (
    showDialog: (
      title: string,
      message: string,
      isConfirm?: boolean,
      onConfirm?: (() => void) | null
    ) => void
  ) => {
    if (!isConfigured.value || isChecking.value) {
      if (!isConfigured.value) showDialog('检查更新', 'CodePulse 尚未配置更新源');
      return;
    }

    isChecking.value = true;
    try {
      showDialog('检查更新', 'CodePulse 更新源暂不可用');
    } finally {
      isChecking.value = false;
    }
  };

  return {
    isChecking,
    hasNewVersion,
    isConfigured,
    silentCheckUpdate,
    checkUpdate,
  };
}
