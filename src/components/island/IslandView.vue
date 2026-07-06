<template>
  <IslandShell
    :visible="isIslandVisible"
    :container-style="islandWindow.islandStyle.value"
    :core-style="islandWindow.coreContentStyle.value"
    :show-glow="isGlowBorderEnabled"
    :glow-opacity="islandWindow.glowOpacity.value"
    :show-music-spectrum="displayMusic"
    :is-playing="isPlaying"
    :is-music-expanded="isMusicExpanded"
    :network-status="networkStatus"
    :spectrum-data="spectrumData"
    :enter-transition="animation.onEnter"
    :leave-transition="animation.onLeave"
    @shell-mousedown="drag.handleMouseDown"
    @shell-mousemove="handleMouseMove"
    @shell-mouseup="drag.handleMouseUp"
    @shell-mouseleave="handleMouseLeave"
    @shell-mouseenter="handleMouseEnter"
    @shell-contextmenu="handleRightClick"
  >
    <IslandDisplayController
      :display="activeDisplay"
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
        isExpanded: isMusicExpanded,
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
      @expand-music="expandMusic"
      @toggle-play="togglePlay"
      @prev-track="prevTrack"
      @next-track="nextTrack"
    />
  </IslandShell>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';

import { useIslandWindow, useIslandAnimation, useIslandDrag } from '@/composables';
import { resolveIslandDisplay, type IslandDisplayKind } from '@/modules/island/display';
import { hasStorageValue, readBoolean, readEnum, writeBoolean } from '@/shared/utils/storage';
import type { SystemToastType } from '@/shared/ipc/contracts';
import { useIslandContextMenu } from './IslandContextMenu';

import IslandShell from './IslandShell.vue';
import IslandDisplayController from './IslandDisplayController.vue';

import defaultLogo from '@/assets/logo.png';

const MUSIC_PLATFORMS = ['netease', 'spotify', 'apple', 'qqmusic', 'kugou', 'echo'] as const;

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

// ============================================================
// Composables
// ============================================================

const islandWindow = useIslandWindow();
const animation = useIslandAnimation();
const drag = useIslandDrag();
const contextMenu = useIslandContextMenu();

// ============================================================
// 状态
// ============================================================

/** 灵动岛是否可见 */
const isIslandVisible = ref(false);

/** 菜单是否打开 */
const isMenuOpen = ref(false);

/** 流光边框是否启用 */
const isGlowBorderEnabled = ref(readBoolean('nsd_glow_border'));

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
const isPlaying = ref(false);
const coverUrl = ref('');
const coverCache = new Map<string, string>();
const currentSongName = ref('未在播放歌曲');
const currentArtistName = ref('');
const currentTrackInfo = ref('');
const musicBoxKey = ref(0);
const isMusicExpanded = ref(false);
let musicExpandTimer: number | null = null;

/** 音乐频谱 */
const spectrumData = ref([0.35, 0.35, 0.35, 0.35, 0.35]);

/** 获取播放器名称 */
const getPlayerName = () => {
  const key = readEnum('nsd_target_player', 'netease', MUSIC_PLATFORMS);
  const map: Record<string, string> = {
    netease: '网易云音乐',
    spotify: 'Spotify',
    apple: 'Apple Music',
    qqmusic: 'QQ音乐',
    kugou: '酷狗音乐',
    echo: 'Echo Music',
  };
  return map[key] || '未知平台';
};

// 初始化音乐状态
currentArtistName.value = getPlayerName();
currentTrackInfo.value = `未在播放歌曲 - ${getPlayerName()}`;

/** 消息模式相关 */
const isMsgModeEnabled = ref(readBoolean('nsd_msg_mode'));
const isMsgActive = ref(false);
const msgTitle = ref('');
const msgBody = ref('');
const msgAumid = ref('');
const currentMsgIcon = ref(defaultLogo);
let msgTimer: number | null = null;

/** 系统操作通知 */
const displaySysToast = ref(false);
const sysToastText = ref('');
const sysToastType = ref<SystemToastType>('app');
const toastQueue = ref<SystemToastItem[]>([]);
let isProcessingToast = false;

/** 轮换模式相关 */
const isRotationEnabled = ref(readBoolean('nsd_rotation_mode'));
const currentRotIndex = ref(0);
let rotationTimer: number | null = null;

/** 定时器 */
let speedTimer: number;
let pingTimer: number;
let musicTimer: number;
let notifyTimer: number;
let spectrumTimer: number;
let systemEventUnlisten: UnlistenFn | null = null;
let batteryEventUnlisten: UnlistenFn | null = null;

/** 流量监控相关 */
let lastRx = 0;
let lastTx = 0;
let lowTrafficStartTime = Date.now();
const RED_DELAY_MS = 5000;

// ============================================================
// 计算属性
// ============================================================

/** 当前展示内容 */
const activeDisplay = computed<IslandDisplayKind>(() =>
  resolveIslandDisplay({
    agentActive: false,
    wechatActive: false,
    notificationActive: isMsgActive.value,
    systemToastActive: displaySysToast.value,
    rotationEnabled: isRotationEnabled.value,
    rotationIndex: currentRotIndex.value,
    musicEnabled: isMusicCtlEnabled.value,
    hardwareEnabled: isHardwareMonEnabled.value,
  })
);

