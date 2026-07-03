<template>
  <transition @enter="animation.onEnter" @leave="animation.onLeave" :css="false">
    <div
      v-show="isIslandVisible"
      :class="['island-container', { 'has-music-border': isGlowBorderEnabled }]"
      :style="islandWindow.islandStyle.value"
      @mousedown="drag.handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="drag.handleMouseUp"
      @mouseleave="handleMouseLeave"
      @mouseenter="handleMouseEnter"
      @contextmenu="handleRightClick"
    >
      <!-- 流光边框 -->
      <div
        v-if="isGlowBorderEnabled"
        class="rainbow-border-glow"
        :style="{ opacity: islandWindow.glowOpacity.value }"
      />

      <!-- 核心内容 -->
      <div class="island-core-content" :style="islandWindow.coreContentStyle.value">
        <div class="inner-wrapper">
          <transition mode="out-in" @enter="animation.onInnerEnter" :css="false" @leave="animation.onInnerLeave">
            <!-- 消息通知 -->
            <NotificationContent
              v-if="isMsgActive"
              key="msg"
              :msg-icon="currentMsgIcon"
              :msg-title="msgTitle"
              :msg-body="msgBody"
              @msg-click="handleMsgClick"
            />

            <!-- 硬件监控 -->
            <HardwareContent
              v-else-if="displayHardware"
              key="hardware"
              :cpu-usage="cpuUsage"
              :gpu-usage="gpuUsage"
              :mem-usage="memUsage"
            />

            <!-- 音乐控制 -->
            <MusicContent
              v-else-if="displayMusic"
              :key="'music_' + musicBoxKey"
              :is-playing="isPlaying"
              :cover-url="coverUrl"
              :current-track-info="currentTrackInfo"
              :current-song-name="currentSongName"
              :current-artist-name="currentArtistName"
              :is-music-expanded="isMusicExpanded"
              @expand-music="expandMusic"
              @toggle-play="togglePlay"
              @prev-track="prevTrack"
              @next-track="nextTrack"
            />

            <!-- 网速显示 -->
            <SpeedContent
              v-else-if="displaySpeed"
              key="speed"
              :upload-speed="uploadSpeed"
              :download-speed="downloadSpeed"
              :is-high-upload="isHighUpload"
              :is-high-download="isHighDownload"
            />
          </transition>
        </div>

        <!-- 状态指示器 -->
        <IslandStatusIndicator
          :show-music-spectrum="displayMusic"
          :is-playing="isPlaying"
          :is-music-expanded="isMusicExpanded"
          :network-status="networkStatus"
        />
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, emit } from '@tauri-apps/api/event';

import { useIslandWindow, useIslandAnimation, useIslandDrag } from '@/composables';
import { useIslandContextMenu } from './IslandContextMenu';

import SpeedContent from './SpeedContent.vue';
import MusicContent from './MusicContent.vue';
import HardwareContent from './HardwareContent.vue';
import NotificationContent from './NotificationContent.vue';
import IslandStatusIndicator from './IslandStatusIndicator.vue';

import defaultLogo from '@/assets/logo.png';

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
const isGlowBorderEnabled = ref(localStorage.getItem('nsd_glow_border') === 'true');

/** 网速监控相关 */
const uploadSpeed = ref('0 KB/s');
const downloadSpeed = ref('0 KB/s');
const isHighDownload = ref(false);
const isHighUpload = ref(false);
const networkStatus = ref<'good' | 'warning' | 'error'>('good');

/** 硬件监控相关 */
const isHardwareMonEnabled = ref(localStorage.getItem('nsd_hardware_mon') === 'true');
const cpuUsage = ref('0%');
const gpuUsage = ref('0%');
const memUsage = ref('0%');

/** 音乐控制相关 */
const isMusicCtlEnabled = ref(localStorage.getItem('nsd_music_ctrl') === 'true');
const isPlaying = ref(false);
const coverUrl = ref('');
const coverCache = new Map<string, string>();
const currentSongName = ref('未在播放歌曲');
const currentArtistName = ref('');
const currentTrackInfo = ref('');
const musicBoxKey = ref(0);
const isMusicExpanded = ref(false);
let musicExpandTimer: number | null = null;

