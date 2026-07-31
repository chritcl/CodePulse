<template>
  <header class="panel-header">
    <div class="brand">
      <img src="@/assets/codepulse-mark.svg" class="logo-icon" alt="CodePulse" />
      <div>
        <h1>CodePulse</h1>
        <p class="subtitle">CodePulse 桌面灵动岛组件 v{{ appVersion }}</p>
      </div>
    </div>

    <div class="header-controls">
      <button class="dynamicset-btn" @click="$emit('open-settings')">
        设置中心
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 5 7 7-7 7" />
        </svg>
      </button>
      <span class="control-separator" />

      <span class="status-badge" :class="{ 'is-active': isWidgetVisible }">
        {{ isWidgetVisible ? '已开启' : '已关闭' }}
      </span>
      <MaterialSwitch
        :model-value="isWidgetVisible"
        label="灵动岛总开关"
        @update:model-value="$emit('toggle-widget', $event)"
      />
    </div>
  </header>
</template>

<script setup lang="ts">
import MaterialSwitch from './MaterialSwitch.vue';

interface Props {
  appVersion: string;
  isWidgetVisible: boolean;
}

defineProps<Props>();

defineEmits<{
  'open-settings': [];
  'toggle-widget': [enabled: boolean];
}>();
</script>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  padding: 15px 20px 13px;
  background: transparent;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  box-shadow: 0 6px 18px rgba(16, 20, 28, 0.14);
}

.brand h1 {
  font-size: 16px;
  font-weight: 600;
  color: var(--h1-color);
  margin: 0;
}

.brand .subtitle {
  font-size: 12px;
  color: var(--subtitle-color);
  margin: 2px 0 0 0;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dynamicset-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 11px 7px 13px;
  border: 1px solid var(--glass-border-strong);
  border-radius: 14px;
  background: var(--surface-soft);
  color: var(--text-body);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition:
    background-color var(--motion-fast),
    transform var(--motion-fast);
}

.dynamicset-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.dynamicset-btn:hover {
  background: var(--state-hover);
  transform: translateX(1px);
}

.control-separator {
  width: 1px;
  height: 20px;
  background: var(--control-border);
}

.status-badge {
  font-size: 12px;
  color: var(--status-badge-inactive);
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--tag-dev-bg);
}

.status-badge.is-active {
  color: var(--status-badge-active);
  background: var(--data-tag-bg);
}
</style>
