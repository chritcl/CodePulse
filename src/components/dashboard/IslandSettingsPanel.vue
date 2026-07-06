<template>
  <div class="dynamicset-grid">
    <!-- 音乐控制平台 -->
    <div
      class="set-item-top"
      style="
        grid-column: span 2;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: 8px;
      "
    >
      <div
        class="set-item-meta"
        style="
          flex-direction: row;
          justify-content: space-between;
          width: 100%;
          align-items: center;
        "
      >
        <span class="set-item-title-top">音乐控制平台</span>
        <span class="set-item-desc" style="font-size: 11px">选择灵动岛显示的音乐平台</span>
      </div>
      <div class="capsule-switch player-grid">
        <div
          v-for="player in players"
          :key="player.id"
          class="capsule-btn"
          :class="{ 'is-active': settingsStore.targetPlayer === player.id }"
          @click="handleSetPlayer(player.id)"
        >
          <img :src="player.icon" class="platform-icon" alt="icon" />
          {{ player.name }}
        </div>
      </div>
    </div>

    <!-- 灵动岛颜色 -->
    <div class="set-item">
      <div class="set-item-meta">
        <span class="set-item-title">灵动岛颜色</span>
        <span class="set-item-desc">切换灵动岛的默认背景色调</span>
      </div>
      <div class="capsule-switch">
        <div
          class="capsule-btn"
          :class="{ 'is-active': settingsStore.islandTheme === 'black' }"
          @click="handleSetIslandTheme('black')"
        >
          暗色
        </div>
        <div
          class="capsule-btn"
          :class="{ 'is-active': settingsStore.islandTheme === 'white' }"
          @click="handleSetIslandTheme('white')"
        >
          亮色
        </div>
      </div>
    </div>

    <!-- 音乐控制器 -->
    <div class="set-item" :class="{ 'disabled-set-item': settingsStore.enableRotation }">
      <div class="set-item-meta">
        <span class="set-item-title">
          音乐控制器
          <p class="set-item-pro-tag">PRO</p>
        </span>
        <span class="set-item-desc">
          {{
            settingsStore.enableRotation ? '轮换开启中，已禁用' : '支持网易云音乐控制及歌曲信息显示'
          }}
        </span>
      </div>
      <label class="switch">
        <input
          v-model="settingsStore.enableMusicCtrl"
          type="checkbox"
          :disabled="settingsStore.enableRotation"
          @change="handleToggleMusicCtrl"
        />
        <span class="slider" />
      </label>
    </div>

    <!-- 消息通知 -->
    <div class="set-item">
      <div class="set-item-meta">
        <span class="set-item-title">消息通知</span>
        <span class="set-item-desc">接收 Windows 系统通知并在灵动岛显示</span>
      </div>
      <label class="switch">
        <input
          v-model="settingsStore.enableMsgNotify"
          type="checkbox"
          @change="handleToggleMsgNotify"
        />
        <span class="slider" />
      </label>
    </div>

    <!-- 硬件监控 -->
    <div class="set-item" :class="{ 'disabled-set-item': settingsStore.enableMusicCtrl }">
      <div class="set-item-meta">
        <span class="set-item-title">
          硬件监控
          <p class="set-item-pro-tag">PRO</p>
        </span>
        <span class="set-item-desc">
          {{
            settingsStore.enableMusicCtrl ? '音乐控制器开启中，已禁用' : 'CPU / 内存占用实时监控'
          }}
        </span>
      </div>
      <label class="switch">
        <input
          v-model="settingsStore.enableHardwareMon"
          type="checkbox"
          :disabled="settingsStore.enableMusicCtrl"
          @change="handleToggleHardwareMon"
        />
        <span class="slider" />
      </label>
    </div>

    <!-- 消息模式 -->
    <div class="set-item">
      <div class="set-item-meta">
        <span class="set-item-title">消息模式</span>
        <span class="set-item-desc">收到消息时灵动岛自动展开并显示内容</span>
      </div>
      <label class="switch">
        <input
          v-model="settingsStore.msgModeEnabled"
          type="checkbox"
          @change="handleToggleMsgMode"
        />
        <span class="slider" />
      </label>
    </div>

    <!-- 轮换模式 -->
    <div class="set-item">
      <div class="set-item-meta">
        <span class="set-item-title">轮换模式</span>
        <span class="set-item-desc">灵动岛自动轮换显示不同内容</span>
      </div>
      <label class="switch">
        <input
          v-model="settingsStore.enableRotation"
          type="checkbox"
          @change="handleToggleRotation"
        />
        <span class="slider" />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '@/stores';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { MusicPlatform, IslandTheme } from '@/types';

