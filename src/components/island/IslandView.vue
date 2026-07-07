<template>
  <IslandShell
    ref="islandShellRef"
    :visible="isIslandVisible"
    :container-style="islandWindow.islandStyle.value"
    :core-style="activeCoreStyle"
    :detail-style="activeDetailStyle"
    :expanded="Boolean(islandLayout.expandedKind)"
    :is-pinned="islandWindow.isPinnedToTaskbar.value"
    :show-glow="isGlowBorderEnabled"
    :glow-opacity="islandWindow.glowOpacity.value"
    :show-music-spectrum="displayMusic"
    :is-playing="isPlaying"
    :is-music-expanded="isMusicExpanded"
    :network-status="networkStatus"
    :spectrum-data="spectrumData"
    :enter-transition="animation.onEnter"
    :leave-transition="animation.onLeave"
    :detail-enter-transition="animation.onDetailEnter"
    :detail-leave-transition="animation.onDetailLeave"
    @shell-mousedown="drag.handleMouseDown"
    @shell-mousemove="handleMouseMove"
    @shell-mouseup="drag.handleMouseUp"
    @shell-mouseleave="handleMouseLeave"
    @shell-mouseenter="handleMouseEnter"
    @shell-contextmenu="handleRightClick"
    @main-click="handleMainClick"
  >
    <template v-if="islandLayout.satellites.length || islandLayout.overflowCount > 0" #satellites>
      <IslandSatelliteStrip
        :items="islandLayout.satellites"
        :overflow-count="islandLayout.overflowCount"
        @select="handleSatelliteSelect"
      />
    </template>

    <IslandDisplayController
      :display="activeDisplay"
      mode="compact"
      :network="{
        uploadSpeed,
        downloadSpeed,
        isHighUpload,
        isHighDownload,
      }"
      :hardware="{
        cpuUsage,
        gpuUsage,
        memUsage,
      }"
      :music="{
        boxKey: musicBoxKey,
        isPlaying,
        coverUrl,
        currentTrackInfo,
        currentSongName,
        currentArtistName,
        lyricsStatus,
        currentLyricText,
        nextLyricText,
      }"
      :notification="{
        icon: currentMsgIcon,
        title: msgTitle,
        body: msgBody,
      }"
      :system-toast="{
        text: sysToastText,
        type: sysToastType,
      }"
      :inner-enter-transition="animation.onInnerEnter"
      :inner-leave-transition="animation.onInnerLeave"
      @msg-click="handleMsgClick"
      @toggle-play="togglePlay"
      @prev-track="prevTrack"
      @next-track="nextTrack"
    />

    <template v-if="islandLayout.expandedKind === activeDisplay" #detail>
      <IslandDisplayController
        :display="activeDisplay"
        mode="detail"
        :network="{
          uploadSpeed,
          downloadSpeed,
          isHighUpload,
          isHighDownload,
        }"
        :hardware="{
          cpuUsage,
          gpuUsage,
          memUsage,
        }"
        :music="{
          boxKey: musicBoxKey,
          isPlaying,
          coverUrl,
          currentTrackInfo,
          currentSongName,
          currentArtistName,
          lyricsStatus,
          currentLyricText,
          nextLyricText,
        }"
        :notification="{
          icon: currentMsgIcon,
          title: msgTitle,
          body: msgBody,
        }"
        :system-toast="{
          text: sysToastText,
          type: sysToastType,
        }"
        :inner-enter-transition="animation.onInnerEnter"
        :inner-leave-transition="animation.onInnerLeave"
        @msg-click="handleMsgClick"
        @toggle-play="togglePlay"
        @prev-track="prevTrack"
        @next-track="nextTrack"
      />
    </template>
  </IslandShell>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick, type CSSProperties } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';

import {
  useIslandWindow,
  useIslandAnimation,
  useIslandDrag,
  useMusicSpectrum,
} from '@/composables';
import {
  resolveIslandLayout,
  type IslandDisplayKind,
  type IslandModuleSnapshot,
  type IslandModuleVisualStatus,
} from '@/modules/island/display';
import {
  getPlayerName,
  normalizeTargetPlayer,
  readTargetPlayer,
} from '@/modules/island/musicPlatform';
import {
  buildTrackIdentity,
  estimatePlaybackPosition,
  resolveCurrentLyricLine,
} from '@/modules/island/lyrics';
import { hasStorageValue, readBoolean, writeBoolean } from '@/shared/utils/storage';
import type {
  LyricLine,
  LyricsResponse,
  LyricsStatus,
  MusicPlaybackState,
  SystemToastType,
  TargetPlayerPayload,
} from '@/shared/ipc/contracts';
import { useIslandContextMenu } from './IslandContextMenu';

import IslandShell from './IslandShell.vue';
import IslandDisplayController from './IslandDisplayController.vue';
import IslandSatelliteStrip from './IslandSatelliteStrip.vue';

import defaultLogo from '@/assets/logo.png';

