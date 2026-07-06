<template>
  <transition
    mode="out-in"
    :css="false"
    @enter="innerEnterTransition"
    @leave="innerLeaveTransition"
  >
    <NotificationContent
      v-if="display === 'notification'"
      key="notification"
      :msg-icon="notification.icon"
      :msg-title="notification.title"
      :msg-body="notification.body"
      @msg-click="$emit('msg-click')"
    />

    <SystemToastContent
      v-else-if="display === 'system-toast'"
      key="system-toast"
      :text="systemToast.text"
      :type="systemToast.type"
    />

    <HardwareContent
      v-else-if="display === 'hardware'"
      key="hardware"
      :cpu-usage="hardware.cpuUsage"
      :gpu-usage="hardware.gpuUsage"
      :mem-usage="hardware.memUsage"
    />

    <MusicContent
      v-else-if="display === 'music'"
      :key="'music_' + music.boxKey"
      :is-playing="music.isPlaying"
      :cover-url="music.coverUrl"
      :current-track-info="music.currentTrackInfo"
      :current-song-name="music.currentSongName"
      :current-artist-name="music.currentArtistName"
      :is-music-expanded="music.isExpanded"
      @expand-music="$emit('expand-music', $event)"
      @toggle-play="$emit('toggle-play')"
      @prev-track="$emit('prev-track')"
      @next-track="$emit('next-track')"
    />

    <SpeedContent
      v-else
      key="network"
      :upload-speed="network.uploadSpeed"
      :download-speed="network.downloadSpeed"
      :is-high-upload="network.isHighUpload"
      :is-high-download="network.isHighDownload"
    />
  </transition>
</template>

<script setup lang="ts">
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
  isExpanded: boolean;
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
  network: NetworkDisplayState;
  hardware: HardwareDisplayState;
  music: MusicDisplayState;
  notification: NotificationDisplayState;
  systemToast: SystemToastDisplayState;
  innerEnterTransition: (el: Element, done: () => void) => void;
  innerLeaveTransition: (el: Element, done: () => void) => void;
}

defineProps<Props>();

defineEmits<{
  'msg-click': [];
  'expand-music': [event: MouseEvent];
  'toggle-play': [];
  'prev-track': [];
  'next-track': [];
}>();
</script>
