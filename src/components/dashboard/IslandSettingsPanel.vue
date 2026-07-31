<template>
  <div class="settings-panel island-settings-panel">
    <section class="settings-group">
      <header class="settings-group-header">
        <div>
          <h2>音乐平台</h2>
          <p>选择灵动岛跟随的 Windows 媒体会话</p>
        </div>
        <span class="settings-count">6 个平台</span>
      </header>
      <div class="player-choice-grid">
        <button
          v-for="player in players"
          :key="player.id"
          type="button"
          class="player-choice"
          :class="{ 'is-selected': settingsStore.targetPlayer === player.id }"
          :data-player="player.id"
          @click="void actions.setTargetPlayer(player.id)"
        >
          <img :src="player.icon" alt="" />
          <span>{{ player.name }}</span>
          <svg
            v-if="settingsStore.targetPlayer === player.id"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="m5 10 3 3 7-7" />
          </svg>
        </button>
      </div>
    </section>

    <section class="settings-group">
      <header class="settings-group-header">
        <div>
          <h2>内容模块</h2>
          <p>控制哪些信息可以进入灵动岛</p>
        </div>
      </header>
      <div class="settings-list">
        <div class="setting-row" data-setting="music-control">
          <span class="setting-copy">
            <strong>音乐控制</strong>
            <small>显示歌曲、歌词、进度与媒体控制</small>
          </span>
          <MaterialSwitch
            :model-value="settingsStore.enableMusicCtrl"
            label="音乐控制"
            @update:model-value="void actions.setMusicEnabled($event)"
          />
        </div>
        <div class="setting-row" data-setting="notifications">
          <span class="setting-copy">
            <strong>消息通知</strong>
            <small>接收 Windows 通知并显示应用消息</small>
          </span>
          <MaterialSwitch
            :model-value="settingsStore.enableMsgNotify"
            label="消息通知"
            @update:model-value="void actions.setNotificationsEnabled($event)"
          />
        </div>
        <div class="setting-row" data-setting="hardware">
          <span class="setting-copy">
            <strong>硬件监控</strong>
            <small>显示 CPU 和内存的实时占用</small>
          </span>
          <MaterialSwitch
            :model-value="settingsStore.enableHardwareMon"
            label="硬件监控"
            @update:model-value="void actions.setHardwareEnabled($event)"
          />
        </div>
      </div>
    </section>

    <section class="settings-group">
      <header class="settings-group-header">
        <div>
          <h2>展示策略</h2>
          <p>明确消息展开与多内容轮换之间的优先关系</p>
        </div>
      </header>
      <div class="strategy-selector" role="radiogroup" aria-label="灵动岛展示策略">
        <button
          v-for="strategy in strategies"
          :key="strategy.id"
          type="button"
          role="radio"
          class="strategy-option"
          :class="{ 'is-selected': displayStrategy === strategy.id }"
          :aria-checked="displayStrategy === strategy.id"
          :data-display-strategy="strategy.id"
          @click="void actions.setDisplayStrategy(strategy.id)"
        >
          <span>{{ strategy.title }}</span>
          <small>{{ strategy.description }}</small>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { useSettingsActions } from '@/composables/useSettingsActions';
import { resolveDisplayStrategy, type DisplayStrategy } from '@/modules/dashboard/displayStrategy';
import { useSettingsStore } from '@/stores';
import type { MusicPlatform } from '@/types';
import MaterialSwitch from './MaterialSwitch.vue';

import neteaseIcon from '@/assets/musci163.svg';
import spotifyIcon from '@/assets/Spotify.svg';
import appleIcon from '@/assets/applemusic.svg';
import qqmusicIcon from '@/assets/qqmusic.svg';
import kugouIcon from '@/assets/kugou.svg';
import echoIcon from '@/assets/echomusic.ico';

defineProps<{
  actions: ReturnType<typeof useSettingsActions>;
}>();

const settingsStore = useSettingsStore();

const players = [
  { id: 'netease' as MusicPlatform, name: '网易云', icon: neteaseIcon },
  { id: 'spotify' as MusicPlatform, name: 'Spotify', icon: spotifyIcon },
  { id: 'apple' as MusicPlatform, name: 'Apple Music', icon: appleIcon },
  { id: 'qqmusic' as MusicPlatform, name: 'QQ 音乐', icon: qqmusicIcon },
  { id: 'kugou' as MusicPlatform, name: '酷狗音乐', icon: kugouIcon },
  { id: 'echo' as MusicPlatform, name: 'EchoMusic', icon: echoIcon },
];

const strategies: Array<{ id: DisplayStrategy; title: string; description: string }> = [
  { id: 'stable', title: '稳定展示', description: '保持当前主岛' },
  { id: 'message', title: '消息优先', description: '通知到达时展开' },
  { id: 'rotation', title: '自动轮换', description: '循环展示内容' },
];

const displayStrategy = computed(() =>
  resolveDisplayStrategy(settingsStore.msgModeEnabled, settingsStore.enableRotation)
);
</script>

<style scoped src="./IslandSettingsPanel.css"></style>
