<template>
  <div v-if="mode !== 'none'" class="status-indicator">
    <!-- 音乐频谱 -->
    <div
      v-if="mode === 'music'"
      class="audio-spectrum"
      :class="{ 'is-playing': isPlaying, expanded: isMusicExpanded }"
    >
      <span
        v-for="(scale, index) in barScales"
        :key="index"
        class="bar"
        :style="{ transform: `scaleY(${scale})` }"
      />
    </div>

    <!-- 网络状态灯 -->
    <div v-else :class="['status-dot', networkStatus]" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const MIN_SPECTRUM = [0.35, 0.35, 0.35, 0.35, 0.35];

interface Props {
  mode: 'music' | 'network' | 'none';
  isPlaying: boolean;
  isMusicExpanded: boolean;
  networkStatus: 'good' | 'warning' | 'error';
  spectrumData: number[];
}

const props = defineProps<Props>();

const barScales = computed(() => {
  if (props.mode !== 'music' || !props.isPlaying) return MIN_SPECTRUM;
  return props.spectrumData.length === 5 ? props.spectrumData : MIN_SPECTRUM;
});
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
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 16px;
  padding-right: 2px;
}

.audio-spectrum .bar {
  width: 2px;
  height: 18px;
  background: #b6e0ee;
  border-radius: 3px;
  transform-origin: center;
  transition: transform 0.08s ease-out;
  will-change: transform;
  opacity: 0.75;
}

.audio-spectrum.is-playing .bar {
  opacity: 1;
}

.audio-spectrum.expanded {
  transform: scale(1.2);
}
</style>
