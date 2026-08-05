<template>
  <section class="settings-home" aria-labelledby="settings-home-title">
    <header class="settings-home-header">
      <button
        type="button"
        class="settings-back-button"
        aria-label="返回控制台"
        :disabled="navigationDisabled"
        @click="$emit('back')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
      <div>
        <p class="settings-eyebrow">SETTINGS</p>
        <h1 id="settings-home-title">设置中心</h1>
        <p>管理 CodePulse 与灵动岛体验</p>
      </div>
    </header>

    <div class="island-control-bar">
      <div class="control-bar-status">
        <span class="status-orbit" :class="{ 'is-active': islandVisible }" aria-hidden="true" />
        <span>
          <strong>{{ islandVisible ? '灵动岛正在运行' : '灵动岛已暂停' }}</strong>
          <small>快速控制</small>
        </span>
      </div>
      <div class="quick-controls">
        <div class="quick-control">
          <span>灵动岛</span>
          <MaterialSwitch
            :model-value="islandVisible"
            label="灵动岛"
            @update:model-value="$emit('toggle-island', $event)"
          />
        </div>
        <div class="quick-control">
          <span>音乐</span>
          <MaterialSwitch
            :model-value="musicEnabled"
            label="音乐控制"
            @update:model-value="$emit('toggle-music', $event)"
          />
        </div>
        <div class="quick-control">
          <span>通知</span>
          <MaterialSwitch
            :model-value="notificationsEnabled"
            label="消息通知"
            @update:model-value="$emit('toggle-notifications', $event)"
          />
        </div>
      </div>
    </div>

    <div class="settings-category-grid">
      <button
        v-for="category in SETTINGS_CATEGORIES"
        :key="category.id"
        type="button"
        class="settings-category-card"
        :class="`is-${category.id}`"
        :data-settings-category="category.id"
        :disabled="navigationDisabled"
        :style="{ viewTransitionName: `settings-${category.id}` }"
        @click="$emit('open-category', category.id)"
      >
        <span class="category-icon" aria-hidden="true">
          <svg v-if="category.id === 'appearance'" viewBox="0 0 24 24">
            <path
              d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.4-6.4-2.1 2.1M7.7 16.3l-2.1 2.1m12.8 0-2.1-2.1M7.7 7.7 5.6 5.6"
            />
            <circle cx="12" cy="12" r="4" />
          </svg>
          <svg v-else-if="category.id === 'island'" viewBox="0 0 24 24">
            <rect x="3" y="7" width="18" height="10" rx="5" />
            <path d="M8 12h3m2 0h3" />
          </svg>
          <svg v-else-if="category.id === 'system'" viewBox="0 0 24 24">
            <path d="M4 6.5h16v11H4z" />
            <path d="M8 21h8M12 17.5V21" />
          </svg>
          <svg v-else-if="category.id === 'codex'" viewBox="0 0 24 24">
            <path d="M7 4h10l3 4v8l-3 4H7l-3-4V8z" />
            <path d="M9 9h6m-6 3h6m-6 3h4" />
          </svg>
          <svg v-else viewBox="0 0 24 24">
            <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
            <path d="m7.6 3.8 8.8 16.4M16.4 3.8 7.6 20.2" />
          </svg>
        </span>
        <span class="category-copy">
          <strong>{{ category.title }}</strong>
          <small>{{ category.description }}</small>
        </span>
        <span class="category-footer">
          <span>{{ category.summary }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 5 7 7-7 7" />
          </svg>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryId,
} from '@/modules/dashboard/settingsNavigation';
import MaterialSwitch from '../MaterialSwitch.vue';

defineProps<{
  islandVisible: boolean;
  musicEnabled: boolean;
  notificationsEnabled: boolean;
  navigationDisabled: boolean;
}>();

defineEmits<{
  back: [];
  'open-category': [category: SettingsCategoryId];
  'toggle-island': [enabled: boolean];
  'toggle-music': [enabled: boolean];
  'toggle-notifications': [enabled: boolean];
}>();
</script>

<style scoped>
.settings-home {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 22px 20px;
  box-sizing: border-box;
}

.settings-home-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-home-header h1,
.settings-home-header p {
  margin: 0;
}

.settings-home-header h1 {
  color: var(--heading-color);
  font-family: 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
  font-size: 24px;
  font-weight: 680;
  letter-spacing: -0.02em;
}

.settings-home-header p:not(.settings-eyebrow) {
  margin-top: 2px;
  color: var(--item-desc-color);
  font-size: 12px;
}

