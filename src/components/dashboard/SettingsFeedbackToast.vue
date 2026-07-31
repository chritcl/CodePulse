<template>
  <Transition name="feedback-toast">
    <div
      v-if="feedback"
      class="settings-feedback-toast"
      :class="`is-${feedback.kind}`"
      role="status"
      aria-live="polite"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path v-if="feedback.kind === 'success'" d="m5 12 4 4L19 6" />
        <path v-else d="M12 8v5m0 3.5v.1M12 3 2.7 19h18.6z" />
      </svg>
      <span>{{ feedback.message }}</span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import type { SettingsFeedback } from '@/modules/dashboard/settingsActionCoordinator';

defineProps<{
  feedback: SettingsFeedback | null;
}>();
</script>

<style scoped>
.settings-feedback-toast {
  position: absolute;
  z-index: 30;
  right: 22px;
  bottom: 20px;
  /* 纯提示不响应交互，避免遮挡时吞掉下方控件点击 */
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: 360px;
  padding: 11px 14px;
  border: 1px solid var(--glass-border-strong);
  border-radius: 16px;
  background: var(--surface-glass-high);
  box-shadow: 0 12px 34px rgba(14, 17, 23, 0.2);
  color: var(--heading-color);
  font-size: 12px;
  font-weight: 650;
  backdrop-filter: blur(22px) saturate(1.35);
}

.settings-feedback-toast svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.settings-feedback-toast.is-success svg {
  color: #20a56a;
}

.settings-feedback-toast.is-error svg {
  color: #e05050;
}

.feedback-toast-enter-active,
.feedback-toast-leave-active {
  transition:
    opacity var(--motion-fast),
    transform var(--motion-fast);
}

.feedback-toast-enter-from,
.feedback-toast-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .feedback-toast-enter-active,
  .feedback-toast-leave-active {
    transition-duration: 120ms;
  }
}
</style>
