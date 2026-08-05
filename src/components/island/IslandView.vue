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
    :indicator-mode="statusIndicatorMode"
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
        :theme="islandWindow.islandTheme.value"
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
      :codex="codexStatus.snapshot.value"
      :show-codex-operation-summary="showCodexOperationSummary"
      :show-codex-task-summary="showCodexTaskSummary"
      :codex-rotation-paused="Boolean(islandLayout.expandedKind)"
      :claude="claudeStatus.snapshot.value"
      :show-claude-operation-summary="showClaudeOperationSummary"
      :show-claude-task-summary="showClaudeTaskSummary"
      :claude-rotation-paused="Boolean(islandLayout.expandedKind)"
      :inner-enter-transition="animation.onInnerEnter"
      :inner-leave-transition="animation.onInnerLeave"
      @msg-click="handleMsgClick"
      @toggle-play="togglePlay"
      @prev-track="prevTrack"
      @next-track="nextTrack"
      @seek-to="seekMusic"
      @clear-failed="clearFailedCodexTask"
      @clear-claude-failed="clearFailedClaudeTask"
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
        :codex="codexStatus.snapshot.value"
        :show-codex-operation-summary="showCodexOperationSummary"
        :show-codex-task-summary="showCodexTaskSummary"
        :codex-rotation-paused="true"
        :claude="claudeStatus.snapshot.value"
        :show-claude-operation-summary="showClaudeOperationSummary"
        :show-claude-task-summary="showClaudeTaskSummary"
        :claude-rotation-paused="true"
        :inner-enter-transition="animation.onInnerEnter"
        :inner-leave-transition="animation.onInnerLeave"
        @msg-click="handleMsgClick"
        @toggle-play="togglePlay"
        @prev-track="prevTrack"
        @next-track="nextTrack"
        @seek-to="seekMusic"
        @clear-failed="clearFailedCodexTask"
        @clear-claude-failed="clearFailedClaudeTask"
      />
    </template>
  </IslandShell>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick, type CSSProperties } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';

import {
  useIslandWindow,
  useIslandAnimation,
  useIslandDrag,
  useExpandedCollapseGuard,
  useMusicSpectrum,
  useMusicPlaybackSession,
  usePlaybackTimeline,
  useTrackCover,
  useTrackLyrics,
  useCodexDisplayPreferences,
  useCodexStatus,
  useClaudeDisplayPreferences,
  useClaudeStatus,
  useIslandSystemMonitor,
  useIslandInterruptions,
} from '@/composables';
import {
  resolveIslandLayout,
  type IslandDisplayKind,
  type IslandModuleSnapshot,
} from '@/modules/island/display';
import {
  getPlayerName,
  normalizeTargetPlayer,
  readTargetPlayer,
} from '@/modules/music/musicPlatform';
import { buildPlaybackSessionIdentity } from '@/modules/music/lyrics';
import { isPlaybackProgressAvailable } from '@/modules/music/playbackTimeline';
import {
  createMusicPresentationIdentityTracker,
  initializeMusicActivity,
  resolveMusicStartupState,
  syncMusicActivity,
} from '@/modules/music/musicActivity';
import { resolveCodexIslandPresentation } from '@/modules/codex/presentation';
import { resolveClaudeIslandPresentation } from '@/modules/claude/presentation';
import { claudeCommands, codexCommands, windowCommands } from '@/shared/ipc/commands';
import { SPRING_ANIMATION } from '@/shared/ipc/events';
import { hasStorageValue, readBoolean, writeBoolean } from '@/shared/utils/storage';
import { createEventListenerRegistry } from '@/shared/utils/eventListenerRegistry';
import type { SpringAnimationPayload, TargetPlayerPayload } from '@/shared/ipc/contracts';
import { useIslandContextMenu } from './IslandContextMenu';

import IslandShell from './IslandShell.vue';
import IslandDisplayController from './IslandDisplayController.vue';
import IslandSatelliteStrip from './IslandSatelliteStrip.vue';

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

const isSpringAnimationEnabled = ref(readBoolean('codepulse_spring_animation', true));
const islandWindow = useIslandWindow({ springEnabled: isSpringAnimationEnabled });
const animation = useIslandAnimation({ springEnabled: isSpringAnimationEnabled });
const drag = useIslandDrag({
  onDragStart: handleDragStart,
  onDragEnd: handleDragEnd,
});
const contextMenu = useIslandContextMenu();
const islandShellRef = ref<IslandShellExpose | null>(null);
const playbackTimeline = usePlaybackTimeline();
const musicSession = useMusicPlaybackSession({ timeline: playbackTimeline });
const trackLyrics = useTrackLyrics({ positionMs: playbackTimeline.positionMs });
const trackCover = useTrackCover();
const codexStatus = useCodexStatus();
const codexDisplayPreferences = useCodexDisplayPreferences();
const codexIdleResident = codexDisplayPreferences.idleResident;
const showCodexOperationSummary = codexDisplayPreferences.showOperationSummary;
const showCodexTaskSummary = codexDisplayPreferences.showTaskSummary;
const claudeStatus = useClaudeStatus();
const claudeDisplayPreferences = useClaudeDisplayPreferences();
const claudeIdleResident = claudeDisplayPreferences.idleResident;
const showClaudeOperationSummary = claudeDisplayPreferences.showOperationSummary;
const showClaudeTaskSummary = claudeDisplayPreferences.showTaskSummary;
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
const isGlowBorderEnabled = ref(readBoolean('codepulse_glow_border'));