.settings-eyebrow {
  color: var(--accent-primary);
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.settings-back-button {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  background: var(--surface-glass);
  color: var(--text-body);
  cursor: pointer;
  transition:
    background-color var(--motion-fast),
    transform var(--motion-fast);
}

.settings-back-button:hover {
  background: var(--surface-glass-high);
  transform: translateX(-2px);
}

.settings-back-button svg {
  width: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.island-control-bar {
  min-height: 70px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 14px 10px 16px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 26px 18px 26px 18px;
  background: radial-gradient(circle at 12% 0%, rgba(89, 104, 242, 0.32), transparent 34%), #15171d;
  color: #f7f8fc;
  box-shadow: 0 14px 34px rgba(15, 17, 23, 0.24);
  box-sizing: border-box;
}

.control-bar-status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 148px;
}

.control-bar-status > span:last-child {
  display: grid;
  gap: 2px;
}

.control-bar-status strong {
  font-size: 12px;
  font-weight: 650;
}

.control-bar-status small {
  color: rgba(247, 248, 252, 0.56);
  font-size: 10px;
}

.status-orbit {
  width: 10px;
  height: 10px;
  border: 3px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
  background: #717683;
  transition:
    background-color var(--motion-standard),
    box-shadow var(--motion-standard);
}

.status-orbit.is-active {
  background: #4ee1aa;
  box-shadow:
    0 0 0 5px rgba(78, 225, 170, 0.1),
    0 0 16px rgba(78, 225, 170, 0.5);
}

.quick-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quick-control {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px 6px 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.065);
}

.quick-control > span {
  color: rgba(247, 248, 252, 0.78);
  font-size: 10px;
}

.quick-control :deep(.material-switch) {
  width: 38px;
  height: 22px;
  flex-basis: 38px;
}

.quick-control :deep(.material-switch-thumb) {
  width: 14px;
  height: 14px;
}

.quick-control :deep(input:checked + .material-switch-track .material-switch-thumb) {
  width: 16px;
  transform: translate(15px, -50%);
}

.settings-category-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(82px, 1fr));
  gap: 12px;
  overflow-y: auto;
}

.settings-category-card {
  position: relative;
  min-width: 0;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  grid-template-rows: 1fr auto;
  gap: 8px 12px;
  padding: 15px;
  overflow: hidden;
  border: 1px solid var(--category-border);
  background: var(--category-bg);
  color: var(--text-body);
  text-align: left;
  cursor: pointer;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.3);
  transition:
    transform var(--motion-expressive),
    box-shadow var(--motion-standard),
    background-color var(--motion-standard);
}

.settings-category-card::after {
  content: '';
  position: absolute;
  width: 88px;
  height: 88px;
  right: -32px;
  top: -42px;
  border-radius: 50%;
  background: var(--category-orb);
  filter: blur(3px);
  opacity: 0.54;
}

.settings-category-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 26px var(--category-shadow);
}

.settings-category-card:active {
  transform: translateY(-1px) scale(0.992);
}

.settings-category-card:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.settings-category-card.is-appearance {
  --category-bg: rgba(139, 124, 246, 0.15);
  --category-border: rgba(139, 124, 246, 0.26);
  --category-orb: rgba(139, 124, 246, 0.34);
  --category-shadow: rgba(87, 70, 188, 0.14);
  border-radius: 28px 18px 24px 18px;
}

.settings-category-card.is-island {
  --category-bg: rgba(67, 198, 232, 0.14);
  --category-border: rgba(67, 198, 232, 0.25);
  --category-orb: rgba(67, 198, 232, 0.35);
  --category-shadow: rgba(30, 132, 159, 0.14);
  border-radius: 18px 28px 18px 24px;
}

.settings-category-card.is-system {
  --category-bg: rgba(244, 178, 77, 0.14);
  --category-border: rgba(229, 154, 45, 0.24);
  --category-orb: rgba(244, 178, 77, 0.34);
  --category-shadow: rgba(156, 98, 18, 0.14);
  border-radius: 18px 24px 18px 28px;
}

.settings-category-card.is-codex {
  --category-bg: rgba(240, 113, 120, 0.13);
  --category-border: rgba(226, 94, 102, 0.24);
  --category-orb: rgba(240, 113, 120, 0.32);
  --category-shadow: rgba(159, 49, 56, 0.14);
  border-radius: 24px 18px 28px 18px;
}

.settings-category-card.is-claude {
  --category-bg: rgba(91, 179, 137, 0.13);
  --category-border: rgba(58, 155, 109, 0.25);
  --category-orb: rgba(91, 179, 137, 0.32);
  --category-shadow: rgba(34, 117, 78, 0.14);
  border-radius: 18px 24px 18px 24px;
}

.category-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.32);
  color: var(--heading-color);
}

.category-icon svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.category-copy {
  display: grid;
  align-content: center;
  gap: 3px;
  min-width: 0;
}

.category-copy strong {
  color: var(--heading-color);
  font-family: 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
  font-size: 15px;
  font-weight: 670;
}

.category-copy small {
  overflow: hidden;
  color: var(--item-desc-color);
  font-size: 10px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-footer {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--item-desc-color);
  font-size: 10px;
}

.category-footer svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  transition: transform var(--motion-standard);
}

.settings-category-card:hover .category-footer svg {
  transform: translateX(3px);
}

@media (prefers-reduced-motion: reduce) {
  .settings-category-card,
  .settings-back-button,
  .category-footer svg {
    transition-duration: 120ms;
  }

  .settings-category-card:hover,
  .settings-category-card:active,
  .settings-back-button:hover {
    transform: none;
  }
}
</style>
