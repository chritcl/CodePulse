<template>
  <transition
    mode="out-in"
    :css="false"
    @enter="innerEnterTransition"
    @leave="innerLeaveTransition"
  >
    <div :key="displayKey" class="display-frame" :class="{ 'is-detail': isDetail }">
      <template v-if="display === 'notification'">
        <div v-if="isDetail" class="detail-panel notification-detail">
          <div class="detail-heading">
            <img :src="notification.icon" alt="通知图标" class="detail-icon" />
            <div class="detail-title-group">
              <span class="detail-title">{{ notification.title }}</span>
              <span class="detail-subtitle">{{ notification.body || '暂无通知内容' }}</span>
            </div>
          </div>
          <button type="button" class="detail-action" @click.stop="$emit('msg-click')">
            打开应用
          </button>
        </div>

        <NotificationContent
          v-else
          :msg-icon="notification.icon"
          :msg-title="notification.title"
          :msg-body="notification.body"
        />
      </template>

      <SystemToastContent
        v-else-if="display === 'system-toast'"
        :text="systemToast.text"
        :type="systemToast.type"
      />

      <template v-else-if="display === 'hardware'">
        <div v-if="isDetail" class="detail-panel hardware-detail">
          <HardwareContent
            :cpu-usage="hardware.cpuUsage"
            :gpu-usage="hardware.gpuUsage"
            :mem-usage="hardware.memUsage"
          />
          <div class="detail-meta">硬件监控</div>
        </div>

        <HardwareContent
          v-else
          :cpu-usage="hardware.cpuUsage"
          :gpu-usage="hardware.gpuUsage"
          :mem-usage="hardware.memUsage"
        />
      </template>

      <MusicContent
        v-else-if="display === 'music'"
        :is-playing="music.isPlaying"
        :cover-url="music.coverUrl"
        :current-track-info="music.currentTrackInfo"
        :current-song-name="music.currentSongName"
        :current-artist-name="music.currentArtistName"
        :lyrics-status="music.lyricsStatus"
        :current-lyric-text="music.currentLyricText"
        :next-lyric-text="music.nextLyricText"
        :is-music-expanded="isDetail"
        @toggle-play="$emit('toggle-play')"
        @prev-track="$emit('prev-track')"
        @next-track="$emit('next-track')"
      />

      <template v-else-if="display === 'agent'">
        <div v-if="isDetail" class="detail-panel placeholder-detail">
          <div class="placeholder-title">Agent 状态</div>
          <div class="placeholder-subtitle">Agent 详情能力待接入</div>
        </div>
        <div v-else class="compact-placeholder">Agent 正在待接入</div>
      </template>

      <template v-else-if="display === 'wechat'">
        <div v-if="isDetail" class="detail-panel placeholder-detail">
          <div class="placeholder-title">微信消息</div>
          <div class="placeholder-subtitle">微信详情能力待接入</div>
        </div>
        <div v-else class="compact-placeholder">微信消息待接入</div>
      </template>

      <template v-else-if="display === 'update'">
        <div v-if="isDetail" class="detail-panel placeholder-detail">
          <div class="placeholder-title">版本更新</div>
          <div class="placeholder-subtitle">更新详情能力待接入</div>
        </div>
        <div v-else class="compact-placeholder">发现新版本</div>
      </template>

      <template v-else>
        <div v-if="isDetail" class="detail-panel network-detail">
          <SpeedContent
            :upload-speed="network.uploadSpeed"
            :download-speed="network.downloadSpeed"
            :is-high-upload="network.isHighUpload"
            :is-high-download="network.isHighDownload"
          />
          <div class="detail-meta">实时网络状态</div>
        </div>

        <SpeedContent
          v-else
          :upload-speed="network.uploadSpeed"
          :download-speed="network.downloadSpeed"
          :is-high-upload="network.isHighUpload"
          :is-high-download="network.isHighDownload"
        />
      </template>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TrackLyricsStatus } from '@/composables/useTrackLyrics';
import type { IslandDisplayKind } from '@/modules/island/display';
import SpeedContent from './SpeedContent.vue';
import MusicContent from './MusicContent.vue';
import HardwareContent from './HardwareContent.vue';
import NotificationContent from './NotificationContent.vue';
import SystemToastContent from './SystemToastContent.vue';
import type { SystemToastType } from '@/shared/ipc/contracts';

interface NetworkDisplayState {
  uploadSpeed: string;
  downloadSpeed: string;
  isHighUpload: boolean;
  isHighDownload: boolean;
}

interface HardwareDisplayState {
  cpuUsage: string;
  gpuUsage: string;
  memUsage: string;
}

interface MusicDisplayState {
  boxKey: number;
  isPlaying: boolean;
  coverUrl: string;
  currentTrackInfo: string;
  currentSongName: string;
  currentArtistName: string;
  lyricsStatus: TrackLyricsStatus;
  currentLyricText: string;
  nextLyricText: string;
}

interface NotificationDisplayState {
  icon: string;
  title: string;
  body: string;
}

interface SystemToastDisplayState {
  text: string;
  type: SystemToastType;
}

interface Props {
  display: IslandDisplayKind;
  mode: 'compact' | 'detail';
  network: NetworkDisplayState;
  hardware: HardwareDisplayState;
  music: MusicDisplayState;
  notification: NotificationDisplayState;
  systemToast: SystemToastDisplayState;
  innerEnterTransition: (el: Element, done: () => void) => void;
  innerLeaveTransition: (el: Element, done: () => void) => void;
}

const props = defineProps<Props>();

defineEmits<{
  'msg-click': [];
  'toggle-play': [];
  'prev-track': [];
  'next-track': [];
}>();

const isDetail = computed(() => props.mode === 'detail');
const displayKey = computed(() => `${props.display}_${props.mode}_${props.music.boxKey}`);
</script>

<style scoped>
.display-frame {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
}

.display-frame.is-detail {
  height: 100%;
}

.detail-panel {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  color: currentColor;
}

.detail-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.detail-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  flex-shrink: 0;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.1);
}

.detail-title-group {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.detail-title,
.placeholder-title {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-subtitle,
.placeholder-subtitle,
.detail-meta {
  font-size: 10px;
  opacity: 0.65;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-action {
  align-self: flex-start;
  height: 24px;
  border-radius: 999px;
  border: none;
  padding: 0 12px;
  color: currentColor;
  background: rgba(255, 255, 255, 0.12);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.detail-action:hover {
  background: rgba(255, 255, 255, 0.2);
}

.hardware-detail,
.network-detail {
  align-items: flex-start;
}

.placeholder-detail {
  gap: 4px;
}

.compact-placeholder {
  min-width: 0;
  color: currentColor;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
