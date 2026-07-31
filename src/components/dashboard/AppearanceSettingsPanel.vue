<template>
  <div class="settings-panel appearance-settings-panel">
    <section class="settings-group">
      <header class="settings-group-header">
        <div>
          <h2>界面主题</h2>
          <p>选择控制台的明暗外观</p>
        </div>
      </header>
      <div class="theme-selector" role="radiogroup" aria-label="界面主题">
        <button
          v-for="theme in themes"
          :key="theme.id"
          type="button"
          role="radio"
          class="theme-option"
          :class="{ 'is-selected': settingsStore.themeMode === theme.id }"
          :aria-checked="settingsStore.themeMode === theme.id"
          :data-theme-mode="theme.id"
          @click="void actions.setThemeMode(theme.id)"
        >
          <span class="theme-preview" :class="`is-${theme.id}`">
            <i />
            <i />
          </span>
          <span>{{ theme.label }}</span>
        </button>
      </div>
    </section>

    <section class="settings-group">
      <header class="settings-group-header">
        <div>
          <h2>灵动岛外观</h2>
          <p>调整基础颜色与背景不透明度</p>
        </div>
      </header>
      <div class="setting-row">
        <span class="setting-copy">
          <strong>岛屿颜色</strong>
          <small>根据桌面背景选择更清晰的基色</small>
        </span>
        <div class="island-color-selector" role="radiogroup" aria-label="灵动岛颜色">
          <button
            type="button"
            class="island-color is-black"
            :class="{ 'is-selected': settingsStore.islandTheme === 'black' }"
            aria-label="暗色灵动岛"
            :aria-checked="settingsStore.islandTheme === 'black'"
            role="radio"
            @click="void actions.setIslandTheme('black')"
          />
          <button
            type="button"
            class="island-color is-white"
            :class="{ 'is-selected': settingsStore.islandTheme === 'white' }"
            aria-label="亮色灵动岛"
            :aria-checked="settingsStore.islandTheme === 'white'"
            role="radio"
            @click="void actions.setIslandTheme('white')"
          />
        </div>
      </div>
      <div class="opacity-setting">
        <div class="setting-copy">
          <strong>背景不透明度</strong>
          <small>拖动时实时预览灵动岛背景</small>
        </div>
        <div class="opacity-control">
          <input
            :value="settingsStore.opacity"
            type="range"
            min="0"
            max="100"
            aria-label="灵动岛背景不透明度"
            @input="handleOpacityInput"
            @change="handleOpacityCommit"
          />
          <output>{{ settingsStore.opacity }}%</output>
        </div>
      </div>
    </section>

    <section class="settings-group">
      <div class="setting-row">
        <span class="setting-copy">
          <strong>弹簧动画</strong>
          <small>为点击、展开和内容切换保留明显回弹</small>
        </span>
        <MaterialSwitch
          :model-value="settingsStore.enableSpringAnimation"
          label="弹簧动画"
          @update:model-value="void actions.setSpringAnimationEnabled($event)"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { useSettingsActions } from '@/composables/useSettingsActions';
import { useSettingsStore } from '@/stores';
import type { ThemeMode } from '@/types';
import MaterialSwitch from './MaterialSwitch.vue';

const props = defineProps<{
  actions: ReturnType<typeof useSettingsActions>;
}>();

const settingsStore = useSettingsStore();
const themes: Array<{ id: ThemeMode; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'system', label: '跟随系统' },
];

const handleOpacityInput = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value);
  props.actions.previewOpacity(value);
};

const handleOpacityCommit = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value);
  props.actions.commitOpacity(value);
};
</script>

<style scoped>
.appearance-settings-panel {
  display: grid;
  gap: 12px;
}

.theme-selector {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  /* 与分组内 14px 内缩节奏对齐，避免按钮贴边及底角被卡片圆角裁切 */
  margin: 0 14px 14px;
}

.theme-option {
  display: grid;
  grid-template-columns: 50px 1fr;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border: 1px solid var(--control-border);
  border-radius: 16px;
  background: var(--surface-soft);
  color: var(--item-desc-color);
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--motion-standard),
    border-color var(--motion-standard),
    transform var(--motion-fast);
}

.theme-option:hover {
  transform: translateY(-1px);
}

.theme-option.is-selected {
  border-color: color-mix(in srgb, var(--category-accent) 48%, transparent);
  background: color-mix(in srgb, var(--category-accent) 13%, var(--surface-soft));
  color: var(--heading-color);
}

.theme-preview {
  height: 32px;
  display: grid;
  grid-template-columns: 13px 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 9px;
  box-sizing: border-box;
  background: #f5f6fa;
  box-shadow: inset 0 0 0 1px rgba(20, 22, 28, 0.08);
}

.theme-preview i {
  border-radius: 4px;
  background: #d9deea;
}

.theme-preview i:last-child {
  background: #ffffff;
}

.theme-preview.is-dark {
  background: #181b22;
}

.theme-preview.is-dark i {
  background: #373c48;
}

.theme-preview.is-dark i:last-child {
  background: #242832;
}

.theme-preview.is-system {
  background: linear-gradient(120deg, #f5f6fa 50%, #181b22 50%);
}

.theme-preview.is-system i:first-child {
  background: linear-gradient(120deg, #d9deea 50%, #373c48 50%);
}

.theme-preview.is-system i:last-child {
  background: linear-gradient(120deg, #ffffff 50%, #242832 50%);
}

.island-color-selector {
  display: flex;
  gap: 8px;
}

.island-color {
  width: 42px;
  height: 26px;
  padding: 0;
  border: 3px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 0 0 1px var(--control-border);
  transition:
    border-color var(--motion-fast),
    transform var(--motion-fast);
}

.island-color:hover {
  transform: scale(1.06);
}

.island-color.is-black {
  background: #111318;
}

.island-color.is-white {
  background: #f6f7fb;
}

.island-color.is-selected {
  border-color: var(--category-accent);
}

.opacity-setting {
  display: grid;
  gap: 12px;
  padding: 13px 14px;
}

.opacity-control {
  display: grid;
  grid-template-columns: 1fr 54px;
  align-items: center;
  gap: 12px;
}

.opacity-control input {
  width: 100%;
  height: 6px;
  margin: 0;
  border-radius: 999px;
  outline: none;
  background: var(--range-bg);
  accent-color: var(--category-accent);
  appearance: none;
}

.opacity-control input::-webkit-slider-thumb {
  width: 18px;
  height: 18px;
  border: 3px solid var(--category-accent);
  border-radius: 50%;
  background: var(--surface-solid);
  box-shadow: 0 3px 9px rgba(17, 19, 25, 0.18);
  cursor: pointer;
  appearance: none;
}

.opacity-control output {
  padding: 6px 7px;
  border-radius: 9px;
  background: var(--segmented-bg);
  color: var(--heading-color);
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
  font-weight: 650;
  text-align: center;
}
</style>
