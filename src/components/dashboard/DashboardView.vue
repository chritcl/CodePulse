<template>
  <div class="main-window-shell" :data-window-material="windowMaterial">
    <MainWindowTitleBar :page-title="pageTitle" />

    <main class="main-window-content">
      <Transition name="dashboard-page">
        <DashboardHome
          v-if="navigation.location.value.page === 'dashboard'"
          key="dashboard"
          :app-version="appVersion"
          :actions="settingsActions"
          :is-checking-update="updateChecker.isChecking.value"
          :has-new-version="updateChecker.hasNewVersion.value"
          :is-update-configured="updateChecker.isConfigured.value"
          @open-settings="void navigation.openHome(runTransition)"
          @toggle-autostart="void autoStart.toggleAutoStart()"
          @check-update="handleCheckUpdate"
        />

        <SettingsHome
          v-else-if="navigation.location.value.page === 'settings-home'"
          key="settings-home"
          :island-visible="islandStore.isVisible"
          :music-enabled="settingsStore.enableMusicCtrl"
          :notifications-enabled="settingsStore.enableMsgNotify"
          :navigation-disabled="navigation.isNavigating.value"
          @back="void navigation.goBack(runTransition)"
          @open-category="openCategory"
          @toggle-island="void settingsActions.setIslandVisible($event)"
          @toggle-music="void settingsActions.setMusicEnabled($event)"
          @toggle-notifications="void settingsActions.setNotificationsEnabled($event)"
        />

        <SettingsDetailView
          v-else
          :key="`settings-${navigation.location.value.category}`"
          :category="activeCategory"
          :actions="settingsActions"
          :app-version="appVersion"
          :is-checking-update="updateChecker.isChecking.value"
          :has-new-version="updateChecker.hasNewVersion.value"
          :is-update-configured="updateChecker.isConfigured.value"
          @back="void navigation.goBack(runTransition)"
          @toggle-autostart="handleAutoStart"
          @check-update="handleCheckUpdate"
        />
      </Transition>
    </main>

    <SettingsFeedbackToast :feedback="feedback.current.value" />
    <AppDialog
      :dialog="dialog.dialog.value"
      @close="dialog.closeDialog()"
      @confirm="dialog.handleConfirm()"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useIslandStore, useNetworkStore, useSettingsStore } from '@/stores';
import { useAutoStart, useDialog, useTheme, useUpdateChecker } from '@/composables';
import { useDashboardNavigation } from '@/composables/dashboard/useDashboardNavigation';
import { useSettingsActions } from '@/composables/dashboard/useSettingsActions';
import { useSettingsFeedback } from '@/composables/dashboard/useSettingsFeedback';
import {
  applyMainWindowMaterial,
  type MainWindowMaterial,
} from '@/modules/dashboard/mainWindowMaterial';
import { runDashboardViewTransition } from '@/modules/dashboard/viewTransition';
import type { SettingsCategoryId } from '@/modules/dashboard/settingsNavigation';
import MainWindowTitleBar from './MainWindowTitleBar.vue';
import DashboardHome from './DashboardHome.vue';
import SettingsHome from './settings/SettingsHome.vue';
import SettingsDetailView from './settings/SettingsDetailView.vue';
import SettingsFeedbackToast from './settings/SettingsFeedbackToast.vue';
import AppDialog from './AppDialog.vue';

const islandStore = useIslandStore();
const networkStore = useNetworkStore();
const settingsStore = useSettingsStore();
useTheme();

const updateChecker = useUpdateChecker();
const dialog = useDialog();
const autoStart = useAutoStart(dialog.showDialog);
const navigation = useDashboardNavigation();
const feedback = useSettingsFeedback();
const settingsActions = useSettingsActions(feedback.show);

const appVersion = ref('1.0.0');
const windowMaterial = ref<MainWindowMaterial>('fallback');
let speedTimer: number | null = null;

const activeCategory = computed(
  () => navigation.location.value.category ?? ('appearance' satisfies SettingsCategoryId)
);

const pageTitle = computed(() => {
  if (navigation.location.value.page === 'dashboard') return '控制台';
  if (navigation.location.value.page === 'settings-home') return '设置中心';
  return '设置详情';
});

const runTransition = (update: () => void) =>
  runDashboardViewTransition(update, { awaitRender: nextTick });

const openCategory = (category: SettingsCategoryId) => {
  void navigation.openCategory(category, runTransition);
};

const handleAutoStart = async (enabled: boolean) => {
  settingsStore.setAutoStart(enabled);
  await autoStart.toggleAutoStart();
};

const handleCheckUpdate = () => updateChecker.checkUpdate(dialog.showDialog);
const preventContextMenu = (event: MouseEvent) => event.preventDefault();

onMounted(async () => {
  networkStore.initialize();
  await navigation.start();
  await islandStore.startListening();
  await islandStore.checkInitialState();

  const appWindow = getCurrentWindow();
  windowMaterial.value = await applyMainWindowMaterial(() => appWindow.clearEffects());

  try {
    appVersion.value = await getVersion();
  } catch (error) {
    console.error('获取应用版本号失败:', error);
  }

  void updateChecker.silentCheckUpdate();
  void networkStore.fetchSpeedStats();
  speedTimer = window.setInterval(() => {
    void networkStore.fetchSpeedStats();
  }, 1000);
  window.addEventListener('contextmenu', preventContextMenu, { capture: true });
});

onUnmounted(() => {
  if (speedTimer !== null) window.clearInterval(speedTimer);
  window.removeEventListener('contextmenu', preventContextMenu, { capture: true });
  navigation.dispose();
  islandStore.stopListeningEvents();
  settingsActions.dispose();
  feedback.dispose();
  networkStore.saveTrafficData();
});
</script>

<style scoped>
.main-window-shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--glass-border-strong);
  border-radius: 16px;
  background: var(--surface-glass);
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.16);
  box-sizing: border-box;
  color: var(--text-body);
  backdrop-filter: blur(34px) saturate(1.24);
}

.main-window-shell[data-window-material='mica'],
.main-window-shell[data-window-material='acrylic'] {
  background: var(--surface-material);
}

.main-window-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.main-window-content > * {
  height: 100%;
}

.dashboard-page-enter-active,
.dashboard-page-leave-active {
  transition:
    opacity var(--motion-fast),
    transform var(--motion-expressive);
}

.dashboard-page-enter-from {
  opacity: 0;
  transform: translateY(5px) scale(0.992);
}

.dashboard-page-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.995);
}

/*
 * 原生 View Transition 运行期间由快照动画（含容器变形）接管视觉效果，
 * 禁用 Vue 自身的过渡，避免与浏览器快照动画重复播放
 */
:root:active-view-transition .dashboard-page-enter-active,
:root:active-view-transition .dashboard-page-leave-active {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-page-enter-active,
  .dashboard-page-leave-active {
    transition-duration: 120ms;
  }

  .dashboard-page-enter-from,
  .dashboard-page-leave-to {
    transform: none;
  }
}
</style>
