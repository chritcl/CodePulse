<template>
  <section
    class="settings-detail"
    :class="`is-${category}`"
    :style="{ viewTransitionName: `settings-${category}` }"
  >
    <header class="settings-detail-header">
      <button
        type="button"
        class="settings-back-button"
        aria-label="返回设置首页"
        @click="$emit('back')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
      <span class="detail-category-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path v-if="category === 'appearance'" d="M12 3v3m0 12v3m9-9h-3M6 12H3" />
          <path v-else-if="category === 'island'" d="M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7Z" />
          <path v-else-if="category === 'system'" d="M4 6.5h16v11H4zM8 21h8M12 17.5V21" />
          <path
            v-else-if="category === 'codex'"
            d="M7 4h10l3 4v8l-3 4H7l-3-4V8zM9 9h6m-6 3h6m-6 3h4"
          />
          <path
            v-else
            d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9m-12.2-3.7L16.4 20.2M16.4 3.8 7.6 20.2"
          />
        </svg>
      </span>
      <div>
        <p>设置中心</p>
        <h1>{{ categoryDefinition.title }}</h1>
        <small>{{ categoryDefinition.description }}</small>
      </div>
    </header>

    <div class="settings-detail-scroll">
      <AppearanceSettingsPanel v-if="category === 'appearance'" :actions="actions" />
      <IslandSettingsPanel v-else-if="category === 'island'" :actions="actions" />
      <SystemAppSettingsPanel
        v-else-if="category === 'system'"
        :actions="actions"
        :app-version="appVersion"
        :is-checking-update="isCheckingUpdate"
        :has-new-version="hasNewVersion"
        :is-update-configured="isUpdateConfigured"
        @toggle-autostart="$emit('toggle-autostart', $event)"
        @check-update="$emit('check-update')"
      />
      <CodexIntegrationSettings v-else-if="category === 'codex'" />
      <ClaudeIntegrationSettings v-else />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { useSettingsActions } from '@/composables/dashboard/useSettingsActions';
import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryId,
} from '@/modules/dashboard/settingsNavigation';
import AppearanceSettingsPanel from './AppearanceSettingsPanel.vue';
import IslandSettingsPanel from './IslandSettingsPanel.vue';
import SystemAppSettingsPanel from './SystemAppSettingsPanel.vue';
import CodexIntegrationSettings from './CodexIntegrationSettings.vue';
import ClaudeIntegrationSettings from './ClaudeIntegrationSettings.vue';

const props = defineProps<{
  category: SettingsCategoryId;
  actions: ReturnType<typeof useSettingsActions>;
  appVersion: string;
  isCheckingUpdate: boolean;
  hasNewVersion: boolean;
  isUpdateConfigured?: boolean;
}>();

defineEmits<{
  back: [];
  'toggle-autostart': [enabled: boolean];
  'check-update': [];
}>();

const categoryDefinition = computed(
  () => SETTINGS_CATEGORIES.find((item) => item.id === props.category) ?? SETTINGS_CATEGORIES[0]
);
</script>

<style src="./SettingsDetail.css"></style>
