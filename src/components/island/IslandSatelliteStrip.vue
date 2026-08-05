<template>
  <div
    v-if="items.length || overflowCount > 0"
    class="satellite-strip"
    :class="surfaceClass"
    aria-label="活跃模块"
  >
    <button
      v-for="item in items"
      :key="item.kind"
      type="button"
      class="satellite-button"
      :class="statusClass(item.status)"
      :data-satellite-kind="item.kind"
      :title="item.label"
      @click.stop="$emit('select', item.kind, $event)"
    >
      <span class="satellite-visual" data-flip-visual>
        <img v-if="item.iconUrl" :src="item.iconUrl" :alt="item.label" class="satellite-img" />
        <CodexGlyph v-else-if="item.kind === 'codex'" :size="16" />
        <ClaudeGlyph v-else-if="item.kind === 'claude'" :size="16" />
        <span v-else class="satellite-symbol">{{ getSymbol(item.kind) }}</span>
      </span>
      <span v-if="item.unreadCount > 0" class="satellite-badge">
        {{ formatUnread(item.unreadCount) }}
      </span>
    </button>

    <button
      v-if="overflowCount > 0"
      type="button"
      class="satellite-more"
      title="更多活跃模块"
      aria-label="更多活跃模块"
    >
      +{{ overflowCount }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  IslandDisplayKind,
  IslandModuleVisualStatus,
  IslandSatelliteItem,
} from '@/modules/island/display';
import CodexGlyph from './codex/CodexGlyph.vue';
import ClaudeGlyph from './claude/ClaudeGlyph.vue';

interface Props {
  items: IslandSatelliteItem[];
  overflowCount: number;
  /** 岛屿主题，决定卫星条背景使用偏黑灰还是偏白灰 */
  theme?: 'black' | 'white';
}

const props = withDefaults(defineProps<Props>(), {
  theme: 'black',
});

defineEmits<{
  select: [kind: IslandDisplayKind, event: MouseEvent];
}>();

const SYMBOLS: Record<IslandDisplayKind, string> = {
  codex: '',
  claude: '',
  wechat: '微',
  notification: '铃',
  'system-toast': '提',
  hardware: '芯',
  music: '♪',
  network: '网',
  update: '新',
};

const statusClass = (status: IslandModuleVisualStatus) => ({
  'is-info': status === 'info',
  'is-running': status === 'running',
  'is-success': status === 'success',
  'is-warning': status === 'warning',
  'is-error': status === 'error',
  'is-unread': status === 'unread',
  'is-paused': status === 'paused',
});

/** 卫星条表面明暗：黑岛配偏黑的灰，白岛配偏白的灰 */
const surfaceClass = computed(() => (props.theme === 'white' ? 'is-light' : 'is-dark'));

const getSymbol = (kind: IslandDisplayKind) => SYMBOLS[kind];

const formatUnread = (count: number) => (count > 99 ? '99+' : String(count));
</script>

<style scoped>
.satellite-strip {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border-radius: 100px;
  /* 黑岛主题：偏黑的灰色实底，避免毛玻璃导致不清晰 */
  background: rgba(40, 40, 44, 0.94);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  flex-shrink: 0;
}

/* 白岛主题：偏白的灰色实底 */
.satellite-strip.is-light {
  background: rgba(238, 238, 242, 0.94);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.satellite-button,
.satellite-more {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  padding: 0;
  color: currentColor;
  background: rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease,
    opacity 0.16s ease;
}

.satellite-button:hover,
.satellite-more:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.2);
}

/* 白岛主题下按钮改用深色半透明，保证在浅灰底上可见 */
.satellite-strip.is-light .satellite-button,
.satellite-strip.is-light .satellite-more {
  background: rgba(0, 0, 0, 0.06);
}

.satellite-strip.is-light .satellite-button:hover,
.satellite-strip.is-light .satellite-more:hover {
  background: rgba(0, 0, 0, 0.12);
}

.satellite-visual {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
}

.satellite-symbol {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.satellite-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.satellite-badge {
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 999px;
  position: absolute;
  top: -3px;
  right: -4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ff3b30;
  color: #ffffff;
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
}

.satellite-more {
  width: 30px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  opacity: 0.9;
}

.satellite-button.is-info {
  box-shadow: inset 0 0 0 1px rgba(0, 122, 255, 0.55);
}

.satellite-button.is-running {
  color: #9c9aff;
  box-shadow: inset 0 0 0 1px rgba(88, 86, 214, 0.65);
  animation: satellite-breathe 1.8s ease-in-out infinite;
}

.satellite-button.is-success {
  color: #65df82;
  box-shadow: inset 0 0 0 1px rgba(52, 199, 89, 0.65);
}

.satellite-button.is-warning {
  color: #ffd84a;
  box-shadow: inset 0 0 0 1px rgba(255, 204, 0, 0.75);
}

.satellite-button.is-error {
  color: #ff7770;
  box-shadow:
    inset 0 0 0 1px rgba(255, 59, 48, 0.85),
    0 0 10px rgba(255, 59, 48, 0.28);
}

.satellite-button.is-unread {
  box-shadow: inset 0 0 0 1px rgba(255, 59, 48, 0.55);
}

.satellite-button.is-paused {
  opacity: 0.55;
}

@media (prefers-reduced-motion: reduce) {
  .satellite-button,
  .satellite-more {
    transition: none;
  }

  .satellite-button.is-running {
    animation: none;
  }
}

@keyframes satellite-breathe {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.08);
  }
}
</style>
