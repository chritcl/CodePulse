<template>
  <div class="system-toast-box">
    <div class="toast-icon" :class="iconClass">
      <svg v-if="type === 'lock'" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="4" y="12" width="16" height="8" rx="2" ry="2" stroke-width="2" />
        <path d="M8 12V9a4 4 0 0 1 8 0v3" stroke-width="2" />
      </svg>
      <svg v-else-if="type === 'unlock'" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="4" y="12" width="16" height="8" rx="2" ry="2" stroke-width="2" />
        <path d="M8 12V9a4 4 0 0 1 8 0" stroke-width="2" />
      </svg>
      <svg v-else-if="type === 'battery-charge'" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="2" y="7" width="16" height="10" rx="2" ry="2" stroke-width="2" />
        <line x1="22" y1="11" x2="22" y2="13" stroke-width="2" />
        <polygon points="11 7 8 12 12 12 11 17 14 12 10 12 11 7" stroke-width="1.5" />
      </svg>
      <svg v-else-if="type === 'battery-low'" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="2" y="7" width="16" height="10" rx="2" ry="2" stroke-width="2" />
        <line x1="22" y1="11" x2="22" y2="13" stroke-width="2" />
        <line x1="6" y1="12" x2="9" y2="12" stroke-width="4" stroke-linecap="round" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" stroke-width="2" opacity="0.3" />
        <path v-if="type === 'app'" d="M8 12.5l3 3 5-6" stroke-width="2.5" stroke-linecap="round"
          stroke-linejoin="round" />
        <path v-else d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke-width="1.8" stroke-linecap="round"
          stroke-linejoin="round" transform="translate(3 2) scale(.75)" />
      </svg>
    </div>
    <div class="toast-text">
      {{ text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SystemToastType } from '@/shared/ipc/contracts';

interface Props {
  text: string;
  type: SystemToastType;
}

const props = defineProps<Props>();

const iconClass = computed(() => ({
  'app-icon': props.type === 'app',
  'sys-icon': props.type === 'sys' || props.type === 'lock' || props.type === 'unlock',
  'battery-charge-icon': props.type === 'battery-charge',
  'battery-low-icon': props.type === 'battery-low',
}));
</script>

<style scoped>
.system-toast-box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  max-width: 260px;
}

.toast-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.toast-icon svg {
  width: 22px;
  height: 22px;
  display: block;
}

.app-icon,
.sys-icon {
  color: currentColor;
}

.sys-icon {
  opacity: 0.85;
}

.battery-charge-icon {
  color: #34c759;
}

.battery-low-icon {
  color: #ff3b30;
}

.toast-text {
  font-size: 12px;
  font-weight: 600;
  color: currentColor;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
