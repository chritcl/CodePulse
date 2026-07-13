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
}

const props = defineProps<Props>();

defineEmits<{
  'expand-music': [event: MouseEvent];
  'toggle-play': [];
  'prev-track': [];
  'next-track': [];
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

<style scoped>
.music-ctl-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
  width: 100%;
  cursor: pointer;
}

.music-top-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.music-ctl-box.expanded {
  gap: 6px;
}

.music-ctl-box.expanded .music-top-row {
  gap: 8px;
}

.album-cover {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
}

.album-cover.is-playing {
  animation: rotate 8s linear infinite;
}

.music-ctl-box.expanded .album-cover {
  width: 30px;
  height: 30px;
}

.cover-inner {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  background-size: cover;
}

.music-info-mask-box {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  mask-image: linear-gradient(to right, #000000 78%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, #000000 78%, transparent 100%);
}

.music-info-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.3s ease;
}

.music-info-text.single-line {
  font-size: 12px;
  font-weight: 500;
  color: currentColor;
  overflow: visible;
  text-overflow: clip;
}

.scroll-inner {
  display: inline-block;
  width: max-content;
  white-space: nowrap;
  backface-visibility: hidden;
  transform: translateZ(0);
}

.scroll-inner.is-scrolling {
  animation: scroll-ping-pong var(--scroll-duration) linear infinite alternate;
}

.music-info-text.double-line {
  display: none;
}

.music-info-text.double-line .song-title {
  font-weight: 600;
  font-size: 12px;
}

.music-info-text.double-line .song-artist {
  opacity: 0.6;
  font-size: 10px;
  margin-top: 2px;
}

.music-ctl-box.expanded .music-info-text.single-line {
  display: none;
}

.music-ctl-box.expanded .music-info-text.double-line {
  display: block;
}

.music-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 4px 0;
}

.music-ctl-box.expanded .music-controls {
  padding: 0;
}

.ctl-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: currentColor;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.2s ease;
  padding: 0;
}

.ctl-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.ctl-btn svg {
  width: 14px;
  height: 14px;
}

.ctl-btn.play-btn {
  width: 32px;
  height: 32px;
}

.ctl-btn.play-btn svg {
  width: 16px;
  height: 16px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}

@keyframes scroll-ping-pong {
  0%,
  20% {
    transform: translateX(0);
  }

  80%,
  100% {
    transform: translateX(calc(-1 * var(--scroll-dist)));
  }
}
</style>
