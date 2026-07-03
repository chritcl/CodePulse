<template>
  <div class="panel-container">
    <!-- 头部 -->
    <DashboardHeader
      :app-version="appVersion"
      :is-widget-visible="islandStore.isVisible"
      :show-settings="islandStore.showSettings"
      @toggle-settings="islandStore.toggleSettings()"
      @toggle-widget="islandStore.toggleVisibility()"
    />

    <hr class="divider" />

    <!-- 主内容区 -->
    <div class="main-content" :class="{ 'dynamicset-layout': islandStore.showSettings }">
      <template v-if="!islandStore.showSettings">
        <!-- 实时网速卡片 -->
        <RealtimeNetworkCard
          :show-stats="rightPanel === 'stats'"
          @toggle-panel="toggleRightPanel"
        />

        <!-- 右侧面板 -->
        <template v-if="rightPanel === 'settings'">
          <GeneralSettingsCard @toggle-autostart="autoStart.toggleAutoStart()" />
        </template>
        <template v-else>
          <TrafficStatisticsCard />
        </template>
      </template>

      <template v-else>
        <!-- 灵动岛设置面板 -->
        <IslandSettingsPanel />
      </template>
    </div>

    <!-- 页脚 -->
    <footer class="panel-footer">
      <div class="footer-links">
        <span class="footer-link" @click="openNSDweb">官网</span>
        <span class="footer-separator">·</span>
        <span class="footer-link" @click="openNSDdata">数据</span>
        <span class="footer-separator">·</span>
        <span class="footer-link" @click="openMywebsite">作者</span>
      </div>
      <UpdateChecker
        :is-checking="updateChecker.isChecking.value"
        :has-new-version="updateChecker.hasNewVersion.value"
        @check-update="handleCheckUpdate"
      />
    </footer>

    <!-- 对话框 -->
    <AppDialog
      :dialog="dialog.dialog.value"
      @close="dialog.closeDialog()"
      @confirm="dialog.handleConfirm()"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';

import { useIslandStore, useNetworkStore } from '@/stores';
import { useTheme, useUpdateChecker, useDialog, useAutoStart } from '@/composables';

import DashboardHeader from './DashboardHeader.vue';
import RealtimeNetworkCard from './RealtimeNetworkCard.vue';
import TrafficStatisticsCard from './TrafficStatisticsCard.vue';
import GeneralSettingsCard from './GeneralSettingsCard.vue';
import IslandSettingsPanel from './IslandSettingsPanel.vue';
import UpdateChecker from './UpdateChecker.vue';
import AppDialog from './AppDialog.vue';

// Stores
const islandStore = useIslandStore();
const networkStore = useNetworkStore();

// Composables
const theme = useTheme();
const updateChecker = useUpdateChecker();
const dialog = useDialog();
const autoStart = useAutoStart(dialog.showDialog);

// 状态
const appVersion = ref('1.0.0');
const rightPanel = ref<'settings' | 'stats'>('settings');

/** 切换右侧面板 */
const toggleRightPanel = async () => {
  rightPanel.value = rightPanel.value === 'settings' ? 'stats' : 'settings';
  networkStore.saveTrafficData();
};

/** 打开作者网站 */
const openMywebsite = () => {
  openUrl('https://blog.georgewu.top');
};

/** 打开 NSD 官网 */
const openNSDweb = () => {
  openUrl('https://nsd.georgewu.top/');
};

/** 打开 NSD 数据页 */
const openNSDdata = () => {
  openUrl('https://nsd.georgewu.top/#stats');
};

/** 检查更新 */
const handleCheckUpdate = () => {
  updateChecker.checkUpdate(dialog.showDialog);
};

// 定时器
let speedTimer: number;

onMounted(async () => {
  // 初始化
  theme.initialize();
  networkStore.initialize();
  await islandStore.startListening();
  await islandStore.checkInitialState();

  // 获取版本号
  try {
    appVersion.value = await getVersion();
  } catch (e) {
    console.error('获取应用版本号失败:', e);
  }

  // 静默检查更新
  updateChecker.silentCheckUpdate();

  // 启动网速监控
  networkStore.fetchSpeedStats();
  speedTimer = setInterval(networkStore.fetchSpeedStats, 1000) as unknown as number;

  // 禁用右键菜单
  window.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    { capture: true }
  );
});

onUnmounted(() => {
  clearInterval(speedTimer);
  theme.cleanup();
  networkStore.saveTrafficData();
});
</script>

<style scoped>
.panel-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-body);
  color: var(--text-body);
}

.divider {
  border: none;
  border-top: 1px solid var(--divider-border);
  margin: 0;
}

.main-content {
  flex: 1;
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  overflow-y: auto;
}

.main-content.dynamicset-layout {
  padding: 12px;
}

.panel-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid var(--divider-border);
  background: var(--control-bg);
}

.footer-links {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-link {
  font-size: 12px;
  color: var(--footer-text);
  cursor: pointer;
  transition: color 0.2s ease;
}

.footer-link:hover {
  color: var(--text-body);
}

.footer-separator {
  color: var(--control-border);
  font-size: 12px;
}
</style>
