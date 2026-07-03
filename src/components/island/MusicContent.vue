<template>
  <div
    class="music-ctl-box"
    :class="{ expanded: isMusicExpanded }"
    style="cursor: pointer"
    @click="$emit('expand-music', $event)"
  >
    <div class="music-top-row">
      <div class="album-cover" :class="{ 'is-playing': isPlaying }">
        <div
          class="cover-inner"
          :style="
            coverUrl
              ? { backgroundImage: `url(${coverUrl})`, backgroundSize: 'cover' }
              : {}
          "
        />
      </div>
      <div class="music-info-mask-box">
        <div class="music-info-text single-line" :class="{ 'fade-out': isMusicExpanded }">
          {{ currentTrackInfo }}
        </div>
        <div class="music-info-text double-line" :class="{ 'fade-in': isMusicExpanded }">
          <div class="song-title">
            {{ currentSongName }}
          </div>
          <div class="song-artist">
            {{ currentArtistName }}
          </div>
        </div>
      </div>
    </div>
    <transition name="fade">
      <div v-show="isMusicExpanded" class="music-controls">
        <button class="ctl-btn" @click.stop="$emit('prev-track')">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>
        <button class="ctl-btn play-btn" @click.stop="$emit('toggle-play')">
          <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" style="transform: translateX(1px)">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button class="ctl-btn" @click.stop="$emit('next-track')">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
interface Props {
  isPlaying: boolean;
  coverUrl: string;
  currentTrackInfo: string;
  currentSongName: string;
  currentArtistName: string;
  isMusicExpanded: boolean;
}

defineProps<Props>();

defineEmits<{
  'expand-music': [event: MouseEvent];
  'toggle-play': [];
  'prev-track': [];
  'next-track': [];
}>();
</script>

<style scoped>
.music-ctl-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
}

.music-top-row {
  display: flex;
  align-items: center;
  gap: 10px;
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

.cover-inner {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  background-size: cover;
}

.music-info-mask-box {
  flex: 1;
  overflow: hidden;
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
}

.music-info-text.double-line {
  display: none;
  font-size: 11px;
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

.ctl-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: currentColor;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
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
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