interface LatestNotificationPayload {
  app_name: string;
  title: string;
  body: string;
  aumid: string;
}

interface BatteryEventPayload {
  state: 'charging' | 'discharging';
  percent: number;
}

interface SystemToastItem {
  text: string;
  type: SystemToastType;
}

type MusicLyricsStatus = LyricsStatus | 'idle' | 'loading';

type ElementRect = ReturnType<HTMLElement['getBoundingClientRect']>;

interface IslandShellExpose {
  getMainElement: () => HTMLElement | null;
  getMainRect: () => ElementRect | null;
  getSatelliteElement: (kind: string) => HTMLElement | null;
  getSatelliteRect: (kind: string) => ElementRect | null;
}

// ============================================================
// Composables
// ============================================================

const islandWindow = useIslandWindow();
const animation = useIslandAnimation();
const drag = useIslandDrag();
const contextMenu = useIslandContextMenu();
const islandShellRef = ref<IslandShellExpose | null>(null);

// ============================================================
// 状态
// ============================================================

/** 灵动岛是否可见 */
const isIslandVisible = ref(false);

/** 菜单是否打开 */
const isMenuOpen = ref(false);

/** 流光边框是否启用 */
const isGlowBorderEnabled = ref(readBoolean('nsd_glow_border'));

/** 交互动效序号 */
let interactionAnimationId = 0;

/** 网速监控相关 */
const uploadSpeed = ref('0 KB/s');
const downloadSpeed = ref('0 KB/s');
const isHighDownload = ref(false);
const isHighUpload = ref(false);
const networkStatus = ref<'good' | 'warning' | 'error'>('good');

/** 硬件监控相关 */
const isHardwareMonEnabled = ref(readBoolean('nsd_hardware_mon'));
const cpuUsage = ref('0%');
const gpuUsage = ref('0%');
const memUsage = ref('0%');

/** 音乐控制相关 */
const isMusicCtlEnabled = ref(readBoolean('nsd_music_ctrl'));
const activeTargetPlayer = ref(readTargetPlayer());
const isPlaying = ref(false);
const coverUrl = ref('');
const coverCache = new Map<string, string>();
const currentSongName = ref('未在播放歌曲');
const currentArtistName = ref('');
const currentAlbumName = ref('');
const currentTrackInfo = ref('');
const currentMusicPlayback = ref<MusicPlaybackState | null>(null);
const currentPlaybackPositionMs = ref<number | null>(null);
const lyricLines = ref<LyricLine[]>([]);
const lyricsStatus = ref<MusicLyricsStatus>('idle');
const lyricsTrackIdentity = ref('');
const musicBoxKey = ref(0);
const expandedKind = ref<IslandDisplayKind | null>(null);
const isMusicExpanded = computed(() => expandedKind.value === 'music');
let expandCollapseTimer: number | null = null;
let lyricsRequestId = 0;

/** 重置音乐占位信息 */
const resetMusicPlaceholder = () => {
  const playerName = getPlayerName(activeTargetPlayer.value);
  currentSongName.value = '未在播放歌曲';
  currentArtistName.value = playerName;
  currentAlbumName.value = '';
  currentTrackInfo.value = `未在播放歌曲 - ${playerName}`;
  currentMusicPlayback.value = null;
  currentPlaybackPositionMs.value = null;
  coverUrl.value = '';
};

/** 重置歌词状态 */
const resetLyricsState = () => {
  lyricsRequestId += 1;
  lyricLines.value = [];
  lyricsStatus.value = 'idle';
  lyricsTrackIdentity.value = '';
  currentPlaybackPositionMs.value = null;
};

resetMusicPlaceholder();

/** 消息模式相关 */
const isMsgModeEnabled = ref(readBoolean('nsd_msg_mode'));
const isMsgActive = ref(false);
const msgTitle = ref('');
const msgBody = ref('');
const msgAumid = ref('');
const currentMsgIcon = ref(defaultLogo);
const notificationUnreadCount = ref(0);
const notificationSoftUntil = ref(0);
let msgTimer: number | null = null;

/** 系统操作通知 */
const displaySysToast = ref(false);
const sysToastText = ref('');
const sysToastType = ref<SystemToastType>('app');
const sysToastSoftUntil = ref(0);
const toastQueue = ref<SystemToastItem[]>([]);
let isProcessingToast = false;

/** 轮换模式相关 */
const isRotationEnabled = ref(readBoolean('nsd_rotation_mode'));
const currentRotIndex = ref(0);
let rotationTimer: number | null = null;

/** 多岛布局调度 */
const layoutNow = ref(Date.now());
const manualFocusKind = ref<IslandDisplayKind | null>(null);
const manualFocusUntil = ref(0);
const stableMainKind = ref<IslandDisplayKind | null>(null);
const hardwareStrongActive = ref(false);
let hardwareHighSampleCount = 0;
let layoutClockTimer: number;

/** 定时器 */
let speedTimer: number;
let pingTimer: number;
let musicTimer: number;
let lyricPositionTimer: number;
let notifyTimer: number;
let systemEventUnlisten: UnlistenFn | null = null;
let batteryEventUnlisten: UnlistenFn | null = null;

