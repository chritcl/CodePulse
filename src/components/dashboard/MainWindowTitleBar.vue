<template>
  <header class="main-titlebar" data-tauri-drag-region>
    <div class="titlebar-brand" data-tauri-drag-region>
      <img src="@/assets/codepulse-mark.svg" alt="CodePulse" class="titlebar-logo" />
      <span class="titlebar-product" data-tauri-drag-region>CodePulse</span>
      <span class="titlebar-divider" aria-hidden="true" />
      <span class="titlebar-page" data-tauri-drag-region>{{ pageTitle }}</span>
    </div>

    <div class="titlebar-actions">
      <button
        type="button"
        class="titlebar-action"
        aria-label="最小化窗口"
        @mousedown.stop
        @click="minimizeWindow"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5h10" />
        </svg>
      </button>
      <button
        type="button"
        class="titlebar-action titlebar-close"
        aria-label="隐藏到托盘"
        @mousedown.stop
        @click="hideWindow"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 4 8 8m0-8-8 8" />
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';

defineProps<{
  pageTitle: string;
}>();

const minimizeWindow = async () => {
  try {
    await getCurrentWindow().minimize();
  } catch (error) {
    console.error('最小化主窗口失败:', error);
  }
};

const hideWindow = async () => {
  try {
    await getCurrentWindow().hide();
  } catch (error) {
    console.error('隐藏主窗口失败:', error);
  }
};
</script>

<style scoped>
.main-titlebar {
  height: 38px;
  flex: 0 0 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 14px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--titlebar-bg);
  -webkit-app-region: drag;
}

.titlebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-body);
}

.titlebar-logo {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(18, 19, 24, 0.16);
}

.titlebar-product {
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.titlebar-divider {
  width: 1px;
  height: 13px;
  background: var(--glass-border-strong);
}

.titlebar-page {
  overflow: hidden;
  color: var(--item-desc-color);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.titlebar-actions {
  height: 100%;
  display: flex;
  -webkit-app-region: no-drag;
}

.titlebar-action {
  width: 46px;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--item-desc-color);
  cursor: pointer;
  transition:
    color var(--motion-fast),
    background-color var(--motion-fast);
}

.titlebar-action svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.4;
}

.titlebar-action:hover {
  color: var(--text-body);
  background: var(--state-hover);
}

.titlebar-action:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -3px;
}

.titlebar-close:hover {
  color: #ffffff;
  background: #d94a4a;
}
</style>
