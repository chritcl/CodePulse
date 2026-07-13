<template>
  <div class="lyrics-panel">
    <div class="current-lyric" :class="{ 'is-fallback': !hasCurrentLyric }">
      {{ expandedLyricText }}
    </div>
    <div v-if="lyricsStatus === 'ready' && nextLyricText" class="next-lyric">
      {{ nextLyricText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TrackLyricsStatus } from '@/composables/useTrackLyrics';

interface Props {
  lyricsStatus: TrackLyricsStatus;
  currentLyricText: string;
  nextLyricText: string;
  fallbackText: string;
}

const props = defineProps<Props>();

const hasCurrentLyric = computed(
  () => props.lyricsStatus === 'ready' && props.currentLyricText.trim().length > 0
);

const expandedLyricText = computed(() => {
  if (hasCurrentLyric.value) return props.currentLyricText;

  switch (props.lyricsStatus) {
    case 'ready':
      return '等待歌词开始…';
    case 'loading':
      return '正在加载歌词…';
    case 'not_found':
      return '未找到可同步歌词';
    case 'retrying':
      return '歌词服务重连中…';
    case 'error':
      return '歌词服务暂不可用';
    default:
      return props.fallbackText;
  }
});
</script>

<style scoped>
.lyrics-panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 2px 0;
}

.current-lyric {
  color: currentColor;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.current-lyric.is-fallback {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.82;
}

.next-lyric {
  color: currentColor;
  font-size: 10px;
  line-height: 1.2;
  opacity: 0.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
