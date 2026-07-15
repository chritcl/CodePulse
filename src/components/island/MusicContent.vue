<template>
  <div
    class="music-ctl-box"
    :class="{ expanded: isMusicExpanded }"
    @click="$emit('expand-music', $event)"
  >
    <div class="music-top-row">
      <div class="album-cover" :class="{ 'is-playing': isPlaying }">
        <div
          class="cover-inner"
          :style="coverUrl ? { backgroundImage: `url(${coverUrl})`, backgroundSize: 'cover' } : {}"
        />
      </div>
      <div ref="maskBoxRef" class="music-info-mask-box">
        <div class="music-info-text single-line" :class="{ 'fade-out': isMusicExpanded }">
          <span
            ref="textInnerRef"
            class="scroll-inner"
            :class="{ 'is-scrolling': scrollDist > 0 && !isMusicExpanded }"
            :style="
              scrollDist > 0
                ? { '--scroll-dist': `${scrollDist}px`, '--scroll-duration': scrollDuration }
                : {}
            "
          >
            {{ compactDisplayText }}
          </span>
        </div>
        <div class="music-info-text double-line">
          <div class="song-title">{{ currentSongName }}</div>
          <div class="song-artist">{{ currentArtistName }}</div>
        </div>
      </div>
    </div>
    <transition name="fade">
      <MusicLyricsPanel
        v-show="isMusicExpanded"
        v-bind="{ lyricsStatus, currentLyricText, nextLyricText }"
        :fallback-text="currentTrackInfo"
      />
    </transition>
    <transition name="fade">
      <MusicProgressControl
        v-if="isMusicExpanded && musicProgressVisible"
        :position-ms="positionMs"
        :duration-ms="durationMs"
        :is-pending="isSeekPending"
        :failure-id="seekFailureId"
        @seek-to="$emit('seek-to', $event)"
      />
    </transition>
    <transition name="fade">
      <div v-show="isMusicExpanded" class="music-controls">
        <button class="ctl-btn" aria-label="上一首" @click.stop="$emit('prev-track')">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>
        <button class="ctl-btn play-btn" aria-label="播放或暂停" @click.stop="$emit('toggle-play')">
          <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" style="transform: translateX(1px)">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button class="ctl-btn" aria-label="下一首" @click.stop="$emit('next-track')">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { TrackLyricsStatus } from '@/composables/useTrackLyrics';
import MusicLyricsPanel from './MusicLyricsPanel.vue';
import MusicProgressControl from './MusicProgressControl.vue';

interface Props {
  isPlaying: boolean;
  coverUrl: string;
  currentTrackInfo: string;
  currentSongName: string;
  currentArtistName: string;
  lyricsStatus: TrackLyricsStatus;
  currentLyricText: string;
  nextLyricText: string;
  isMusicExpanded: boolean;
  musicProgressVisible: boolean;
  positionMs: number | null;
  durationMs?: number;
  isSeekPending: boolean;
  seekFailureId: number;
}

const props = defineProps<Props>();

defineEmits<{
  'expand-music': [event: MouseEvent];
  'toggle-play': [];
  'prev-track': [];
  'next-track': [];
  'seek-to': [positionMs: number];
}>();

const maskBoxRef = ref<HTMLElement | null>(null);
const textInnerRef = ref<HTMLElement | null>(null);
const scrollDist = ref(0);
const scrollDuration = ref('8s');
const hasCurrentLyric = computed(
  () => props.lyricsStatus === 'ready' && !!props.currentLyricText.trim()
);
const compactDisplayText = computed(() =>
  hasCurrentLyric.value ? props.currentLyricText : props.currentTrackInfo
);

const calculateScroll = () => {
  const maskBox = maskBoxRef.value;
  const textInner = textInnerRef.value;
  if (!maskBox || !textInner) return;

  const overflowDistance = textInner.scrollWidth - maskBox.clientWidth;
  scrollDist.value = overflowDistance > 8 ? Math.ceil(overflowDistance + 12) : 0;
  scrollDuration.value = scrollDist.value
    ? `${Math.max(6, scrollDist.value / 18).toFixed(1)}s`
    : '8s';
};

watch([compactDisplayText, () => props.isMusicExpanded], () => nextTick(calculateScroll));
onMounted(() => nextTick(calculateScroll));
</script>

<style scoped src="./MusicContent.css"></style>
