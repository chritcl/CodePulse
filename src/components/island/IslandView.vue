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
        progressVisible: musicProgressVisible,
        positionMs: playbackPositionMs,
        durationMs: musicDurationMs,
        seekPending: isMusicSeekPending,
        seekFailureId: musicSeekFailureId,
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
      @seek-to="seekMusic"
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
          progressVisible: musicProgressVisible,
          positionMs: playbackPositionMs,
          durationMs: musicDurationMs,
          seekPending: isMusicSeekPending,
          seekFailureId: musicSeekFailureId,
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
        @seek-to="seekMusic"
      />
    </template>
  </IslandShell>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick, type CSSProperties } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';

import {
  useIslandWindow,
  useIslandAnimation,
  useIslandDrag,
  useMusicSpectrum,
  useMusicPlaybackSession,
  usePlaybackTimeline,
  useTrackCover,
  useTrackLyrics,
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
import { buildPlaybackSessionIdentity } from '@/modules/island/lyrics';
import { isPlaybackProgressAvailable } from '@/modules/island/playbackTimeline';
import {
  createMusicPresentationIdentityTracker,
  initializeMusicActivity,
  resolveMusicStartupState,
  syncMusicActivity,
} from '@/modules/island/musicActivity';
import { hasStorageValue, readBoolean, writeBoolean } from '@/shared/utils/storage';
import { createEventListenerRegistry } from '@/shared/utils/eventListenerRegistry';
import type { SystemToastType, TargetPlayerPayload } from '@/shared/ipc/contracts';
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

type ElementRect = ReturnType<HTMLElement['getBoundingClientRect']>;

interface IslandShellExpose {
  getMainElement: () => HTMLElement | null;
  getMainRect: () => ElementRect | null;
  getSatelliteElement: (kind: string) => HTMLElement | null;
  getSatelliteRect: (kind: string) => ElementRect | null;
}

// ============================================================
// 组合式函数
// ============================================================

const islandWindow = useIslandWindow();
const animation = useIslandAnimation();
const drag = useIslandDrag();
const contextMenu = useIslandContextMenu();
const islandShellRef = ref<IslandShellExpose | null>(null);
const playbackTimeline = usePlaybackTimeline();
const musicSession = useMusicPlaybackSession({ timeline: playbackTimeline });
const trackLyrics = useTrackLyrics({ positionMs: playbackTimeline.positionMs });
const trackCover = useTrackCover();
const eventListeners = createEventListenerRegistry();
const musicPresentationIdentity = createMusicPresentationIdentityTracker();

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
let hasReceivedMusicCtlEvent = false;
let hasReceivedTargetPlayerEvent = false;
const isPlaying = computed(() => musicSession.playback.value?.isPlaying ?? false);
const coverUrl = trackCover.coverUrl;
const currentSongName = computed(() => musicSession.playback.value?.title || '未在播放歌曲');
const currentArtistName = computed(() => {
  const playback = musicSession.playback.value;
  if (!playback) return getPlayerName(activeTargetPlayer.value);
  return playback.artist.trim() || '未知歌手';
});
const currentTrackInfo = computed(() => `${currentSongName.value} - ${currentArtistName.value}`);
const lyricsStatus = trackLyrics.status;
const currentLyricText = trackLyrics.currentLyricText;
const nextLyricText = trackLyrics.nextLyricText;
const playbackPositionMs = playbackTimeline.positionMs;
const musicDurationMs = computed(() => musicSession.playback.value?.durationMs);
const isMusicSeekPending = ref(false);
const musicSeekFailureId = ref(0);
const musicProgressVisible = computed(() =>
  isPlaybackProgressAvailable(
    musicSession.playback.value,
    playbackPositionMs.value,
    musicSession.status.value === 'ready'
  )
);
const musicBoxKey = ref(0);
const expandedKind = ref<IslandDisplayKind | null>(null);
const isMusicExpanded = computed(() => expandedKind.value === 'music');
let expandCollapseTimer: number | null = null;

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
let hasReceivedRotationEvent = false;

/** 多岛布局调度 */
const layoutNow = ref(Date.now());
const manualFocusKind = ref<IslandDisplayKind | null>(null);
const manualFocusUntil = ref(0);
const stableMainKind = ref<IslandDisplayKind | null>(null);
const hardwareStrongActive = ref(false);
let hardwareHighSampleCount = 0;
let layoutClockTimer: number | null = null;

/** 定时器 */
let speedTimer: number | null = null;
let pingTimer: number | null = null;
let notifyTimer: number | null = null;
let disposed = false;
let delayedVisibilityTimer: number | null = null;
let delayedMessageHideTimer: number | null = null;
let delayedToastHideTimer: number | null = null;
interface PendingDelay {
  timer: number;
  resolve: (active: boolean) => void;
}
const pendingDelays = new Set<PendingDelay>();

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
    musicProgressVisible: musicProgressVisible.value,
  })
);