/** 是否展示音乐内容 */
const displayMusic = computed(() => activeDisplay.value === 'music');

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
  const nextToast = toastQueue.value.shift();

  if (nextToast) {
    collapseMusic();
    sysToastText.value = nextToast.text;
    sysToastType.value = nextToast.type;
    displaySysToast.value = true;

    if (isMsgModeEnabled.value && !isIslandVisible.value) {
      await getCurrentWindow().show();
      isIslandVisible.value = true;
    }

    islandWindow.animateIslandSize(260, 42);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    displaySysToast.value = false;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  isProcessingToast = false;
  if (toastQueue.value.length > 0) {
    void processToastQueue();
  } else if (isMsgModeEnabled.value && !isMsgActive.value) {
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

/** 同步音乐状态 */
const syncMusicStatus = async () => {
  try {
    const res = await invoke<[string, string, boolean] | null>('fetch_netease_music_info');

    if (res) {
      const [song, artist, playing] = res;

      currentSongName.value = song;
      currentArtistName.value = artist || '未知歌手';

      const newTrackInfo = artist ? `${song} - ${artist}` : song;

      if (currentTrackInfo.value !== newTrackInfo) {
        currentTrackInfo.value = newTrackInfo;

        if (coverCache.has(newTrackInfo)) {
          coverUrl.value = coverCache.get(newTrackInfo)!;
        } else {
          try {
            const realCoverUrl = await invoke<string>('get_random_cover_url', {
              songName: song,
              artistName: artist,
            });
            coverUrl.value = realCoverUrl;
            if (coverCache.size > 50) coverCache.clear();
            coverCache.set(newTrackInfo, realCoverUrl);
          } catch (coverErr) {
            console.error('所有封面源均获取失败:', coverErr);
            coverUrl.value = '';
          }
        }
      }

      isPlaying.value = playing;
    } else {
      currentTrackInfo.value = `未在播放歌曲 - ${getPlayerName()}`;
      isPlaying.value = false;
      coverUrl.value = '';
    }
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

/** 展开音乐 */
const expandMusic = (e: MouseEvent) => {
  if (!drag.isClick(e)) return;

  if ((e.target as HTMLElement).closest('.ctl-btn')) return;

  if (isMusicExpanded.value) return;

  islandWindow.animateIslandSize(245, 38);

  setTimeout(() => {
    isMusicExpanded.value = true;
    islandWindow.animateIslandSize(320, 115);
  }, 120);
};

/** 收缩音乐 */
const collapseMusic = () => {
  if (!isMusicExpanded.value) return;
  isMusicExpanded.value = false;
  if (musicExpandTimer) clearTimeout(musicExpandTimer);
  islandWindow.animateIslandSize(260, 42);
};

/** 处理鼠标离开 */
const handleMouseLeave = () => {
  if (!isMusicExpanded.value) return;

  if (musicExpandTimer) clearTimeout(musicExpandTimer);
  musicExpandTimer = window.setTimeout(collapseMusic, 1000);
};

/** 处理鼠标进入 */
const handleMouseEnter = () => {
  if (musicExpandTimer) {
    clearTimeout(musicExpandTimer);
    musicExpandTimer = null;
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
      islandWindow.animateIslandSize(260, 42);
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

watch(displayMusic, (newVal: boolean) => {
  if (!newVal) {
    collapseMusic();
  }
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
  window.addEventListener('blur', collapseMusic);

  document.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    { capture: true }
  );

  // 监听音乐控制器状态
  await listen<{ enabled: boolean }>('control-music-ctl', (event) => {
    const isEnabled = event.payload.enabled;
    isMusicCtlEnabled.value = isEnabled;

    if (isEnabled) {
      if (!hasStorageValue('nsd_glow_border')) {
        isGlowBorderEnabled.value = true;
        writeBoolean('nsd_glow_border', true);
      }
      musicBoxKey.value++;
    }
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

  // 初始化位置
  try {
    await getCurrentWindow().innerPosition();
  } catch {
    /* 忽略 */
  }

  // 根据本地记录决定启动时出现在哪
  if (islandWindow.isPinnedToTaskbar.value) {
    await islandWindow.snapToBottomLeft();
  } else {
    await islandWindow.adjustWindowPosition();
  }

  // 显示灵动岛
  if (!isMsgModeEnabled.value) {
    await getCurrentWindow().show();
    isIslandVisible.value = true;
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

        if (!isMsgActive.value) {
          isMsgActive.value = true;
          if (isMsgModeEnabled.value && !isIslandVisible.value) {
            getCurrentWindow().show();
            isIslandVisible.value = true;
          }
          if (!islandWindow.isPinnedToTaskbar.value) {
            islandWindow.animateIslandSize(360, 65);
          }
        }

        if (msgTimer) clearTimeout(msgTimer);
        msgTimer = window.setTimeout(() => {
          isMsgActive.value = false;
          islandWindow.animateIslandSize(260, 42);
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

  // 高频定时器：音乐频谱同步
  spectrumTimer = setInterval(async () => {
    if (isPlaying.value && displayMusic.value) {
      try {
        spectrumData.value = await invoke<number[]>('get_audio_spectrum');
      } catch {
        spectrumData.value = [0.35, 0.35, 0.35, 0.35, 0.35];
      }
    } else {
      spectrumData.value = [0.35, 0.35, 0.35, 0.35, 0.35];
    }
  }, 50) as unknown as number;

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
  window.removeEventListener('blur', collapseMusic);
  clearInterval(speedTimer);
  clearInterval(pingTimer);
  stopRotation();
  clearInterval(musicTimer);
  clearInterval(notifyTimer);
  clearInterval(spectrumTimer);
  systemEventUnlisten?.();
  batteryEventUnlisten?.();
});
</script>