import neteaseIcon from '@/assets/musci163.svg';
import spotifyIcon from '@/assets/Spotify.svg';
import appleIcon from '@/assets/applemusic.svg';
import qqmusicIcon from '@/assets/qqmusic.svg';
import kugouIcon from '@/assets/kugou.svg';
import echoIcon from '@/assets/echomusic.ico';

const settingsStore = useSettingsStore();

/** 音乐平台列表 */
const players = [
  { id: 'netease' as MusicPlatform, name: '网易云', icon: neteaseIcon },
  { id: 'spotify' as MusicPlatform, name: 'Spotify', icon: spotifyIcon },
  { id: 'apple' as MusicPlatform, name: 'Apple', icon: appleIcon },
  { id: 'qqmusic' as MusicPlatform, name: 'QQ音乐', icon: qqmusicIcon },
  { id: 'kugou' as MusicPlatform, name: '酷狗', icon: kugouIcon },
  { id: 'echo' as MusicPlatform, name: 'EchoMusic', icon: echoIcon },
];

/** 设置音乐平台 */
const handleSetPlayer = async (player: MusicPlatform) => {
  settingsStore.setTargetPlayer(player);
  try {
    await invoke('set_target_player', { player });
  } catch (e) {
    console.error('切换平台失败', e);
  }
};

/** 设置灵动岛主题 */
const handleSetIslandTheme = async (theme: IslandTheme) => {
  settingsStore.setIslandTheme(theme);
  await emit('control-island-theme', { theme });
};

/** 切换音乐控制器 */
const handleToggleMusicCtrl = async () => {
  await emit('control-music-ctl', { enabled: settingsStore.enableMusicCtrl });

  // 互斥逻辑：开启音乐时关闭硬件监控
  if (settingsStore.enableMusicCtrl && settingsStore.enableHardwareMon) {
    settingsStore.toggleHardwareMon();
    await emit('control-hardware-mon', { enabled: false });
  }
};

/** 切换消息通知 */
const handleToggleMsgNotify = async () => {
  // 消息通知仅本地保存，不发送事件
};

/** 切换硬件监控 */
const handleToggleHardwareMon = async () => {
  await emit('control-hardware-mon', { enabled: settingsStore.enableHardwareMon });

  // 互斥逻辑：开启硬件时关闭音乐
  if (settingsStore.enableHardwareMon && settingsStore.enableMusicCtrl) {
    settingsStore.toggleMusicCtrl();
    await emit('control-music-ctl', { enabled: false });
  }
};

/** 切换消息模式 */
const handleToggleMsgMode = async () => {
  // 如果开启消息模式，强制开启消息通知
  if (settingsStore.msgModeEnabled) {
    settingsStore.enableMsgNotify = true;
  }
  await emit('control-msg-mode', { enabled: settingsStore.msgModeEnabled });
};

/** 切换轮换模式 */
const handleToggleRotation = async () => {
  await emit('control-rotation-mode', { enabled: settingsStore.enableRotation });

  // 如果开启轮换，关闭消息模式
  if (settingsStore.enableRotation) {
    settingsStore.msgModeEnabled = false;
    await emit('control-msg-mode', { enabled: false });
  }
};
</script>

<style scoped>
.dynamicset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.set-item,
.set-item-top {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.2s ease;
}

.set-item:hover {
  box-shadow: 0 2px 8px var(--card-shadow);
}

.set-item.disabled-set-item {
  opacity: 0.5;
  pointer-events: none;
}

.set-item-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.set-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--item-title-color);
  display: flex;
  align-items: center;
  gap: 6px;
}

.set-item-title-top {
  font-size: 13px;
  font-weight: 500;
  color: var(--item-title-color);
}

.set-item-desc {
  font-size: 11px;
  color: var(--item-desc-color);
}

.set-item-pro-tag {
  margin: 0;
  font-size: 9px;
  padding: 1px 5px;
  background: var(--tag-dev-bg);
  color: var(--tag-dev-color);
  border-radius: 4px;
  font-weight: 600;
}

.capsule-switch {
  display: flex;
  gap: 6px;
}

.capsule-btn {
  padding: 6px 12px;
  border: 1px solid var(--control-border);
  border-radius: 20px;
  background: var(--control-bg);
  color: var(--text-body);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 4px;
}

.capsule-btn:hover {
  background: var(--card-bg);
}

.capsule-btn.is-active {
  background: var(--btn-pri-bg);
  color: var(--btn-pri-color);
  border-color: var(--btn-pri-border);
}

.platform-icon {
  width: 14px;
  height: 14px;
  border-radius: 3px;
}

.player-grid {
  flex-wrap: wrap;
}

.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--slider-bg);
  transition: 0.4s;
  border-radius: 22px;
}

.slider:before {
  position: absolute;
  content: '';
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--slider-checked-bg);
}

input:checked + .slider:before {
  transform: translateX(18px);
}

input:disabled + .slider {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
