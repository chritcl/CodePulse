/**
 * 设置 Store
 *
 * 管理应用设置状态，提供统一的设置读写接口。
 * 当前阶段使用 localStorage 作为后端，R5 阶段迁移到 Rust 存储。
 */

import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { ThemeMode, IslandTheme, MusicPlatform } from '@/types';

export const useSettingsStore = defineStore('settings', () => {
  // ============================================================
  // 状态
  // ============================================================

  /** 主题模式 */
  const themeMode = ref<ThemeMode>(
    (localStorage.getItem('nsd_theme_mode') as ThemeMode) || 'light'
  );

  /** 灵动岛主题 */
  const islandTheme = ref<IslandTheme>(
    (localStorage.getItem('nsd_island_theme') as IslandTheme) || 'black'
  );

  /** 灵动岛透明度 */
  const opacity = ref(Number(localStorage.getItem('nsd_island_opacity') || '100'));

  /** 置于任务栏 */
  const pinToTaskbar = ref(localStorage.getItem('nsd_pin_taskbar') === 'true');

  /** 开机自启动 */
  const autoStart = ref(false);

  /** 音乐控制平台 */
  const targetPlayer = ref<MusicPlatform>(
    (localStorage.getItem('nsd_target_player') as MusicPlatform) || 'netease'
  );

  /** 音乐控制器开关 */
  const enableMusicCtrl = ref(localStorage.getItem('nsd_music_ctrl') === 'true');

  /** 消息通知开关 */
  const enableMsgNotify = ref(localStorage.getItem('nsd_msg_notify') === 'true');

  /** 硬件监控开关 */
  const enableHardwareMon = ref(localStorage.getItem('nsd_hardware_mon') === 'true');

  /** 消息模式开关 */
  const msgModeEnabled = ref(localStorage.getItem('nsd_msg_mode') === 'true');

  /** 轮换模式开关 */
  const enableRotation = ref(localStorage.getItem('nsd_rotation_mode') === 'true');

  // ============================================================
  // 持久化监听
  // ============================================================

  /** 主题变更时持久化 */
  watch(themeMode, (val) => {
    localStorage.setItem('nsd_theme_mode', val);
  });

  /** 灵动岛主题变更时持久化 */
  watch(islandTheme, (val) => {
    localStorage.setItem('nsd_island_theme', val);
  });

  /** 透明度变更时持久化 */
  watch(opacity, (val) => {
    localStorage.setItem('nsd_island_opacity', val.toString());
  });

  /** 任务栏停靠变更时持久化 */
  watch(pinToTaskbar, (val) => {
    localStorage.setItem('nsd_pin_taskbar', String(val));
  });

  /** 音乐平台变更时持久化 */
  watch(targetPlayer, (val) => {
    localStorage.setItem('nsd_target_player', val);
  });

  /** 音乐控制器变更时持久化 */
  watch(enableMusicCtrl, (val) => {
    localStorage.setItem('nsd_music_ctrl', String(val));
  });

  /** 消息通知变更时持久化 */
  watch(enableMsgNotify, (val) => {
    localStorage.setItem('nsd_msg_notify', String(val));
  });

  /** 硬件监控变更时持久化 */
  watch(enableHardwareMon, (val) => {
    localStorage.setItem('nsd_hardware_mon', String(val));
  });

  /** 消息模式变更时持久化 */
  watch(msgModeEnabled, (val) => {
    localStorage.setItem('nsd_msg_mode', String(val));
  });

  /** 轮换模式变更时持久化 */
  watch(enableRotation, (val) => {
    localStorage.setItem('nsd_rotation_mode', String(val));
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
