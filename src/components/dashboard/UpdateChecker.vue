<template>
  <span
    class="update-btn"
    :style="{
      position: 'relative',
    }"
    @click="$emit('check-update')"
  >
    <span v-if="hasNewVersion" class="update-dot" />
    {{ isChecking ? '检查中...' : hasNewVersion ? '检测到新版本' : '检查更新' }}
  </span>
</template>

<script setup lang="ts">
interface Props {
  isChecking: boolean;
  hasNewVersion: boolean;
}

defineProps<Props>();

defineEmits<{
  'check-update': [];
}>();
</script>

<style scoped>
.update-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--control-border);
  border-radius: 8px;
  background: var(--control-bg);
  color: var(--text-body);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.update-btn:hover {
  background: var(--card-bg);
}

.update-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  background: #ef4444;
  border-radius: 50%;
  border: 2px solid var(--control-bg);
}
</style>
