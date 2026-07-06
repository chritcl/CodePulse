/**
 * 设置 Store
 *
 * 管理应用设置状态，提供统一的设置读写接口。
 * 当前阶段使用 localStorage 作为后端，R5 阶段迁移到 Rust 存储。
 */

import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { ThemeMode, IslandTheme, MusicPlatform } from '@/types';
import {
  readBoolean,
  readEnum,
  readNumber,
  writeBoolean,
  writeNumber,
  writeString,
} from '@/shared/utils/storage';

const THEME_MODES = ['light', 'dark', 'system'] as const;
const ISLAND_THEMES = ['black', 'white'] as const;
const MUSIC_PLATFORMS = ['netease', 'spotify', 'apple', 'qqmusic', 'kugou', 'echo'] as const;

export const useSettingsStore = defineStore('settings', () => {
  // ============================================================
  // 状态
  // ============================================================

  /** 主题模式 */
  const themeMode = ref<ThemeMode>(readEnum('nsd_theme_mode', 'light', THEME_MODES));

  /** 灵动岛主题 */
  const islandTheme = ref<IslandTheme>(readEnum('nsd_island_theme', 'black', ISLAND_THEMES));

  /** 灵动岛透明度 */
  const opacity = ref(readNumber('nsd_island_opacity', 100));

  /** 置于任务栏 */
  const pinToTaskbar = ref(readBoolean('nsd_pin_taskbar'));

  /** 开机自启动 */
  const autoStart = ref(false);

  /** 音乐控制平台 */
  const targetPlayer = ref<MusicPlatform>(
    readEnum('nsd_target_player', 'netease', MUSIC_PLATFORMS)
  );

  /** 音乐控制器开关 */
  const enableMusicCtrl = ref(readBoolean('nsd_music_ctrl'));

  /** 消息通知开关 */
  const enableMsgNotify = ref(readBoolean('nsd_msg_notify'));

  /** 硬件监控开关 */
  const enableHardwareMon = ref(readBoolean('nsd_hardware_mon'));

  /** 消息模式开关 */
  const msgModeEnabled = ref(readBoolean('nsd_msg_mode'));

  /** 轮换模式开关 */
  const enableRotation = ref(readBoolean('nsd_rotation_mode'));

  // ============================================================
  // 持久化监听
  // ============================================================

  /** 主题变更时持久化 */
  watch(themeMode, (val) => {
    writeString('nsd_theme_mode', val);
  });

  /** 灵动岛主题变更时持久化 */
  watch(islandTheme, (val) => {
    writeString('nsd_island_theme', val);
  });

  /** 透明度变更时持久化 */
  watch(opacity, (val) => {
    writeNumber('nsd_island_opacity', val);
  });

  /** 任务栏停靠变更时持久化 */
  watch(pinToTaskbar, (val) => {
    writeBoolean('nsd_pin_taskbar', val);
  });

  /** 音乐平台变更时持久化 */
  watch(targetPlayer, (val) => {
    writeString('nsd_target_player', val);
  });

  /** 音乐控制器变更时持久化 */
  watch(enableMusicCtrl, (val) => {
    writeBoolean('nsd_music_ctrl', val);
  });

  /** 消息通知变更时持久化 */
  watch(enableMsgNotify, (val) => {
    writeBoolean('nsd_msg_notify', val);
  });

  /** 硬件监控变更时持久化 */
  watch(enableHardwareMon, (val) => {
    writeBoolean('nsd_hardware_mon', val);
  });

  /** 消息模式变更时持久化 */
  watch(msgModeEnabled, (val) => {
    writeBoolean('nsd_msg_mode', val);
  });

  /** 轮换模式变更时持久化 */
  watch(enableRotation, (val) => {
    writeBoolean('nsd_rotation_mode', val);
  });

  // ============================================================
  // 方法
  // ============================================================

  /** 设置主题模式 */
  const setThemeMode = (mode: ThemeMode) => {
    themeMode.value = mode;
  };

  /** 设置灵动岛主题 */
  const setIslandTheme = (theme: IslandTheme) => {
    islandTheme.value = theme;
  };

  /** 设置透明度 */
  const setOpacity = (value: number) => {
    opacity.value = value;
  };

  /** 切换任务栏停靠 */
  const togglePinTaskbar = () => {
    pinToTaskbar.value = !pinToTaskbar.value;
  };

  /** 设置音乐平台 */
  const setTargetPlayer = (player: MusicPlatform) => {
    targetPlayer.value = player;
  };

  /** 切换音乐控制器 */
  const toggleMusicCtrl = () => {
    enableMusicCtrl.value = !enableMusicCtrl.value;
  };

  /** 切换消息通知 */
  const toggleMsgNotify = () => {
    enableMsgNotify.value = !enableMsgNotify.value;
  };

  /** 切换硬件监控 */
  const toggleHardwareMon = () => {
    enableHardwareMon.value = !enableHardwareMon.value;
  };

  /** 切换消息模式 */
  const toggleMsgMode = () => {
    msgModeEnabled.value = !msgModeEnabled.value;
  };

  /** 切换轮换模式 */
  const toggleRotation = () => {
    enableRotation.value = !enableRotation.value;
  };

  /** 设置自启动状态 */
  const setAutoStart = (value: boolean) => {
    autoStart.value = value;
  };

  // ============================================================
  // 导出
  // ============================================================

  return {
    // 状态
    themeMode,
    islandTheme,
    opacity,
    pinToTaskbar,
    autoStart,
    targetPlayer,
    enableMusicCtrl,
    enableMsgNotify,
    enableHardwareMon,
    msgModeEnabled,
    enableRotation,

    // 方法
    setThemeMode,
    setIslandTheme,
    setOpacity,
    togglePinTaskbar,
    setTargetPlayer,
    toggleMusicCtrl,
    toggleMsgNotify,
    toggleHardwareMon,
    toggleMsgMode,
    toggleRotation,
    setAutoStart,
  };
});