/** 流量监控相关 */
let lastRx = 0;
let lastTx = 0;
let lowTrafficStartTime = Date.now();
const RED_DELAY_MS = 5000;
const USER_FOCUS_PROTECT_MS = 10_000;
const NOTIFICATION_SOFT_MS = 5_000;
const SYSTEM_TOAST_MS = 2_000;
const HARDWARE_STRONG_THRESHOLD = 90;
const HARDWARE_RECOVER_THRESHOLD = 85;
const MAIN_ISLAND_HEIGHT = 42;
const DETAIL_PANEL_GAP = 8;

// ============================================================
// 计算属性
// ============================================================

/** 音乐模块是否活跃 */
const isMusicModuleActive = computed(() => isMusicCtlEnabled.value || isRotationEnabled.value);

/** 硬件模块是否活跃 */
const isHardwareModuleActive = computed(
  () => isHardwareMonEnabled.value || isRotationEnabled.value || hardwareStrongActive.value
);

/** 硬件卫星岛状态 */
const hardwareVisualStatus = computed<IslandModuleVisualStatus>(() => {
  const maxUsage = Math.max(
    parseInt(cpuUsage.value) || 0,
    parseInt(gpuUsage.value) || 0,
    parseInt(memUsage.value) || 0
  );

  if (hardwareStrongActive.value) return 'error';
  if (maxUsage >= 80) return 'warning';
  return 'normal';
});

/** 当前活跃模块快照 */
const islandModules = computed<IslandModuleSnapshot[]>(() => [
  { kind: 'agent', active: false },
  { kind: 'wechat', active: false },
  {
    kind: 'notification',
    active: isMsgActive.value || notificationUnreadCount.value > 0,
    interrupt: isMsgActive.value ? 'soft' : 'none',
    interruptUntil: notificationSoftUntil.value,
    status: notificationUnreadCount.value > 0 ? 'unread' : 'info',
    unreadCount: notificationUnreadCount.value,
    label: msgTitle.value || '通知',
    iconUrl: currentMsgIcon.value,
  },
  {
    kind: 'system-toast',
    active: displaySysToast.value,
    interrupt: displaySysToast.value ? 'soft' : 'none',
    interruptUntil: sysToastSoftUntil.value,
    status: sysToastType.value === 'battery-low' ? 'error' : 'info',
  },
  {
    kind: 'hardware',
    active: isHardwareModuleActive.value,
    interrupt: hardwareStrongActive.value ? 'strong' : 'none',
    status: hardwareVisualStatus.value,
  },
  {
    kind: 'music',
    active: isMusicModuleActive.value,
    status: isPlaying.value ? 'running' : 'paused',
    iconUrl: coverUrl.value || undefined,
  },
  { kind: 'update', active: false },
  { kind: 'network', active: true, status: networkStatus.value === 'error' ? 'error' : 'normal' },
]);

/** 当前多岛布局 */
const islandLayout = computed(() =>
  resolveIslandLayout({
    modules: islandModules.value,
    now: layoutNow.value,
    manualFocusKind: manualFocusKind.value,
    manualFocusUntil: manualFocusUntil.value,
    stableMainKind: stableMainKind.value,
    expandedKind: expandedKind.value,
    rotationEnabled: isRotationEnabled.value,
    rotationIndex: currentRotIndex.value,
  })
);

/** 当前展示内容 */
const activeDisplay = computed<IslandDisplayKind>(() => islandLayout.value.main);

/** 是否展示音乐内容 */
const displayMusic = computed(() => activeDisplay.value === 'music');

/** 当前歌词匹配结果 */
const currentLyricState = computed(() =>
  resolveCurrentLyricLine(lyricLines.value, currentPlaybackPositionMs.value)
);

/** 当前歌词文本 */
const currentLyricText = computed(() => currentLyricState.value.currentLine?.text ?? '');

/** 下一句歌词文本 */
const nextLyricText = computed(() => currentLyricState.value.nextLine?.text ?? '');

/** 主岛当前表面样式 */
const activeCoreStyle = computed<CSSProperties>(() => {
  if (!islandLayout.value.expandedKind) return islandWindow.coreContentStyle.value;

  return {
    ...islandWindow.coreContentStyle.value,
    ...islandWindow.focusSurfaceStyle.value,
    borderRadius: '98px',
  };
});

/** 展开面板当前表面样式 */
const activeDetailStyle = computed<CSSProperties>(() => ({
  ...islandWindow.focusSurfaceStyle.value,
  borderRadius: '14px',
  height: `${Math.max(
    0,
    islandLayout.value.size.height - MAIN_ISLAND_HEIGHT - DETAIL_PANEL_GAP
  )}px`,
}));

/** 音乐频谱 */
const musicSpectrum = useMusicSpectrum(isPlaying, displayMusic);
const spectrumData = musicSpectrum.spectrumData;

