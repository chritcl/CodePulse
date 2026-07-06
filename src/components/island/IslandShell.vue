<template>
  <transition :css="false" @enter="enterTransition" @leave="leaveTransition">
    <div
      v-show="visible"
      ref="containerRef"
      :class="[
        'island-container',
        {
          'has-music-border': showGlow,
          'is-expanded': expanded,
          'is-pinned': isPinned,
        },
      ]"
      :style="containerStyle"
      @mousedown="$emit('shell-mousedown', $event)"
      @mousemove="$emit('shell-mousemove', $event)"
      @mouseup="$emit('shell-mouseup')"
      @mouseleave="$emit('shell-mouseleave')"
      @mouseenter="$emit('shell-mouseenter')"
      @contextmenu="$emit('shell-contextmenu', $event)"
    >
      <div class="island-stack">
        <div class="multi-island-layout">
          <slot name="satellites" />

          <div ref="mainFrameRef" class="main-island-frame">
            <div v-if="showGlow" class="rainbow-border-glow" :style="{ opacity: glowOpacity }" />

            <div
              ref="mainCoreRef"
              class="island-core-content"
              :style="coreStyle"
              @click="$emit('main-click', $event)"
            >
              <div class="inner-wrapper">
                <slot />
              </div>

              <IslandStatusIndicator
                :show-music-spectrum="showMusicSpectrum"
                :is-playing="isPlaying"
                :is-music-expanded="isMusicExpanded"
                :network-status="networkStatus"
                :spectrum-data="spectrumData"
              />
            </div>
          </div>
        </div>

        <transition :css="false" @enter="detailEnterTransition" @leave="detailLeaveTransition">
          <div v-if="expanded" class="expanded-detail-panel" :style="detailStyle">
            <slot name="detail" />
          </div>
        </transition>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, type CSSProperties } from 'vue';
import IslandStatusIndicator from './IslandStatusIndicator.vue';

interface Props {
  visible: boolean;
  containerStyle: CSSProperties;
  coreStyle: CSSProperties;
  detailStyle: CSSProperties;
  expanded: boolean;
  isPinned: boolean;
  showGlow: boolean;
  glowOpacity: number;
  showMusicSpectrum: boolean;
  isPlaying: boolean;
  isMusicExpanded: boolean;
  networkStatus: 'good' | 'warning' | 'error';
  spectrumData: number[];
  enterTransition: (el: Element, done: () => void) => void;
  leaveTransition: (el: Element, done: () => void) => void;
  detailEnterTransition: (el: Element, done: () => void) => void;
  detailLeaveTransition: (el: Element, done: () => void) => void;
}

defineProps<Props>();

defineEmits<{
  'shell-mousedown': [event: MouseEvent];
  'shell-mousemove': [event: MouseEvent];
  'shell-mouseup': [];
  'shell-mouseleave': [];
  'shell-mouseenter': [];
  'shell-contextmenu': [event: MouseEvent];
  'main-click': [event: MouseEvent];
}>();

const containerRef = ref<HTMLElement | null>(null);
const mainFrameRef = ref<HTMLElement | null>(null);
const mainCoreRef = ref<HTMLElement | null>(null);

const getMainElement = () => mainFrameRef.value;
const getMainRect = () => mainFrameRef.value?.getBoundingClientRect() ?? null;
const getSatelliteElement = (kind: string) =>
  containerRef.value?.querySelector<HTMLElement>(`[data-satellite-kind="${kind}"]`) ?? null;
const getSatelliteRect = (kind: string) =>
  getSatelliteElement(kind)?.getBoundingClientRect() ?? null;

defineExpose({
  getMainElement,
  getMainRect,
  getSatelliteElement,
  getSatelliteRect,
  mainCoreRef,
});
</script>

<style scoped>
*,
*::before,
*::after {
  box-sizing: border-box;
  border: none !important;
  outline: none !important;
}

:root {
  -webkit-app-region: drag;
}

:global(html),
:global(body) {
  background-color: transparent !important;
  background: transparent !important;
  overflow: hidden;
  margin: 0;
  padding: 0;
  border: none !important;
}

.island-container {
  margin: 0 auto;
  border-radius: 0;
  display: flex;
  align-items: stretch;
  justify-content: flex-start;
  padding: 0;
  user-select: none;
  -webkit-user-select: none;
  overflow: visible;
  background: transparent;
  transition: background 0.4s ease;
  box-sizing: border-box;
  transform: translateZ(0);
  will-change: transform;
  contain: layout style;
}

.island-stack {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: visible;
  background: transparent;
}

.island-container.is-pinned .island-stack {
  justify-content: flex-end;
}

.island-container:not(.is-pinned) .island-stack {
  justify-content: flex-start;
}

.rainbow-border-glow {
  position: absolute;
  width: 500px;
  height: 500px;
  top: calc(50% - 250px);
  left: calc(50% - 250px);
  z-index: 1;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Cdefs%3E%3Cfilter id='b' x='-50%25' y='-50%25' width='200%25' height='200%25'%3E%3CfeGaussianBlur in='SourceGraphic' stdDeviation='60'/%3E%3C/filter%3E%3C/defs%3E%3Cg filter='url(%23b)'%3E%3Ccircle cx='250' cy='90' r='150' fill='%23ff3b30'/%3E%3Ccircle cx='390' cy='170' r='150' fill='%23ff9500'/%3E%3Ccircle cx='390' cy='330' r='150' fill='%234cd964'/%3E%3Ccircle cx='250' cy='410' r='150' fill='%23007aff'/%3E%3Ccircle cx='110' cy='330' r='150' fill='%235856d6'/%3E%3Ccircle cx='110' cy='170' r='150' fill='%23ff2d55'/%3E%3C/g%3E%3C/svg%3E");
  background-size: cover;
  animation: rainbow-rotate 10s linear infinite;
  will-change: transform;
}

.multi-island-layout {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0;
  flex-shrink: 0;
  overflow: visible;
  background: transparent;
}

.main-island-frame {
  position: relative;
  width: 260px;
  height: 42px;
  border-radius: 100px;
  overflow: hidden;
  padding: 2px;
  flex: 0 0 260px;
  will-change: transform;
}

.island-core-content {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  border-radius: 98px;
  transform: translateZ(0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  overflow: hidden;
}

.expanded-detail-panel {
  order: 2;
  width: 100%;
  height: 86px;
  border-radius: 14px;
  padding: 12px 14px;
  color: #ffffff;
  overflow: hidden;
  flex-shrink: 0;
  will-change: transform, opacity;
}

.island-container.is-pinned .expanded-detail-panel {
  order: -1;
}

.inner-wrapper {
  flex: 1;
  overflow: hidden;
  position: relative;
  z-index: 2;
}

:deep(.status-indicator) {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
}

@keyframes rainbow-rotate {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

[data-tauri-drag-region] {
  -webkit-app-region: drag;
  cursor: grab;
}

[data-tauri-drag-region]:active {
  cursor: grabbing;
}
</style>
