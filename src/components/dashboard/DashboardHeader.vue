<template>
  <header class="panel-header">
    <div class="brand">
      <img src="@/assets/logo.png" class="logo-icon" />
      <div>
        <h1>NetSpeed Dynamic Pro</h1>
        <p class="subtitle">NSD 桌面灵动岛组件 v{{ appVersion }}</p>
      </div>
    </div>

    <div class="header-controls">
      <button
        class="dynamicset-btn"
        :class="{ 'is-active': showSettings }"
        @click="$emit('toggle-settings')"
      >
        灵动岛设置
      </button>
      <span class="control-separator" />

      <span class="status-badge" :class="{ 'is-active': isWidgetVisible }">
        {{ isWidgetVisible ? '已开启' : '已关闭' }}
      </span>
      <label class="switch header-switch">
        <input type="checkbox" :checked="isWidgetVisible" @change="$emit('toggle-widget')" />
        <span class="slider" />
      </label>
    </div>
  </header>
</template>

<script setup lang="ts">
interface Props {
  appVersion: string;
  isWidgetVisible: boolean;
  showSettings: boolean;
}

defineProps<Props>();

defineEmits<{
  'toggle-settings': [];
  'toggle-widget': [];
}>();
</script>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: var(--control-bg);
  border-bottom: 1px solid var(--control-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
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
  padding: 6px 12px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  color: var(--text-body);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dynamicset-btn:hover {
  background: var(--card-bg);
}

.dynamicset-btn.is-active {
  background: var(--btn-pri-bg);
  color: var(--btn-pri-color);
  border-color: var(--btn-pri-border);
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

.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--slider-bg);
  transition: 0.4s;
  border-radius: 22px;
}

.slider:before {
  position: absolute;
  content: '';
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--slider-checked-bg);
}

input:checked + .slider:before {
  transform: translateX(18px);
}

.header-switch {
  transform: scale(0.9);
}
</style>