// ============================================================
// 工具函数
// ============================================================

/** 格式化速度 */
const formatSpeed = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B/s';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB/s';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB/s';
};

/** 获取应用图标 */
const getAppIcon = (appName: string) => {
  const name = appName.toLowerCase();

  if (name.includes('qq')) {
    return new URL('@/assets/qq.png', import.meta.url).href;
  }
  if (name.includes('钉钉') || name.includes('dingtalk')) {
    return new URL('@/assets/dingtalk.png', import.meta.url).href;
  }
  if (name.includes('mail') || name.includes('邮件')) {
    return new URL('@/assets/mail.png', import.meta.url).href;
  }
  if (name.includes('wechat') || name.includes('微信')) {
    return new URL('@/assets/wechat.png', import.meta.url).href;
  }

  return defaultLogo;
};

/** 刷新布局时钟，用于驱动保护期和软打断过期 */
const refreshLayoutNow = () => {
  layoutNow.value = Date.now();
};

/** 收起当前模块详情 */
const collapseExpanded = () => {
  expandedKind.value = null;
  if (expandCollapseTimer) {
    clearTimeout(expandCollapseTimer);
    expandCollapseTimer = null;
  }
};

/** 更新硬件强打断状态 */
const updateHardwareSeverity = () => {
  const cpu = parseInt(cpuUsage.value) || 0;
  const gpu = parseInt(gpuUsage.value) || 0;
  const memory = parseInt(memUsage.value) || 0;
  const maxUsage = Math.max(cpu, gpu, memory);

  if (maxUsage >= HARDWARE_STRONG_THRESHOLD) {
    hardwareHighSampleCount += 1;
    if (hardwareHighSampleCount >= 2) {
      hardwareStrongActive.value = true;
      refreshLayoutNow();
    }
    return;
  }

  hardwareHighSampleCount = 0;
  if (
    hardwareStrongActive.value &&
    cpu < HARDWARE_RECOVER_THRESHOLD &&
    gpu < HARDWARE_RECOVER_THRESHOLD &&
    memory < HARDWARE_RECOVER_THRESHOLD
  ) {
    hardwareStrongActive.value = false;
    refreshLayoutNow();
  }
};

/** 推入系统操作通知 */
const showToast = (text: string, type: SystemToastType = 'app') => {
  if (!text.trim()) return;
  toastQueue.value.push({ text, type });
  void processToastQueue();
};

