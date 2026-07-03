/**
 * 对话框 Composable
 *
 * 管理对话框的显示和交互逻辑。
 */

import { ref } from 'vue';
import type { DialogConfig } from '@/types';

export function useDialog() {
  /** 对话框配置 */
  const dialog = ref<DialogConfig>({
    visible: false,
    title: 'NetSpeed Dynamic',
    message: '',
    isConfirm: false,
    callback: null,
  });

  /** 显示对话框 */
  const showDialog = (
    title: string,
    message: string,
    isConfirm = false,
    onConfirm: (() => void) | null = null
  ) => {
    dialog.value = { visible: true, title, message, isConfirm, callback: onConfirm };
  };

  /** 关闭对话框 */
  const closeDialog = () => {
    dialog.value.visible = false;
  };

  /** 处理确认 */
  const handleConfirm = () => {
    if (dialog.value.callback) dialog.value.callback();
    closeDialog();
  };

  return {
    dialog,
    showDialog,
    closeDialog,
    handleConfirm,
  };
}
