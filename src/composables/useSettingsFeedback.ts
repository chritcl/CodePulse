import { ref } from 'vue';
import type { SettingsFeedback } from '@/modules/dashboard/settingsActionCoordinator';

const SUCCESS_DURATION_MS = 1600;
const ERROR_DURATION_MS = 4000;

export function useSettingsFeedback() {
  const current = ref<SettingsFeedback | null>(null);
  let clearTimer: number | null = null;

  const clear = () => {
    if (clearTimer !== null) {
      window.clearTimeout(clearTimer);
      clearTimer = null;
    }
    current.value = null;
  };

  const show = (feedback: SettingsFeedback) => {
    if (clearTimer !== null) {
      window.clearTimeout(clearTimer);
    }
    current.value = feedback;
    clearTimer = window.setTimeout(
      clear,
      feedback.kind === 'success' ? SUCCESS_DURATION_MS : ERROR_DURATION_MS
    );
  };

  const dispose = () => {
    clear();
  };

  return {
    current,
    show,
    clear,
    dispose,
  };
}