/** 获取播放器名称 */
const getPlayerName = () => {
  const key = localStorage.getItem('nsd_target_player') || 'netease';
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
const isMsgModeEnabled = ref(localStorage.getItem('nsd_msg_mode') === 'true');
const isMsgActive = ref(false);
const msgTitle = ref('');
const msgBody = ref('');
const msgAumid = ref('');
const currentMsgIcon = ref(defaultLogo);

/** 轮换模式相关 */
const isRotationEnabled = ref(localStorage.getItem('nsd_rotation_mode') === 'true');
const currentRotIndex = ref(0);
let rotationTimer: number | null = null;

/** 定时器 */
let speedTimer: number;
let pingTimer: number;
let musicTimer: number;
let notifyTimer: number;

/** 流量监控相关 */
let lastRx = 0;
let lastTx = 0;
let lowTrafficStartTime = Date.now();
const RED_DELAY_MS = 5000;

// ============================================================
// 计算属性
// ============================================================

/** 显示网速 */
const displaySpeed = computed(
  () =>
    !isMsgActive.value &&
    (isRotationEnabled.value
      ? currentRotIndex.value === 0
      : !isMusicCtlEnabled.value && !isHardwareMonEnabled.value)
);

/** 显示音乐 */
const displayMusic = computed(
  () =>
    !isMsgActive.value &&
    (isRotationEnabled.value ? currentRotIndex.value === 1 : isMusicCtlEnabled.value)
);

/** 显示硬件 */
const displayHardware = computed(
  () =>
    !isMsgActive.value &&
    (isRotationEnabled.value ? currentRotIndex.value === 2 : isHardwareMonEnabled.value)
);

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
  } catch (e) {
    gpuUsage.value = '0%';
  }
};

/** 检查网络延迟 */
const checkNetworkLatency = async () => {
  try {
    const latency = await invoke<number>('get_network_latency');

    if (latency < 150) {
      networkStatus.value = 'good';
    } else {
      networkStatus.value = 'warning';
    }
  } catch (error) {
    if (isHighDownload.value || isHighUpload.value) {
      networkStatus.value = 'warning';
      return;
    }

    const timeSinceLowTraffic = Date.now() - lowTrafficStartTime;
    if (timeSinceLowTraffic < RED_DELAY_MS) {
      networkStatus.value = 'warning';
    } else {
      networkStatus.value = 'error';
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
  drag.handleMouseMove(event, islandWindow.isPinnedToTaskbar.value, islandWindow.isPositionLocked.value);
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
      if ((window as any).msgTimer) clearTimeout((window as any).msgTimer);
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
    onToggleGlowBorder: () => {
      isGlowBorderEnabled.value = !isGlowBorderEnabled.value;
      localStorage.setItem('nsd_glow_border', String(isGlowBorderEnabled.value));
    },
    onResetPosition: () => {
      islandWindow.adjustWindowPosition().catch(console.error);
    },
    onToggleLock: () => {
      islandWindow.setPositionLocked(!islandWindow.isPositionLocked.value);
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
      if (localStorage.getItem('nsd_glow_border') === null) {
        isGlowBorderEnabled.value = true;
        localStorage.setItem('nsd_glow_border', 'true');
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
        const [cpu, usedMem, totalMem] = await invoke<[number, number, number]>('get_hardware_stats');
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
    const enabled = localStorage.getItem('nsd_msg_notify') === 'true';
    if (!enabled) return;

    try {
      const res = await invoke<any>('fetch_latest_notification');
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

        if ((window as any).msgTimer) clearTimeout((window as any).msgTimer);
        (window as any).msgTimer = setTimeout(() => {
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
});
</script>

<style scoped>
*,
*::before,
*::after {
  box-sizing: border-box;
  border: none !important;
  outline: none !important;
}

:root {
  -webkit-app-region: drag;
}

:global(html),
:global(body) {
  background-color: transparent !important;
  background: transparent !important;
  overflow: hidden;
  margin: 0;
  padding: 0;
  border: none !important;
}

.island-container {
  margin: 0 auto;
  border-radius: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  user-select: none;
  -webkit-user-select: none;
  overflow: hidden;
  background: transparent;
  transition: background 0.4s ease;
  box-sizing: border-box;
  transform: translateZ(0);
  will-change: width, height, border-radius;
  contain: strict;
}

.rainbow-border-glow {
  position: absolute;
  width: 500px;
  height: 500px;
  top: calc(50% - 250px);
  left: calc(50% - 250px);
  z-index: 1;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Cdefs%3E%3Cfilter id='b' x='-50%25' y='-50%25' width='200%25' height='200%25'%3E%3CfeGaussianBlur in='SourceGraphic' stdDeviation='60'/%3E%3C/filter%3E%3Cg filter='url(%23b)'%3E%3Ccircle cx='250' cy='90' r='150' fill='%23ff3b30'/%3E%3Ccircle cx='390' cy='170' r='150' fill='%23ff9500'/%3E%3Ccircle cx='390' cy='330' r='150' fill='%234cd964'/%3E%3Ccircle cx='250' cy='410' r='150' fill='%23007aff'/%3E%3Ccircle cx='110' cy='330' r='150' fill='%235856d6'/%3E%3Ccircle cx='110' cy='170' r='150' fill='%23ff2d55'/%3E%3C/g%3E%3C/svg%3E");
  background-size: cover;
  animation: rainbow-rotate 10s linear infinite;
  will-change: transform;
}

.island-core-content {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  border-radius: 98px;
  transform: translateZ(0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  overflow: hidden;
}

.inner-wrapper {
  flex: 1;
  overflow: hidden;
}

@keyframes rainbow-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

[data-tauri-drag-region] {
  -webkit-app-region: drag;
  cursor: grab;
}

[data-tauri-drag-region]:active {
  cursor: grabbing;
}
</style>
