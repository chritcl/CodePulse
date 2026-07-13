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
    <div class="set-item">
      <div class="set-item-meta">
        <span class="set-item-title">
          音乐控制器
          <p class="set-item-pro-tag">PRO</p>
        </span>
        <span class="set-item-desc">支持网易云音乐控制及歌曲信息显示</span>
      </div>
      <label class="switch">
        <input
          v-model="settingsStore.enableMusicCtrl"
          type="checkbox"
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
    <div class="set-item">
      <div class="set-item-meta">
        <span class="set-item-title">
          硬件监控
          <p class="set-item-pro-tag">PRO</p>
        </span>
        <span class="set-item-desc">CPU / 内存占用实时监控</span>
      </div>
      <label class="switch">
        <input
          v-model="settingsStore.enableHardwareMon"
          type="checkbox"
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
  await emit('control-target-player', { player });
};

/** 设置灵动岛主题 */
const handleSetIslandTheme = async (theme: IslandTheme) => {
  settingsStore.setIslandTheme(theme);
  await emit('control-island-theme', { theme });
};

/** 切换音乐控制器 */
const handleToggleMusicCtrl = async () => {
  await emit('control-music-ctl', { enabled: settingsStore.enableMusicCtrl });
};

/** 切换消息通知 */
const handleToggleMsgNotify = async () => {
  // 消息通知仅本地保存，不发送事件
};

/** 切换硬件监控 */
const handleToggleHardwareMon = async () => {
  await emit('control-hardware-mon', { enabled: settingsStore.enableHardwareMon });
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

<style scoped src="./IslandSettingsPanel.css"></style>