/** 交互动效序号 */
let interactionAnimationId = 0;

/** 硬件监控相关 */
const isHardwareMonEnabled = ref(readBoolean('codepulse_hardware_mon'));

/** 音乐控制相关 */
const isMusicCtlEnabled = ref(readBoolean('codepulse_music_ctrl'));
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
const expandedCollapse = useExpandedCollapseGuard({
  isDragging: drag.isDragging,
  isExpanded: () => expandedKind.value !== null,
  collapse: () => collapseExpanded(),
});

/** 轮换模式相关 */
const isRotationEnabled = ref(readBoolean('codepulse_rotation_mode'));
const currentRotIndex = ref(0);
let rotationTimer: number | null = null;
let hasReceivedRotationEvent = false;

/** 多岛布局调度 */
const layoutNow = ref(Date.now());
const manualFocusKind = ref<IslandDisplayKind | null>(null);
const manualFocusUntil = ref(0);
const stableMainKind = ref<IslandDisplayKind | null>(null);
let layoutClockTimer: number | null = null;

/** 定时器 */
let topmostTimer: number | null = null;
let disposed = false;
let delayedVisibilityTimer: number | null = null;
const USER_FOCUS_PROTECT_MS = 10_000;
const MAIN_ISLAND_HEIGHT = 42;
const DETAIL_PANEL_GAP = 8;

const isMsgModeEnabled = ref(readBoolean('codepulse_msg_mode'));
const interruptions = useIslandInterruptions({
  messageModeEnabled: isMsgModeEnabled,
  isIslandVisible,
  showWindow: () => getCurrentWindow().show(),
  collapseExpanded: () => collapseExpanded(),
  refreshLayout: () => refreshLayoutNow(),
});
const isMsgActive = interruptions.messageActive;
const msgTitle = interruptions.notificationTitle;
const msgBody = interruptions.notificationBody;
const currentMsgIcon = interruptions.notificationIcon;
const notificationUnreadCount = interruptions.notificationUnreadCount;
const notificationSoftUntil = interruptions.notificationSoftUntil;
const displaySysToast = interruptions.systemToastVisible;
const sysToastText = interruptions.systemToastText;
const sysToastType = interruptions.systemToastType;
const sysToastSoftUntil = interruptions.systemToastSoftUntil;
const showToast = interruptions.enqueueToast;

const systemMonitor = useIslandSystemMonitor({
  hardwareEnabled: isHardwareMonEnabled,
  rotationEnabled: isRotationEnabled,
  onToast: showToast,
});
const uploadSpeed = systemMonitor.uploadSpeed;
const downloadSpeed = systemMonitor.downloadSpeed;
const isHighDownload = systemMonitor.isHighDownload;
const isHighUpload = systemMonitor.isHighUpload;
const networkStatus = systemMonitor.networkStatus;
const cpuUsage = systemMonitor.cpuUsage;
const memUsage = systemMonitor.memUsage;
const hardwareStrongActive = systemMonitor.hardwareStrongActive;
const hardwareVisualStatus = systemMonitor.hardwareVisualStatus;

// ============================================================
// 计算属性
// ============================================================

/** 音乐模块是否活跃 */
const isMusicModuleActive = computed(() => isMusicCtlEnabled.value || isRotationEnabled.value);

/** 硬件模块是否活跃 */
const isHardwareModuleActive = computed(
  () => isHardwareMonEnabled.value || isRotationEnabled.value || hardwareStrongActive.value
);

/** Codex 模块展示状态由 Rust 权威快照派生 */
const codexIslandPresentation = computed(() =>
  resolveCodexIslandPresentation(codexStatus.snapshot.value, {
    idleResident: codexIdleResident.value,
  })
);

/** Claude Code 模块展示状态由 Rust 权威快照派生 */
const claudeIslandPresentation = computed(() =>
  resolveClaudeIslandPresentation(claudeStatus.snapshot.value, {
    idleResident: claudeIdleResident.value,
  })
);