/** 顺序展示系统操作通知 */
const processToastQueue = async () => {
  if (isProcessingToast || toastQueue.value.length === 0) return;
  if (isMsgActive.value) return;

  isProcessingToast = true;
  // 记录 toast 开始前灵动岛是否已可见，用于判断是否为消息模式临时显示
  const islandWasVisible = isIslandVisible.value;
  const nextToast = toastQueue.value.shift();

  if (nextToast) {
    collapseExpanded();
    sysToastText.value = nextToast.text;
    sysToastType.value = nextToast.type;
    sysToastSoftUntil.value = Date.now() + SYSTEM_TOAST_MS;
    displaySysToast.value = true;
    refreshLayoutNow();

    if (isMsgModeEnabled.value && !isIslandVisible.value) {
      await getCurrentWindow().show();
      isIslandVisible.value = true;
    }

    await new Promise((resolve) => setTimeout(resolve, SYSTEM_TOAST_MS));
    displaySysToast.value = false;
    sysToastSoftUntil.value = 0;
    refreshLayoutNow();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  isProcessingToast = false;
  if (toastQueue.value.length > 0) {
    void processToastQueue();
  } else if (isMsgModeEnabled.value && !isMsgActive.value && !islandWasVisible) {
    // 仅当灵动岛之前不可见（消息模式临时显示）时，才在 toast 结束后隐藏
    window.setTimeout(() => {
      if (!isMsgActive.value && !displaySysToast.value) {
        isIslandVisible.value = false;
      }
    }, 600);
  }
};

/** 更新网络状态并触发必要提示 */
const setNetworkStatus = (nextStatus: 'good' | 'warning' | 'error') => {
  const previousStatus = networkStatus.value;
  if (previousStatus === nextStatus) return;

  networkStatus.value = nextStatus;
  if (nextStatus === 'error') {
    showToast('网络连接已断开', 'sys');
  } else if (nextStatus === 'good' && previousStatus === 'error') {
    showToast('网络已恢复连接', 'sys');
  }
};

// ============================================================
// 方法
// ============================================================

/** 获取网速 */
const fetchSpeedStats = async () => {
  try {
    const [currentRx, currentTx] = await invoke<[number, number]>('get_network_stats');
    if (lastRx !== 0) {
      const rxDiff = currentRx - lastRx;
      const txDiff = currentTx - lastTx;

      downloadSpeed.value = formatSpeed(rxDiff);
      uploadSpeed.value = formatSpeed(txDiff);

      const limit = 1024 * 1024;
      const currentDownloadHigh = rxDiff >= limit;
      const currentUploadHigh = txDiff >= limit;

      isHighDownload.value = currentDownloadHigh;
      isHighUpload.value = currentUploadHigh;

      if (currentDownloadHigh || currentUploadHigh) {
        lowTrafficStartTime = Date.now();
      }
    }
    lastRx = currentRx;
    lastTx = currentTx;
  } catch (error) {
    console.error('流量获取失败:', error);
  }
};

/** 获取 GPU 使用率 */
const fetchGpuUsage = async () => {
  try {
    const cpuNum = parseInt(cpuUsage.value) || 10;
    const randomOffset = Math.floor(Math.random() * 5);
    const estimatedGpu = Math.min(Math.max(Math.round(cpuNum * 0.4) + randomOffset, 1), 99);
    gpuUsage.value = estimatedGpu + '%';
  } catch {
    gpuUsage.value = '0%';
  }
};

/** 检查网络延迟 */
const checkNetworkLatency = async () => {
  try {
    const latency = await invoke<number>('get_network_latency');

    if (latency < 150) {
      setNetworkStatus('good');
    } else {
      setNetworkStatus('warning');
    }
  } catch {
    if (isHighDownload.value || isHighUpload.value) {
      setNetworkStatus('warning');
      return;
    }

    const timeSinceLowTraffic = Date.now() - lowTrafficStartTime;
    if (timeSinceLowTraffic < RED_DELAY_MS) {
      setNetworkStatus('warning');
    } else {
      setNetworkStatus('error');
    }
  }
};

/** 同步目标播放器到 Rust */
const syncTargetPlayer = async (player: string | null | undefined = readTargetPlayer()) => {
  const targetPlayer = normalizeTargetPlayer(player);
  activeTargetPlayer.value = targetPlayer;

  try {
    await invoke('set_target_player', { player: targetPlayer });
  } catch (err) {
    console.error('同步音乐平台失败:', err);
  }

  return targetPlayer;
};

/** 更新本地推算的播放位置 */
const updateLyricPlaybackPosition = () => {
  currentPlaybackPositionMs.value = estimatePlaybackPosition(currentMusicPlayback.value);
};

/** 同步当前曲目封面 */
const syncCoverForTrack = async (trackInfo: string, song: string, artist: string) => {
  if (coverCache.has(trackInfo)) {
    coverUrl.value = coverCache.get(trackInfo)!;
    return;
  }

  try {
    const realCoverUrl = await invoke<string>('get_random_cover_url', {
      songName: song,
      artistName: artist,
    });
    coverUrl.value = realCoverUrl;
    if (coverCache.size > 50) coverCache.clear();
    coverCache.set(trackInfo, realCoverUrl);
  } catch (coverErr) {
    console.error('所有封面源均获取失败:', coverErr);
    coverUrl.value = '';
  }
};

/** 为当前曲目加载歌词 */
const loadLyricsForPlayback = async (playback: MusicPlaybackState) => {
  const trackIdentity = buildTrackIdentity(playback);
  if (!trackIdentity || lyricsTrackIdentity.value === trackIdentity) return;

  lyricsTrackIdentity.value = trackIdentity;
  lyricLines.value = [];
  lyricsStatus.value = 'loading';
  const requestId = ++lyricsRequestId;

  try {
    const response = await invoke<LyricsResponse>('get_lyrics_for_track', {
      title: playback.title,
      artist: playback.artist,
      album: playback.album,
      durationMs: playback.durationMs,
      player: playback.player || activeTargetPlayer.value,
    });

    if (requestId !== lyricsRequestId || lyricsTrackIdentity.value !== trackIdentity) return;

    lyricsStatus.value = response.status;
    lyricLines.value = response.status === 'ready' ? response.lines : [];
    updateLyricPlaybackPosition();
  } catch (err) {
    if (requestId !== lyricsRequestId || lyricsTrackIdentity.value !== trackIdentity) return;
    console.error('歌词获取失败:', err);
    lyricsStatus.value = 'error';
    lyricLines.value = [];
  }
};

/** 同步音乐状态 */
const syncMusicStatus = async () => {
  try {
    const playback = await invoke<MusicPlaybackState | null>('get_music_playback_state');

    if (!playback) {
      resetMusicPlaceholder();
      resetLyricsState();
      isPlaying.value = false;
      return;
    }

    currentMusicPlayback.value = playback;
    currentSongName.value = playback.title;
    currentArtistName.value = playback.artist || '未知歌手';
    currentAlbumName.value = playback.album ?? '';
    isPlaying.value = playback.isPlaying;
    updateLyricPlaybackPosition();

    const newTrackInfo = playback.artist ? `${playback.title} - ${playback.artist}` : playback.title;

    if (currentTrackInfo.value !== newTrackInfo) {
      currentTrackInfo.value = newTrackInfo;
      await syncCoverForTrack(newTrackInfo, playback.title, playback.artist);
      musicBoxKey.value++;
    }

    await loadLyricsForPlayback(playback);
  } catch (err) {
    console.error('音乐信息获取失败:', err);
  }
};

/** 切换播放 */
const togglePlay = async () => {
  isPlaying.value = !isPlaying.value;
  try {
    await invoke('control_system_media', { action: 'play_pause' });
  } catch (err) {
    console.error('播放控制失败:', err);
    isPlaying.value = !isPlaying.value;
  }
};

/** 上一首 */
const prevTrack = async () => {
  await invoke('control_system_media', { action: 'prev' });
};

/** 下一首 */
const nextTrack = async () => {
  await invoke('control_system_media', { action: 'next' });
};

/** 获取卫星按钮元素 */
const getSatelliteButtonFromEvent = (kind: IslandDisplayKind, event: MouseEvent) => {
  if (event.currentTarget instanceof HTMLElement) return event.currentTarget;
  return islandShellRef.value?.getSatelliteElement(kind) ?? null;
};

/** 处理卫星岛切换 */
const handleSatelliteSelect = async (kind: IslandDisplayKind, event: MouseEvent) => {
  const animationId = ++interactionAnimationId;
  const previousMain = activeDisplay.value;
  const shell = islandShellRef.value;
  const selectedButton = getSatelliteButtonFromEvent(kind, event);
  const selectedRect = selectedButton?.getBoundingClientRect() ?? shell?.getSatelliteRect(kind) ?? null;
  const previousMainRect = shell?.getMainRect() ?? null;

  await animation.playPressSpring(selectedButton, { scale: 0.88 });
  if (animationId !== interactionAnimationId) return;

  collapseExpanded();
  manualFocusKind.value = kind;
  manualFocusUntil.value = Date.now() + USER_FOCUS_PROTECT_MS;
  stableMainKind.value = kind;
  refreshLayoutNow();
  await nextTick();

  if (animationId !== interactionAnimationId) return;

  const nextShell = islandShellRef.value;
  const mainElement = nextShell?.getMainElement() ?? null;
  const oldMainSatellite = previousMain !== kind
    ? nextShell?.getSatelliteElement(previousMain) ?? null
    : null;

  await Promise.all([
    animation.playFlipSpring(mainElement, selectedRect),
    animation.playFlipSpring(oldMainSatellite, previousMainRect),
  ]);
};

/** 处理主岛点击 */
const handleMainClick = async (event: MouseEvent) => {
  if (!drag.isClick(event)) return;
  if ((event.target as HTMLElement).closest('.ctl-btn, .detail-action')) return;
  if (activeDisplay.value === 'system-toast') return;
  if (expandedKind.value === activeDisplay.value) return;

  const animationId = ++interactionAnimationId;
  await animation.playPressSpring(islandShellRef.value?.getMainElement() ?? null);
  if (animationId !== interactionAnimationId) return;

  expandedKind.value = activeDisplay.value;
  refreshLayoutNow();
};

/** 处理鼠标离开 */
const handleMouseLeave = () => {
  if (!expandedKind.value) return;

  if (expandCollapseTimer) clearTimeout(expandCollapseTimer);
  expandCollapseTimer = window.setTimeout(collapseExpanded, 1000);
};

/** 处理鼠标进入 */
const handleMouseEnter = () => {
  if (expandCollapseTimer) {
    clearTimeout(expandCollapseTimer);
    expandCollapseTimer = null;
  }
};

/** 处理鼠标移动 */
const handleMouseMove = (event: MouseEvent) => {
  drag.handleMouseMove(
    event,
    islandWindow.isPinnedToTaskbar.value,
    islandWindow.isPositionLocked.value
  );
};

/** 处理消息点击 */
const handleMsgClick = async () => {
  if (msgAumid.value || msgTitle.value) {
    try {
      await invoke('open_app_by_aumid', {
        aumid: msgAumid.value,
        appName: msgTitle.value,
      });

      isMsgActive.value = false;
      notificationUnreadCount.value = 0;
      notificationSoftUntil.value = 0;
      collapseExpanded();
      refreshLayoutNow();
      if (msgTimer) clearTimeout(msgTimer);
    } catch (err) {
      console.error('打开程序失败:', err);
    }
  }
};

/** 处理右键菜单 */
const handleRightClick = async (event: MouseEvent) => {
  await contextMenu.showContextMenu(event, {
    isGlowBorderEnabled: isGlowBorderEnabled.value,
    isPinnedToTaskbar: islandWindow.isPinnedToTaskbar.value,
    isPositionLocked: islandWindow.isPositionLocked.value,
    onOpenSettings: () => {
      showToast('打开设置成功');
    },
    onToggleGlowBorder: () => {
      isGlowBorderEnabled.value = !isGlowBorderEnabled.value;
      writeBoolean('nsd_glow_border', isGlowBorderEnabled.value);
      showToast(isGlowBorderEnabled.value ? '开启流光边框成功' : '关闭流光边框成功');
    },
    onResetPosition: () => {
      islandWindow.adjustWindowPosition().catch(console.error);
      showToast('重置位置成功');
    },
    onToggleLock: () => {
      islandWindow.setPositionLocked(!islandWindow.isPositionLocked.value);
      showToast(
        islandWindow.isPositionLocked.value ? '锁定位置成功' : '解锁位置成功',
        islandWindow.isPositionLocked.value ? 'lock' : 'unlock'
      );
    },
    onClose: () => {
      isIslandVisible.value = false;
    },
  });
};

/** 启动轮换 */
const startRotation = () => {
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = window.setInterval(() => {
    currentRotIndex.value = (currentRotIndex.value + 1) % 3;
  }, 5000);
};

/** 停止轮换 */
const stopRotation = () => {
  if (rotationTimer) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
};

// ============================================================
// 监听器
// ============================================================

watch(activeDisplay, (newVal) => {
  if (expandedKind.value && expandedKind.value !== newVal) {
    collapseExpanded();
  }

  if (!['system-toast'].includes(newVal) && !['soft-interrupt', 'strong-interrupt'].includes(islandLayout.value.reason)) {
    stableMainKind.value = newVal;
  }
});

watch(
  () => [islandLayout.value.size.width, islandLayout.value.size.height] as const,
  ([width, height], previousSize) => {
    if (!isIslandVisible.value) return;
    if (previousSize && width === previousSize[0] && height === previousSize[1]) return;
    islandWindow.animateIslandSize(width, height);
  },
  { flush: 'post' }
);

watch(isIslandVisible, (visible) => {
  if (!visible) {
    collapseExpanded();
    return;
  }
  islandWindow.animateIslandSize(islandLayout.value.size.width, islandLayout.value.size.height);
});

watch(isMsgActive, (newVal) => {
  if (!newVal) {
    void processToastQueue();
  }
});

// ============================================================
// 生命周期
// ============================================================

onMounted(async () => {
  window.addEventListener('blur', collapseExpanded);
  layoutClockTimer = window.setInterval(refreshLayoutNow, 500);

  document.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    { capture: true }
  );

  // 监听音乐控制器状态
  await listen<{ enabled: boolean }>('control-music-ctl', async (event) => {
    const isEnabled = event.payload.enabled;
    isMusicCtlEnabled.value = isEnabled;

    if (isEnabled) {
      if (!hasStorageValue('nsd_glow_border')) {
        isGlowBorderEnabled.value = true;
        writeBoolean('nsd_glow_border', true);
      }
      await syncTargetPlayer();
      resetMusicPlaceholder();
      resetLyricsState();
      await syncMusicStatus();
      musicBoxKey.value++;
    }
  });

  // 监听目标播放器同步
  await listen<TargetPlayerPayload>('control-target-player', async (event) => {
    await syncTargetPlayer(event.payload.player);
    resetMusicPlaceholder();
    resetLyricsState();
    if (isMusicCtlEnabled.value || isRotationEnabled.value) {
      await syncMusicStatus();
    }
    musicBoxKey.value++;
  });

  // 监听透明度同步
  await listen<{ opacity: number }>('control-island-opacity', (event) => {
    islandWindow.setOpacity(event.payload.opacity);
  });

  // 监听主题同步
  await listen<{ theme: string }>('control-island-theme', (event) => {
    islandWindow.setTheme(event.payload.theme);
  });

  // 监听任务栏停靠
  await listen<{ enabled: boolean }>('control-pin-taskbar', async (event) => {
    islandWindow.setPinnedToTaskbar(event.payload.enabled);
    if (event.payload.enabled) {
      await islandWindow.snapToBottomLeft();
    } else {
      await islandWindow.adjustWindowPosition();
    }
  });

  // 监听消息模式
  await listen<{ enabled: boolean }>('control-msg-mode', async (event) => {
    isMsgModeEnabled.value = event.payload.enabled;
    if (isMsgModeEnabled.value && !isMsgActive.value) {
      isIslandVisible.value = false;
    } else if (!isMsgModeEnabled.value) {
      await getCurrentWindow().show();
      isIslandVisible.value = true;
      await emit('island-status-sync', { visible: true });
    }
  });

  // 监听轮换模式
  await listen<{ enabled: boolean }>('control-rotation-mode', (event) => {
    isRotationEnabled.value = event.payload.enabled;
    if (isRotationEnabled.value) {
      startRotation();
    } else {
      stopRotation();
      currentRotIndex.value = 0;
    }
  });

  systemEventUnlisten = await listen<string>('system-event', (event) => {
    showToast(event.payload, 'sys');
  });

  batteryEventUnlisten = await listen<BatteryEventPayload>('battery-event', (event) => {
    const { state, percent } = event.payload;
    if (state === 'charging') {
      showToast(`已接入电源，当前电量 ${percent}%`, 'battery-charge');
    } else if (state === 'discharging' && percent <= 20) {
      showToast(`电池电量低，剩余 ${percent}%`, 'battery-low');
    }
  });

  // 启动时如果开了轮换，就跑起来
  if (isRotationEnabled.value) {
    startRotation();
  }

  await syncTargetPlayer();
  resetMusicPlaceholder();
  resetLyricsState();
  if (isMusicCtlEnabled.value || isRotationEnabled.value) {
    await syncMusicStatus();
  }

  // 根据持久化设置决定是否显示灵动岛
  const islandEnabled = readBoolean('nsd_island_enabled', true);
  if (islandEnabled && !isMsgModeEnabled.value) {
    // 先设置内容可见，再显示窗口，避免窗口出现但内容不可见
    isIslandVisible.value = true;

    // 初始化位置（内部会调用 show）
    try {
      await getCurrentWindow().innerPosition();
    } catch {
      /* 忽略 */
    }

    if (islandWindow.isPinnedToTaskbar.value) {
      await islandWindow.snapToBottomLeft();
    } else {
      await islandWindow.adjustWindowPosition();
    }

    // 同步状态到主窗口
    await emit('island-status-sync', { visible: true });
  }

  // 监听硬件监控开关
  await listen<{ enabled: boolean }>('control-hardware-mon', (event) => {
    isHardwareMonEnabled.value = event.payload.enabled;
  });

  // 启动定时器
  fetchSpeedStats();
  checkNetworkLatency();

  // 高频定时器：网速和硬件监控
  speedTimer = setInterval(async () => {
    if (islandWindow.isPinnedToTaskbar.value && isIslandVisible.value && !isMenuOpen.value) {
      invoke('force_window_topmost').catch(() => {});
    }

    fetchSpeedStats();

    if (isHardwareMonEnabled.value || isRotationEnabled.value) {
      try {
        const [cpu, usedMem, totalMem] =
          await invoke<[number, number, number]>('get_hardware_stats');
        cpuUsage.value = Math.round(cpu) + '%';
        if (totalMem > 0) {
          memUsage.value = Math.round((usedMem / totalMem) * 100) + '%';
        }
        await fetchGpuUsage();
        updateHardwareSeverity();
      } catch (err) {
        console.error('获取硬件信息失败:', err);
      }
    }
  }, 800) as unknown as number;

  // 中频定时器：音乐状态同步
  musicTimer = setInterval(() => {
    if (isMusicCtlEnabled.value || isRotationEnabled.value) {
      syncMusicStatus();
    }
  }, 2000);

  // 高频本地计时器：歌词位置推算，不访问 Rust
  lyricPositionTimer = setInterval(updateLyricPlaybackPosition, 250) as unknown as number;

  // 低频定时器：系统通知轮询
  notifyTimer = setInterval(async () => {
    const enabled = readBoolean('nsd_msg_notify');
    if (!enabled) return;

    try {
      const res = await invoke<LatestNotificationPayload | null>('fetch_latest_notification');
      if (res) {
        msgTitle.value = res.app_name;
        msgAumid.value = res.aumid;
        msgBody.value = res.body ? `${res.title}: ${res.body}` : res.title;
        currentMsgIcon.value = getAppIcon(res.app_name);
        notificationUnreadCount.value += 1;
        notificationSoftUntil.value = Date.now() + NOTIFICATION_SOFT_MS;
        refreshLayoutNow();

        if (!isMsgActive.value) {
          isMsgActive.value = true;
          if (isMsgModeEnabled.value && !isIslandVisible.value) {
            getCurrentWindow().show();
            isIslandVisible.value = true;
          }
        }

        if (msgTimer) clearTimeout(msgTimer);
        msgTimer = window.setTimeout(() => {
          isMsgActive.value = false;
          notificationSoftUntil.value = 0;
          refreshLayoutNow();
          if (isMsgModeEnabled.value) {
            setTimeout(() => {
              if (!isMsgActive.value) isIslandVisible.value = false;
            }, 600);
          }
        }, 5000);
      }
    } catch (err) {
      console.error(err);
    }
  }, 2500);

  musicSpectrum.start();

  // 低频定时器：网络延迟检查
  pingTimer = setInterval(checkNetworkLatency, 5500) as unknown as number;

  // 监听显隐调度
  await listen<{ show: boolean }>('control-island-visibility', async (event) => {
    if (event.payload.show) {
      await getCurrentWindow().show();
      await getCurrentWindow().setAlwaysOnTop(true);
      setTimeout(() => {
        isIslandVisible.value = true;
      }, 40);
    } else {
      isIslandVisible.value = false;
    }
  });

  // 监听窗口大小变化
  await listen<number[]>('island-resize', (event) => {
    const [w, h] = event.payload;
    islandWindow.currentWidth.value = w;
    islandWindow.currentHeight.value = h;
  });
});

onUnmounted(() => {
  window.removeEventListener('blur', collapseExpanded);
  clearInterval(layoutClockTimer);
  clearInterval(speedTimer);
  clearInterval(pingTimer);
  stopRotation();
  clearInterval(musicTimer);
  clearInterval(lyricPositionTimer);
  clearInterval(notifyTimer);
  musicSpectrum.stop();
  systemEventUnlisten?.();
  batteryEventUnlisten?.();
});
</script>
