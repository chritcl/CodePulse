<template>
  <div class="status-indicator">
    <!-- 音乐频谱 -->
    <div
      v-if="showMusicSpectrum"
      class="audio-spectrum"
      :class="{ 'is-playing': isPlaying, expanded: isMusicExpanded }"
    >
      <span class="bar" />
      <span class="bar" />
      <span class="bar" />
      <span class="bar" />
      <span class="bar" />
    </div>

    <!-- 网络状态灯 -->
    <div v-else :class="['status-dot', networkStatus]" />
  </div>
</template>

<script setup lang="ts">
interface Props {
  showMusicSpectrum: boolean;
  isPlaying: boolean;
  isMusicExpanded: boolean;
  networkStatus: 'good' | 'warning' | 'error';
}

defineProps<Props>();
</script>

<style scoped>
.status-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: background-color 0.3s ease;
}

.status-dot.good {
  background-color: #34c759;
}

.status-dot.warning {
  background-color: #ffcc00;
}

.status-dot.error {
  background-color: #ff3b30;
}

.audio-spectrum {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 16px;
}

.audio-spectrum .bar {
  width: 3px;
  height: 4px;
  background: currentColor;
  border-radius: 1px;
  transition: height 0.1s ease;
  opacity: 0.5;
}

.audio-spectrum.is-playing .bar {
  animation: spectrum 0.8s ease-in-out infinite alternate;
  opacity: 1;
}

.audio-spectrum.is-playing .bar:nth-child(1) {
  animation-delay: 0s;
}

.audio-spectrum.is-playing .bar:nth-child(2) {
  animation-delay: 0.1s;
}

.audio-spectrum.is-playing .bar:nth-child(3) {
  animation-delay: 0.2s;
}

.audio-spectrum.is-playing .bar:nth-child(4) {
  animation-delay: 0.3s;
}

.audio-spectrum.is-playing .bar:nth-child(5) {
  animation-delay: 0.4s;
}

.audio-spectrum.expanded {
  display: none;
}

@keyframes spectrum {
  0% {
    height: 4px;
  }
  100% {
    height: 16px;
  }
}
</style>