/** 当前活跃模块快照 */
const islandModules = computed<IslandModuleSnapshot[]>(() => [
  codexIslandPresentation.value.module,
  claudeIslandPresentation.value.module,
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
const statusIndicatorMode = computed<'music' | 'network' | 'none'>(() => {
  if (activeDisplay.value === 'music') return 'music';
  if (activeDisplay.value === 'codex' || activeDisplay.value === 'claude') return 'none';
  return 'network';
});

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

/** 刷新布局时钟，用于驱动保护期和软打断过期 */
const refreshLayoutNow = () => {
  layoutNow.value = Date.now();
};

/** 收起当前模块详情 */
const collapseExpanded = (cancelAnimations = true) => {
  if (cancelAnimations) {
    interactionAnimationId += 1;
    animation.cancelInteractionAnimations();
  }
  expandedKind.value = null;
  expandedCollapse.cancelScheduledCollapse();
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

/** 请求 Rust 清除已确认失败的会话 */
const clearFailedCodexTask = async (sessionId: string) => {
  try {
    await codexCommands.clearFailedTask(sessionId);
  } catch (error) {
    if (!disposed) console.error('清除 Codex 失败任务失败:', error);
  }
};

/** 请求 Rust 按稳定 taskKey 清除 Claude Code 失败任务 */
const clearFailedClaudeTask = async (taskKey: string) => {
  try {
    await claudeCommands.clearFailedTask(taskKey);
  } catch (error) {
    if (!disposed) console.error('清除 Claude Code 失败任务失败:', error);
  }
};

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

  await animation.playPress(selectedButton);
  if (animationId !== interactionAnimationId) return;

  collapseExpanded(false);
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
  const mainElement = islandShellRef.value?.getMainElement() ?? null;
  await animation.playPress(mainElement);
  if (animationId !== interactionAnimationId) return;

  expandedKind.value = activeDisplay.value;
  refreshLayoutNow();
  void animation.playRelease(mainElement);
};

/** 处理鼠标离开 */
const handleMouseLeave = () => {
  if (disposed) return;
  expandedCollapse.handleMouseLeave();
};

/** 处理鼠标进入 */
const handleMouseEnter = () => {
  expandedCollapse.handleMouseEnter();
};

/** 拖拽开始时清除自动收起并暂停窗口尺寸动画 */
function handleDragStart() {
  interactionAnimationId += 1;
  animation.cancelInteractionAnimations();
  expandedCollapse.handleDragStart();
  islandWindow.suspendSizeAnimation();
}

/** 拖拽结束后只恢复排队的真实尺寸变化 */
function handleDragEnd() {
  void islandWindow.resumeSizeAnimation();
}

/** 处理鼠标移动 */
const handleMouseMove = (event: MouseEvent) => {
  void drag.handleMouseMove(event, {
    targetWidth: islandLayout.value.size.width,
    targetHeight: islandLayout.value.size.height,
    isPinned: islandWindow.isPinnedToTaskbar.value,
    isPositionLocked: islandWindow.isPositionLocked.value,
  });
};

/** 处理消息点击 */
const handleMsgClick = async () => {
  await interruptions.openNotification();
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
      writeBoolean('codepulse_glow_border', isGlowBorderEnabled.value);
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

// ============================================================
// 生命周期
// ============================================================

const preventDocumentContextMenu = (event: Event) => event.preventDefault();

onMounted(async () => {
  if (disposed) return;
  void codexStatus.start();
  void codexDisplayPreferences.start();
  void claudeStatus.start();
  void claudeDisplayPreferences.start();
  window.addEventListener('blur', expandedCollapse.handleWindowBlur);
  document.addEventListener('contextmenu', preventDocumentContextMenu, true);
  layoutClockTimer = window.setInterval(refreshLayoutNow, 500);

  await eventListeners.register<{ enabled: boolean }>('control-music-ctl', async (event) => {
    hasReceivedMusicCtlEvent = true;
    isMusicCtlEnabled.value = event.payload.enabled;
    if (event.payload.enabled && !hasStorageValue('codepulse_glow_border')) {
      isGlowBorderEnabled.value = true;
      writeBoolean('codepulse_glow_border', true);
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

  await eventListeners.register<SpringAnimationPayload>(SPRING_ANIMATION, (event) => {
    isSpringAnimationEnabled.value = event.payload.enabled;
    animation.cancelInteractionAnimations();
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

  await interruptions.start();
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
      musicEnabled: readBoolean('codepulse_music_ctrl'),
      rotationEnabled: readBoolean('codepulse_rotation_mode'),
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

  const islandEnabled = readBoolean('codepulse_island_enabled', true);
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

  systemMonitor.start();
  topmostTimer = window.setInterval(() => {
    if (disposed) return;
    if (islandWindow.isPinnedToTaskbar.value && isIslandVisible.value && !isMenuOpen.value) {
      void windowCommands.forceWindowTopmost().catch(() => {});
    }
  }, 800);

  musicSpectrum.start();
});

onUnmounted(() => {
  disposed = true;
  codexStatus.dispose();
  codexDisplayPreferences.dispose();
  claudeStatus.dispose();
  claudeDisplayPreferences.dispose();
  trackCover.dispose();
  window.removeEventListener('blur', expandedCollapse.handleWindowBlur);
  document.removeEventListener('contextmenu', preventDocumentContextMenu, true);
  eventListeners.dispose();
  interruptions.stop();
  systemMonitor.stop();
  musicSession.stop();
  playbackTimeline.stop();
  trackLyrics.dispose();
  musicSpectrum.stop();

  if (layoutClockTimer !== null) window.clearInterval(layoutClockTimer);
  if (topmostTimer !== null) window.clearInterval(topmostTimer);
  stopRotation();
  if (delayedVisibilityTimer !== null) window.clearTimeout(delayedVisibilityTimer);
});
</script>
