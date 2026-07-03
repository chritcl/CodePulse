<template>
  <Transition name="fade">
    <div v-if="dialog.visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-card">
        <div class="modal-header">
          <h4>{{ dialog.title }}</h4>
        </div>
        <div class="modal-body">
          <p>{{ dialog.message }}</p>
        </div>
        <div class="modal-footer">
          <button v-if="dialog.isConfirm" class="btn btn-secondary" @click="$emit('close')">
            取消
          </button>
          <button class="btn btn-primary" @click="$emit('confirm')">确定</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import type { DialogConfig } from '@/types';

interface Props {
  dialog: DialogConfig;
}

defineProps<Props>();

defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.modal-card {
  background: var(--modal-bg);
  border: 1px solid var(--modal-border);
  border-radius: 16px;
  padding: 24px;
  min-width: 320px;
  max-width: 400px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}

.modal-header {
  margin-bottom: 12px;
}

.modal-header h4 {
  font-size: 16px;
  font-weight: 600;
  color: var(--modal-h4);
  margin: 0;
}

.modal-body {
  margin-bottom: 20px;
}

.modal-body p {
  font-size: 13px;
  color: var(--modal-p);
  margin: 0;
  line-height: 1.6;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn {
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary {
  background: var(--btn-sec-bg);
  color: var(--btn-sec-color);
  border: 1px solid var(--btn-sec-border);
}

.btn-secondary:hover {
  background: var(--btn-sec-hover-bg);
  color: var(--btn-sec-hover-color);
}

.btn-primary {
  background: var(--btn-pri-bg);
  color: var(--btn-pri-color);
  border: 1px solid var(--btn-pri-border);
}

.btn-primary:hover {
  background: var(--btn-pri-hover-bg);
  box-shadow: 0 4px 12px var(--btn-pri-shadow-hover);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
