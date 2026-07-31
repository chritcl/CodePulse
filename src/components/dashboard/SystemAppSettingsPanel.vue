<template>
  <div class="settings-panel system-settings-panel">
    <section class="settings-group">
      <header class="settings-group-header">
        <div>
          <h2>运行方式</h2>
          <p>管理灵动岛与 Windows 的协作方式</p>
        </div>
      </header>
      <div class="settings-list">
        <div class="setting-row">
          <span class="setting-copy">
            <strong>灵动岛</strong>
            <small>控制桌面 Widget 的显示状态</small>
          </span>
          <MaterialSwitch
            :model-value="islandStore.isVisible"
            label="灵动岛总开关"
            @update:model-value="void actions.setIslandVisible($event)"
          />
        </div>
        <div class="setting-row">
          <span class="setting-copy">
            <strong>开机自启动</strong>
            <small>登录 Windows 后自动启动 CodePulse</small>
          </span>
          <MaterialSwitch
            :model-value="settingsStore.autoStart"
            label="开机自启动"
            @update:model-value="$emit('toggle-autostart', $event)"
          />
        </div>
        <div class="setting-row">
          <span class="setting-copy">
            <strong>置于任务栏层级</strong>
            <small>全屏游戏中使用灵动岛时建议关闭</small>
          </span>
          <MaterialSwitch
            :model-value="settingsStore.pinToTaskbar"
            label="置于任务栏层级"
            @update:model-value="void actions.setPinToTaskbar($event)"
          />
        </div>
      </div>
    </section>

    <section class="settings-group">
      <header class="settings-group-header">
        <div>
          <h2>版本与更新</h2>
          <p>当前安装版本与更新状态</p>
        </div>
      </header>
      <div class="app-version-card">
        <img src="@/assets/codepulse-mark.svg" alt="CodePulse" />
        <span>
          <strong>CodePulse</strong>
          <small>版本 {{ appVersion }}</small>
        </span>
        <button
          type="button"
          class="material-tonal-button"
          :disabled="!isUpdateConfigured || isCheckingUpdate"
          @click="$emit('check-update')"
        >
          {{
            !isUpdateConfigured
              ? '更新源未配置'
              : isCheckingUpdate
                ? '检查中…'
                : hasNewVersion
                  ? '发现新版本'
                  : '检查更新'
          }}
        </button>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import type { useSettingsActions } from '@/composables/useSettingsActions';
import { useIslandStore, useSettingsStore } from '@/stores';
import MaterialSwitch from './MaterialSwitch.vue';

defineProps<{
  actions: ReturnType<typeof useSettingsActions>;
  appVersion: string;
  isCheckingUpdate: boolean;
  hasNewVersion: boolean;
  isUpdateConfigured?: boolean;
}>();

defineEmits<{
  'toggle-autostart': [enabled: boolean];
  'check-update': [];
}>();

const islandStore = useIslandStore();
const settingsStore = useSettingsStore();
</script>

<style scoped>
.system-settings-panel {
  display: grid;
  gap: 12px;
}

.app-version-card {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 11px;
  padding: 13px 14px;
}

.app-version-card img {
  width: 40px;
  height: 40px;
  border-radius: 12px;
}

.app-version-card > span {
  display: grid;
  gap: 2px;
}

.app-version-card strong {
  color: var(--heading-color);
  font-size: 12px;
}

.app-version-card small {
  color: var(--item-desc-color);
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 10px;
}

.resource-links {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 8px;
}

.resource-links button {
  padding: 9px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--item-desc-color);
  font-size: 11px;
  cursor: pointer;
  transition:
    color var(--motion-fast),
    background-color var(--motion-fast);
}

.resource-links button:hover {
  background: var(--state-hover);
  color: var(--heading-color);
}
</style>
