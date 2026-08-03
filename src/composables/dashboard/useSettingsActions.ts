import { emit } from '@tauri-apps/api/event';
import { useIslandStore, useSettingsStore } from '@/stores';
import type { IslandTheme, MusicPlatform, ThemeMode } from '@/types';
import { SPRING_ANIMATION } from '@/shared/ipc';
import {
  createDisplayStrategyPatch,
  type DisplayStrategy,
} from '@/modules/dashboard/displayStrategy';
import {
  createSettingsActionCoordinator,
  type SettingsFeedbackHandler,
} from '@/modules/dashboard/settingsActionCoordinator';

type EmitEvent = (eventName: string, payload?: unknown) => Promise<void>;

interface SettingsActionsOptions {
  emitEvent?: EmitEvent;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

interface DisplaySettingsSnapshot {
  msgModeEnabled: boolean;
  enableRotation: boolean;
  enableMsgNotify: boolean;
}

const toggleMessage = (name: string, enabled: boolean) => `${name}已${enabled ? '开启' : '关闭'}`;

export function useSettingsActions(
  showFeedback: SettingsFeedbackHandler,
  options: SettingsActionsOptions = {}
) {
  const settingsStore = useSettingsStore();
  const islandStore = useIslandStore();
  const emitEvent: EmitEvent =
    options.emitEvent ?? ((eventName, payload) => emit(eventName, payload));
  const requestFrame = options.requestFrame ?? window.requestAnimationFrame.bind(window);
  const cancelFrame = options.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  const coordinator = createSettingsActionCoordinator(showFeedback);

  const setIslandVisible = (enabled: boolean) =>
    coordinator.apply({
      key: 'island-visible',
      getValue: () => islandStore.isVisible,
      setValue: islandStore.setVisibility,
      nextValue: enabled,
      sync: (next) => emitEvent('control-island-visibility', { show: next }),
      successMessage: toggleMessage('灵动岛', enabled),
      errorMessage: `无法${enabled ? '开启' : '关闭'}灵动岛`,
    });

  const setMusicEnabled = (enabled: boolean) =>
    coordinator.apply({
      key: 'music-enabled',
      getValue: () => settingsStore.enableMusicCtrl,
      setValue: (next) => {
        settingsStore.enableMusicCtrl = next;
      },
      nextValue: enabled,
      sync: (next) => emitEvent('control-music-ctl', { enabled: next }),
      successMessage: toggleMessage('音乐控制', enabled),
      errorMessage: `无法${enabled ? '开启' : '关闭'}音乐控制`,
    });

  const setNotificationsEnabled = (enabled: boolean) =>
    coordinator.apply({
      key: 'notifications-enabled',
      getValue: () => settingsStore.enableMsgNotify,
      setValue: (next) => {
        settingsStore.enableMsgNotify = next;
      },
      nextValue: enabled,
      sync: async () => {},
      successMessage: toggleMessage('消息通知', enabled),
      errorMessage: `无法${enabled ? '开启' : '关闭'}消息通知`,
    });

  const setHardwareEnabled = (enabled: boolean) =>
    coordinator.apply({
      key: 'hardware-enabled',
      getValue: () => settingsStore.enableHardwareMon,
      setValue: (next) => {
        settingsStore.enableHardwareMon = next;
      },
      nextValue: enabled,
      sync: (next) => emitEvent('control-hardware-mon', { enabled: next }),
      successMessage: toggleMessage('硬件监控', enabled),
      errorMessage: `无法${enabled ? '开启' : '关闭'}硬件监控`,
    });

  const setSpringAnimationEnabled = (enabled: boolean) =>
    coordinator.apply({
      key: 'spring-animation',
      getValue: () => settingsStore.enableSpringAnimation,
      setValue: (next) => {
        settingsStore.enableSpringAnimation = next;
      },
      nextValue: enabled,
      sync: (next) => emitEvent(SPRING_ANIMATION, { enabled: next }),
      successMessage: toggleMessage('弹簧动画', enabled),
      errorMessage: `无法${enabled ? '开启' : '关闭'}弹簧动画`,
    });

  const setTargetPlayer = (player: MusicPlatform) =>
    coordinator.apply({
      key: 'target-player',
      getValue: () => settingsStore.targetPlayer,
      setValue: settingsStore.setTargetPlayer,
      nextValue: player,
      sync: (next) => emitEvent('control-target-player', { player: next }),
      successMessage: '音乐平台已切换',
      errorMessage: '无法切换音乐平台',
    });

  const setIslandTheme = (theme: IslandTheme) =>
    coordinator.apply({
      key: 'island-theme',
      getValue: () => settingsStore.islandTheme,
      setValue: settingsStore.setIslandTheme,
      nextValue: theme,
      sync: (next) => emitEvent('control-island-theme', { theme: next }),
      successMessage: '灵动岛颜色已应用',
      errorMessage: '无法应用灵动岛颜色',
    });

  const setThemeMode = (mode: ThemeMode) =>
    coordinator.apply({
      key: 'theme-mode',
      getValue: () => settingsStore.themeMode,
      setValue: settingsStore.setThemeMode,
      nextValue: mode,
      sync: async () => {},
      successMessage: '界面主题已应用',
      errorMessage: '无法应用界面主题',
    });

  const setPinToTaskbar = (enabled: boolean) =>
    coordinator.apply({
      key: 'pin-taskbar',
      getValue: () => settingsStore.pinToTaskbar,
      setValue: (next) => {
        settingsStore.pinToTaskbar = next;
      },
      nextValue: enabled,
      sync: (next) => emitEvent('control-pin-taskbar', { enabled: next }),
      successMessage: enabled ? '已置于任务栏层级' : '已使用普通置顶层级',
      errorMessage: '无法更新窗口层级',
    });

  const setDisplayStrategy = (strategy: DisplayStrategy) => {
    const previous: DisplaySettingsSnapshot = {
      msgModeEnabled: settingsStore.msgModeEnabled,
      enableRotation: settingsStore.enableRotation,
      enableMsgNotify: settingsStore.enableMsgNotify,
    };
    const next = createDisplayStrategyPatch(strategy, previous.enableMsgNotify);
    const strategyLabels: Record<DisplayStrategy, string> = {
      stable: '稳定展示',
      message: '消息优先',
      rotation: '自动轮换',
    };

    return coordinator.apply<DisplaySettingsSnapshot>({
      key: 'display-strategy',
      getValue: () => ({
        msgModeEnabled: settingsStore.msgModeEnabled,
        enableRotation: settingsStore.enableRotation,
        enableMsgNotify: settingsStore.enableMsgNotify,
      }),
      setValue: (value) => {
        settingsStore.msgModeEnabled = value.msgModeEnabled;
        settingsStore.enableRotation = value.enableRotation;
        settingsStore.enableMsgNotify = value.enableMsgNotify;
      },
      nextValue: next,
      sync: async (value) => {
        try {
          await emitEvent('control-rotation-mode', { enabled: value.enableRotation });
          await emitEvent('control-msg-mode', { enabled: value.msgModeEnabled });
        } catch (error) {
          try {
            await emitEvent('control-rotation-mode', { enabled: previous.enableRotation });
            await emitEvent('control-msg-mode', { enabled: previous.msgModeEnabled });
          } catch {
            // 补偿同步失败时仍按原始错误回滚本地状态
          }
          throw error;
        }
      },
      successMessage: `展示策略已切换为${strategyLabels[strategy]}`,
      errorMessage: '无法切换展示策略',
    });
  };

  let lastSyncedOpacity = settingsStore.opacity;
  let pendingOpacity: number | null = null;
  let pendingOpacityGeneration = 0;
  let opacityFrame: number | null = null;
  let opacityGeneration = 0;
  let showOpacitySuccess = false;

  const flushOpacity = async () => {
    opacityFrame = null;
    if (pendingOpacity === null) return;

    const nextOpacity = pendingOpacity;
    const generation = pendingOpacityGeneration;
    pendingOpacity = null;
    const shouldShowSuccess = showOpacitySuccess;
    showOpacitySuccess = false;

    try {
      await emitEvent('control-island-opacity', { opacity: nextOpacity });
      if (generation !== opacityGeneration) return;
      lastSyncedOpacity = nextOpacity;
      if (shouldShowSuccess) {
        showFeedback({
          kind: 'success',
          message: `不透明度已调整为 ${nextOpacity}%`,
        });
      }
    } catch {
      if (generation !== opacityGeneration) return;
      settingsStore.setOpacity(lastSyncedOpacity);
      showFeedback({
        kind: 'error',
        message: '无法调整灵动岛不透明度',
      });
    }
  };

  const scheduleOpacity = (value: number, withSuccessFeedback: boolean) => {
    settingsStore.setOpacity(value);
    pendingOpacity = value;
    pendingOpacityGeneration = ++opacityGeneration;
    showOpacitySuccess ||= withSuccessFeedback;
    if (opacityFrame === null) {
      opacityFrame = requestFrame(() => {
        void flushOpacity();
      });
    }
  };

  const previewOpacity = (value: number) => {
    scheduleOpacity(value, false);
  };

  const commitOpacity = (value: number) => {
    scheduleOpacity(value, true);
  };

  const dispose = () => {
    opacityGeneration++;
    pendingOpacity = null;
    if (opacityFrame !== null) {
      cancelFrame(opacityFrame);
      opacityFrame = null;
    }
  };

  return {
    setIslandVisible,
    setMusicEnabled,
    setNotificationsEnabled,
    setHardwareEnabled,
    setSpringAnimationEnabled,
    setTargetPlayer,
    setIslandTheme,
    setThemeMode,
    setPinToTaskbar,
    setDisplayStrategy,
    previewOpacity,
    commitOpacity,
    dispose,
  };
}