/** 当前展示内容 */
const activeDisplay = computed<IslandDisplayKind>(() => islandLayout.value.main);

/** 是否展示音乐内容 */
const displayMusic = computed(() => activeDisplay.value === 'music');

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
  if (disposed || !text.trim()) return;
  toastQueue.value.push({ text, type });
  void processToastQueue();
};

/** 创建可在组件卸载时中止的延迟 */
const waitForLifecycleDelay = (delayMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (disposed) {
      resolve(false);
      return;
    }
    const pending: PendingDelay = {
      timer: 0,
      resolve,
    };
    pending.timer = window.setTimeout(() => {
      pendingDelays.delete(pending);
      resolve(!disposed);
    }, delayMs);
    pendingDelays.add(pending);
  });

/** 清理所有等待中的生命周期延迟 */
const clearLifecycleDelays = () => {
  for (const pending of pendingDelays) {
    window.clearTimeout(pending.timer);
    pending.resolve(false);
  }
  pendingDelays.clear();
};

/** 顺序展示系统操作通知 */
const processToastQueue = async () => {
  if (disposed || isProcessingToast || toastQueue.value.length === 0) return;
  if (isMsgActive.value) return;

  isProcessingToast = true;
  // 记录系统提示开始前灵动岛是否已可见，用于判断是否为消息模式临时显示
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
      if (disposed) return;
      isIslandVisible.value = true;
    }

    if (!(await waitForLifecycleDelay(SYSTEM_TOAST_MS))) return;
    displaySysToast.value = false;
    sysToastSoftUntil.value = 0;
    refreshLayoutNow();
    if (!(await waitForLifecycleDelay(200))) return;
  }

  isProcessingToast = false;
  if (toastQueue.value.length > 0) {
    void processToastQueue();
  } else if (isMsgModeEnabled.value && !isMsgActive.value && !islandWasVisible) {
    // 仅当灵动岛之前不可见（消息模式临时显示）时，才在系统提示结束后隐藏
    if (delayedToastHideTimer !== null) window.clearTimeout(delayedToastHideTimer);
    delayedToastHideTimer = window.setTimeout(() => {
      delayedToastHideTimer = null;
      if (disposed) return;
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
    if (disposed) return;
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
    if (!disposed) console.error('流量获取失败:', error);
  }
};

/** 获取图形处理器使用率 */
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
    if (disposed) return;

    if (latency < 150) {
      setNetworkStatus('good');
    } else {
      setNetworkStatus('warning');
    }
  } catch {
    if (disposed) return;
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

/** 重置音乐展示状态，保留歌词和封面缓存 */
const resetMusicPresentation = () => {
  trackLyrics.reset();
  trackCover.reset();
};

/** 按当前开关同步播放器会话的活动状态 */
const syncMusicModuleActivity = () =>
  syncMusicActivity(
    {
      musicEnabled: isMusicCtlEnabled.value,
      rotationEnabled: isRotationEnabled.value,
      targetPlayer: activeTargetPlayer.value,
    },
    {
      start: musicSession.start,
      stop: musicSession.stop,
      resetPresentation: resetMusicPresentation,
    }
  );

/** 切换目标播放器，并立即失效旧歌词与封面请求 */
const switchTargetPlayer = async (player: string | null | undefined) => {
  const targetPlayer = normalizeTargetPlayer(player);
  activeTargetPlayer.value = targetPlayer;
  resetMusicPresentation();
  try {
    await musicSession.setTargetPlayer(targetPlayer);
  } catch (error) {
    if (!disposed) console.error('同步音乐平台失败:', error);
  }
};

/** 执行媒体控制，不提前修改本地播放状态 */
const controlMusic = async (action: 'play_pause' | 'prev' | 'next') => {
  try {
    await musicSession.control(action);
  } catch (error) {
    if (!disposed) console.error('播放控制失败:', error);
  }
};

const togglePlay = () => controlMusic('play_pause');
const prevTrack = () => controlMusic('prev');
const nextTrack = () => controlMusic('next');

/** 跳转音乐播放位置 */
const seekMusic = async (positionMs: number) => {
  if (disposed || isMusicSeekPending.value || !musicProgressVisible.value) return;

  isMusicSeekPending.value = true;
  try {
    const succeeded = await musicSession.seek(positionMs);
    if (!disposed && !succeeded) musicSeekFailureId.value += 1;
  } catch (error) {
    if (!disposed) {
      musicSeekFailureId.value += 1;
      console.error('跳转播放位置失败:', error);
    }
  } finally {
    if (!disposed) isMusicSeekPending.value = false;
  }
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
  const selectedRect =
    selectedButton?.getBoundingClientRect() ?? shell?.getSatelliteRect(kind) ?? null;
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
  const oldMainSatellite =
    previousMain !== kind ? (nextShell?.getSatelliteElement(previousMain) ?? null) : null;

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
  if (disposed || !expandedKind.value) return;

  if (expandCollapseTimer) clearTimeout(expandCollapseTimer);
  expandCollapseTimer = window.setTimeout(() => {
    expandCollapseTimer = null;
    if (!disposed) collapseExpanded();
  }, 1000);
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
      if (disposed) return;

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
  if (disposed) return;
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = window.setInterval(() => {
    if (!disposed) currentRotIndex.value = (currentRotIndex.value + 1) % 3;
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

watch(
  musicSession.playback,
  (playback) => {
    if (playback) {
      void trackLyrics.load(playback);
    } else {
      trackLyrics.reset();
    }
  },
  { flush: 'sync' }
);

watch(
  () => buildPlaybackSessionIdentity(musicSession.playback.value),
  (identity) => {
    if (!identity) {
      trackCover.reset();
      return;
    }
    const playback = musicSession.playback.value;
    if (musicPresentationIdentity.isNew(identity)) musicBoxKey.value += 1;
    if (playback) void trackCover.load(playback);
  },
  { flush: 'sync' }
);

watch(activeDisplay, (newVal) => {
  if (expandedKind.value && expandedKind.value !== newVal) {
    collapseExpanded();
  }

  if (
    !['system-toast'].includes(newVal) &&
    !['soft-interrupt', 'strong-interrupt'].includes(islandLayout.value.reason)
  ) {
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

const preventDocumentContextMenu = (event: Event) => event.preventDefault();

onMounted(async () => {
  if (disposed) return;
  window.addEventListener('blur', collapseExpanded);
  document.addEventListener('contextmenu', preventDocumentContextMenu, true);
  layoutClockTimer = window.setInterval(refreshLayoutNow, 500);

  await eventListeners.register<{ enabled: boolean }>('control-music-ctl', async (event) => {
    hasReceivedMusicCtlEvent = true;
    isMusicCtlEnabled.value = event.payload.enabled;
    if (event.payload.enabled && !hasStorageValue('nsd_glow_border')) {
      isGlowBorderEnabled.value = true;
      writeBoolean('nsd_glow_border', true);
    }
    try {
      await syncMusicModuleActivity();
    } catch (error) {
      if (!disposed) console.error('切换音乐控制状态失败:', error);
    }
  });
  if (disposed) return;

  await eventListeners.register<TargetPlayerPayload>('control-target-player', async (event) => {
    hasReceivedTargetPlayerEvent = true;
    await switchTargetPlayer(event.payload.player);
    if (disposed) return;
  });
  if (disposed) return;

  await eventListeners.register<{ opacity: number }>('control-island-opacity', (event) => {
    islandWindow.setOpacity(event.payload.opacity);
  });
  if (disposed) return;

  await eventListeners.register<{ theme: string }>('control-island-theme', (event) => {
    islandWindow.setTheme(event.payload.theme);
  });
  if (disposed) return;

  await eventListeners.register<{ enabled: boolean }>('control-pin-taskbar', async (event) => {
    islandWindow.setPinnedToTaskbar(event.payload.enabled);
    if (event.payload.enabled) {
      await islandWindow.snapToBottomLeft();
    } else {
      await islandWindow.adjustWindowPosition();
    }
    if (disposed) return;
  });
  if (disposed) return;

  await eventListeners.register<{ enabled: boolean }>('control-msg-mode', async (event) => {
    isMsgModeEnabled.value = event.payload.enabled;
    if (isMsgModeEnabled.value && !isMsgActive.value) {
      isIslandVisible.value = false;
      return;
    }
    if (!isMsgModeEnabled.value) {
      await getCurrentWindow().show();
      if (disposed) return;
      isIslandVisible.value = true;
      await emit('island-status-sync', { visible: true });
      if (disposed) return;
    }
  });
  if (disposed) return;

  await eventListeners.register<{ enabled: boolean }>('control-rotation-mode', async (event) => {
    hasReceivedRotationEvent = true;
    isRotationEnabled.value = event.payload.enabled;
    if (isRotationEnabled.value) {
      startRotation();
    } else {
      stopRotation();
      currentRotIndex.value = 0;
    }
    try {
      await syncMusicModuleActivity();
    } catch (error) {
      if (!disposed) console.error('切换轮换模式失败:', error);
    }
  });
  if (disposed) return;

  await eventListeners.register<string>('system-event', (event) => {
    showToast(event.payload, 'sys');
  });
  if (disposed) return;

  await eventListeners.register<BatteryEventPayload>('battery-event', (event) => {
    const { state, percent } = event.payload;
    if (state === 'charging') {
      showToast(`已接入电源，当前电量 ${percent}%`, 'battery-charge');
    } else if (state === 'discharging' && percent <= 20) {
      showToast(`电池电量低，剩余 ${percent}%`, 'battery-low');
    }
  });
  if (disposed) return;

  await eventListeners.register<{ enabled: boolean }>('control-hardware-mon', (event) => {
    isHardwareMonEnabled.value = event.payload.enabled;
  });
  if (disposed) return;

  await eventListeners.register<{ show: boolean }>('control-island-visibility', async (event) => {
    if (!event.payload.show) {
      isIslandVisible.value = false;
      return;
    }
    await getCurrentWindow().show();
    if (disposed) return;
    await getCurrentWindow().setAlwaysOnTop(true);
    if (disposed) return;
    if (delayedVisibilityTimer !== null) window.clearTimeout(delayedVisibilityTimer);
    delayedVisibilityTimer = window.setTimeout(() => {
      delayedVisibilityTimer = null;
      if (!disposed) isIslandVisible.value = true;
    }, 40);
  });
  if (disposed) return;

  await eventListeners.register<number[]>('island-resize', (event) => {
    const [width, height] = event.payload;
    islandWindow.currentWidth.value = width;
    islandWindow.currentHeight.value = height;
  });
  if (disposed) return;

  const startupMusicState = resolveMusicStartupState(
    {
      musicEnabled: isMusicCtlEnabled.value,
      rotationEnabled: isRotationEnabled.value,
      targetPlayer: activeTargetPlayer.value,
    },
    {
      musicEnabled: readBoolean('nsd_music_ctrl'),
      rotationEnabled: readBoolean('nsd_rotation_mode'),
      targetPlayer: readTargetPlayer(),
    },
    {
      musicEnabled: hasReceivedMusicCtlEvent,
      rotationEnabled: hasReceivedRotationEvent,
      targetPlayer: hasReceivedTargetPlayerEvent,
    }
  );
  isMusicCtlEnabled.value = startupMusicState.musicEnabled;
  isRotationEnabled.value = startupMusicState.rotationEnabled;
  activeTargetPlayer.value = normalizeTargetPlayer(startupMusicState.targetPlayer);

  if (isRotationEnabled.value) startRotation();
  try {
    await initializeMusicActivity(
      {
        musicEnabled: isMusicCtlEnabled.value,
        rotationEnabled: isRotationEnabled.value,
        targetPlayer: activeTargetPlayer.value,
      },
      {
        start: musicSession.start,
        stop: musicSession.stop,
        setTargetPlayer: musicSession.setTargetPlayer,
        resetPresentation: resetMusicPresentation,
      }
    );
  } catch (error) {
    if (!disposed) console.error('初始化音乐平台失败:', error);
  }
  if (disposed) return;

  const islandEnabled = readBoolean('nsd_island_enabled', true);
  if (islandEnabled && !isMsgModeEnabled.value) {
    isIslandVisible.value = true;
    try {
      await getCurrentWindow().innerPosition();
    } catch {
      // 窗口尚未完成定位时继续使用后续位置修正
    }
    if (disposed) return;
    if (islandWindow.isPinnedToTaskbar.value) {
      await islandWindow.snapToBottomLeft();
    } else {
      await islandWindow.adjustWindowPosition();
    }
    if (disposed) return;
    await emit('island-status-sync', { visible: true });
    if (disposed) return;
  }

  void fetchSpeedStats();
  void checkNetworkLatency();

  speedTimer = window.setInterval(async () => {
    if (disposed) return;
    if (islandWindow.isPinnedToTaskbar.value && isIslandVisible.value && !isMenuOpen.value) {
      void invoke('force_window_topmost').catch(() => {});
    }
    await fetchSpeedStats();
    if (disposed || (!isHardwareMonEnabled.value && !isRotationEnabled.value)) return;
    try {
      const [cpu, usedMem, totalMem] = await invoke<[number, number, number]>('get_hardware_stats');
      if (disposed) return;
      cpuUsage.value = Math.round(cpu) + '%';
      if (totalMem > 0) memUsage.value = Math.round((usedMem / totalMem) * 100) + '%';
      await fetchGpuUsage();
      if (disposed) return;
      updateHardwareSeverity();
    } catch (error) {
      if (!disposed) console.error('获取硬件信息失败:', error);
    }
  }, 800);

  notifyTimer = window.setInterval(async () => {
    if (disposed || !readBoolean('nsd_msg_notify')) return;
    try {
      const notification = await invoke<LatestNotificationPayload | null>(
        'fetch_latest_notification'
      );
      if (disposed || !notification) return;
      msgTitle.value = notification.app_name;
      msgAumid.value = notification.aumid;
      msgBody.value = notification.body
        ? `${notification.title}: ${notification.body}`
        : notification.title;
      currentMsgIcon.value = getAppIcon(notification.app_name);
      notificationUnreadCount.value += 1;
      notificationSoftUntil.value = Date.now() + NOTIFICATION_SOFT_MS;
      refreshLayoutNow();

      if (!isMsgActive.value) {
        isMsgActive.value = true;
        if (isMsgModeEnabled.value && !isIslandVisible.value) {
          await getCurrentWindow().show();
          if (disposed) return;
          isIslandVisible.value = true;
        }
      }

      if (msgTimer !== null) window.clearTimeout(msgTimer);
      msgTimer = window.setTimeout(() => {
        msgTimer = null;
        if (disposed) return;
        isMsgActive.value = false;
        notificationSoftUntil.value = 0;
        refreshLayoutNow();
        if (!isMsgModeEnabled.value) return;
        if (delayedMessageHideTimer !== null) window.clearTimeout(delayedMessageHideTimer);
        delayedMessageHideTimer = window.setTimeout(() => {
          delayedMessageHideTimer = null;
          if (!disposed && !isMsgActive.value) isIslandVisible.value = false;
        }, 600);
      }, 5000);
    } catch (error) {
      if (!disposed) console.error(error);
    }
  }, 2500);

  musicSpectrum.start();
  pingTimer = window.setInterval(() => void checkNetworkLatency(), 5500);
});

onUnmounted(() => {
  disposed = true;
  trackCover.dispose();
  window.removeEventListener('blur', collapseExpanded);
  document.removeEventListener('contextmenu', preventDocumentContextMenu, true);
  eventListeners.dispose();
  musicSession.stop();
  playbackTimeline.stop();
  trackLyrics.dispose();
  musicSpectrum.stop();

  if (layoutClockTimer !== null) window.clearInterval(layoutClockTimer);
  if (speedTimer !== null) window.clearInterval(speedTimer);
  if (pingTimer !== null) window.clearInterval(pingTimer);
  if (notifyTimer !== null) window.clearInterval(notifyTimer);
  stopRotation();
  if (msgTimer !== null) window.clearTimeout(msgTimer);
  if (expandCollapseTimer !== null) window.clearTimeout(expandCollapseTimer);
  if (delayedVisibilityTimer !== null) window.clearTimeout(delayedVisibilityTimer);
  if (delayedMessageHideTimer !== null) window.clearTimeout(delayedMessageHideTimer);
  if (delayedToastHideTimer !== null) window.clearTimeout(delayedToastHideTimer);
  clearLifecycleDelays();
});
</script>
