<template>
  <transition :css="false" @enter="enterTransition" @leave="leaveTransition">
    <div v-show="visible" :class="['island-container', { 'has-music-border': showGlow }]" :style="containerStyle"
      @mousedown="$emit('shell-mousedown', $event)" @mousemove="$emit('shell-mousemove', $event)"
      @mouseup="$emit('shell-mouseup')" @mouseleave="$emit('shell-mouseleave')" @mouseenter="$emit('shell-mouseenter')"
      @contextmenu="$emit('shell-contextmenu', $event)">
      <div v-if="showGlow" class="rainbow-border-glow" :style="{ opacity: glowOpacity }" />

      <div class="island-core-content" :style="coreStyle">
        <div class="inner-wrapper">
          <slot />
        </div>

        <IslandStatusIndicator :show-music-spectrum="showMusicSpectrum" :is-playing="isPlaying"
          :is-music-expanded="isMusicExpanded" :network-status="networkStatus" :spectrum-data="spectrumData" />
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue';
import IslandStatusIndicator from './IslandStatusIndicator.vue';

interface Props {
  visible: boolean;
  containerStyle: CSSProperties;
  coreStyle: CSSProperties;
  showGlow: boolean;
  glowOpacity: number;
  showMusicSpectrum: boolean;
  isPlaying: boolean;
  isMusicExpanded: boolean;
  networkStatus: 'good' | 'warning' | 'error';
  spectrumData: number[];
  enterTransition: (el: Element, done: () => void) => void;
  leaveTransition: (el: Element, done: () => void) => void;
}

defineProps<Props>();

defineEmits<{
  'shell-mousedown': [event: MouseEvent];
  'shell-mousemove': [event: MouseEvent];
  'shell-mouseup': [];
  'shell-mouseleave': [];
  'shell-mouseenter': [];
  'shell-contextmenu': [event: MouseEvent];
}>();
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
  border-radius: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  user-select: none;
  -webkit-user-select: none;
  overflow: hidden;
  background: transparent;
  transition: background 0.4s ease;
  box-sizing: border-box;
  transform: translateZ(0);
  will-change: width, height, border-radius;
  contain: strict;
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

.inner-wrapper {
  flex: 1;
  overflow: hidden;
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
