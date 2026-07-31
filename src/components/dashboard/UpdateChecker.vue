<template>
  <span
    class="update-btn"
    :class="{ 'is-disabled': !isConfigured }"
    :style="{
      position: 'relative',
    }"
    :aria-disabled="!isConfigured"
    @click="handleClick"
  >
    <span v-if="hasNewVersion" class="update-dot" />
    {{
      !isConfigured
        ? '更新源未配置'
        : isChecking
          ? '检查中...'
          : hasNewVersion
            ? '检测到新版本'
            : '检查更新'
    }}
  </span>
</template>

<script setup lang="ts">
interface Props {
  isChecking: boolean;
  hasNewVersion: boolean;
  isConfigured?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isConfigured: false,
});

const emit = defineEmits<{
  'check-update': [];
}>();

const handleClick = () => {
  if (!props.isConfigured) return;
  emit('check-update');
};
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

.update-btn.is-disabled {
  cursor: default;
  opacity: 0.68;
}

.update-btn.is-disabled:hover {
  background: var(--control-bg);
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
