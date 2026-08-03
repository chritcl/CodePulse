<template>
  <section class="dashboard-home">
    <DashboardHeader
      :app-version="appVersion"
      :is-widget-visible="islandStore.isVisible"
      @open-settings="$emit('open-settings')"
      @toggle-widget="void actions.setIslandVisible($event)"
    />

    <div class="dashboard-content">
      <RealtimeNetworkCard :show-stats="rightPanel === 'stats'" @toggle-panel="toggleRightPanel" />
      <GeneralSettingsCard
        v-if="rightPanel === 'settings'"
        :actions="actions"
        @toggle-autostart="$emit('toggle-autostart')"
      />
      <TrafficStatisticsCard v-else />
    </div>

    <footer class="panel-footer">
      <UpdateChecker
        :is-checking="isCheckingUpdate"
        :has-new-version="hasNewVersion"
        :is-configured="isUpdateConfigured"
        @check-update="$emit('check-update')"
      />
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { useSettingsActions } from '@/composables/dashboard/useSettingsActions';
import { useIslandStore, useNetworkStore } from '@/stores';
import DashboardHeader from './DashboardHeader.vue';
import RealtimeNetworkCard from './RealtimeNetworkCard.vue';
import TrafficStatisticsCard from './TrafficStatisticsCard.vue';
import GeneralSettingsCard from './settings/GeneralSettingsCard.vue';
import UpdateChecker from './UpdateChecker.vue';

defineProps<{
  appVersion: string;
  actions: ReturnType<typeof useSettingsActions>;
  isCheckingUpdate: boolean;
  hasNewVersion: boolean;
  isUpdateConfigured?: boolean;
}>();

defineEmits<{
  'open-settings': [];
  'toggle-autostart': [];
  'check-update': [];
}>();

const islandStore = useIslandStore();
const networkStore = useNetworkStore();
const rightPanel = ref<'settings' | 'stats'>('settings');

const toggleRightPanel = () => {
  rightPanel.value = rightPanel.value === 'settings' ? 'stats' : 'settings';
  networkStore.saveTrafficData();
};
</script>

<style scoped>
.dashboard-home {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.dashboard-content {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 5px 20px 14px;
}

.dashboard-content > * {
  flex: 1 1 0;
  min-width: 0;
}

.dashboard-content > :first-child {
  flex: 0 0 42%;
}

.panel-footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  border-top: 1px solid var(--glass-border);
  background: var(--surface-soft);
}

.footer-links {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--glass-border-strong);
}

.footer-links button {
  padding: 2px;
  border: 0;
  background: transparent;
  color: var(--footer-text);
  font-size: 11px;
  cursor: pointer;
}

.footer-links button:hover {
  color: var(--heading-color);
}
</style>
