<template>
  <div class="card settings-card">
    <h3>常规设置</h3>

    <div class="setting-item flex-row-item">
      <div class="item-meta">
        <span class="item-title">主题颜色</span>
        <span class="item-desc">切换控制台主题色</span>
      </div>
      <select
        :value="settingsStore.themeMode"
        class="theme-select"
        @change="handleThemeChange"
      >
        <option value="light">浅色模式</option>
        <option value="dark">深色模式</option>
        <option value="system">跟随系统</option>
      </select>
    </div>

    <div class="setting-item">
      <div class="item-meta">
        <span class="item-title">开机自启动</span>
        <span class="item-desc">跟随系统启动 NSD</span>
      </div>
      <label class="switch">
        <input
          v-model="settingsStore.autoStart"
          type="checkbox"
          @change="$emit('toggle-autostart')"
        />
        <span class="slider" />
      </label>
    </div>

    <div class="setting-item slider-item">
      <div class="item-meta" style="width: 100%">
        <div class="combo-title-row">
          <span class="item-title">灵动岛不透明度</span>

          <span class="title-separator">|</span>

          <span class="item-title-sec">
            置于任务栏
            <span
              class="tooltip-wrapper"
              data-tooltip="若要在全屏游戏中使用灵动岛建议关闭此项"
            >
              <p class="set-item-tips-tag">🙋</p>
            </span>
          </span>

          <label class="switch mini-switch" style="opacity: 0.8">
            <input
              v-model="settingsStore.pinToTaskbar"
              type="checkbox"
              @change="handlePinTaskbarChange"
            />
            <span class="slider" />
          </label>
        </div>

        <span class="item-desc">调节灵动岛的背景透明度 ({{ settingsStore.opacity }}%)</span>
      </div>

      <input
        v-model="settingsStore.opacity"
        type="range"
        min="0"
        max="100"
        class="range-input"
        @input="handleOpacityChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '@/stores';
import { emit } from '@tauri-apps/api/event';

const settingsStore = useSettingsStore();

defineEmits<{
  'toggle-autostart': [];
}>();

/** 处理主题变更 */
const handleThemeChange = (event: Event) => {
  const target = event.target as HTMLSelectElement;
  settingsStore.setThemeMode(target.value as 'light' | 'dark' | 'system');
};

/** 处理任务栏停靠变更 */
const handlePinTaskbarChange = async () => {
  await emit('control-pin-taskbar', { enabled: settingsStore.pinToTaskbar });
};

/** 处理透明度变更 */
const handleOpacityChange = async () => {
  await emit('control-island-opacity', { opacity: settingsStore.opacity });
};
</script>

<style scoped>
.settings-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px var(--card-shadow);
  transition: all 0.3s ease;
}

.settings-card:hover {
  box-shadow: 0 4px 12px var(--card-shadow-hover);
}

.settings-card h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--card-h3-color);
  margin: 0 0 16px 0;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--divider-border);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item.flex-row-item {
  flex-direction: row;
}

.item-meta {
  display: flex;
  flex-direction: column;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--item-title-color);
}

.item-title-sec {
  font-size: 13px;
  font-weight: 500;
  color: var(--item-title-color);
  display: flex;
  align-items: center;
  gap: 4px;
}

.item-desc {
  font-size: 11px;
  color: var(--item-desc-color);
  margin-top: 2px;
}

.title-separator {
  color: var(--control-border);
  margin: 0 8px;
}

.combo-title-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.tooltip-wrapper {
  position: relative;
  cursor: help;
}

.set-item-tips-tag {
  margin: 0;
  font-size: 12px;
}

.theme-select {
  padding: 6px 10px;
  border: 1px solid var(--select-border);
  border-radius: 6px;
  background: var(--select-bg);
  color: var(--select-text);
  font-size: 12px;
  cursor: pointer;
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

.mini-switch {
  transform: scale(0.85);
}

.slider-item {
  flex-direction: column;
  align-items: flex-start;
}

.range-input {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--range-bg);
  outline: none;
  -webkit-appearance: none;
  margin-top: 8px;
}

.range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--range-thumb-bg);
  border: 2px solid var(--range-thumb-border);
  cursor: pointer;
  box-shadow: 0 2px 4px var(--range-thumb-shadow);
}
</style>
