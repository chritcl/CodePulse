import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  animationCommands,
  claudeCommands,
  codexCommands,
  mediaCommands,
  notificationCommands,
  systemCommands,
  windowCommands,
} from './index';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('媒体 IPC 命令封装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过统一命令封装读取播放快照', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);

    await mediaCommands.getMusicPlaybackState();

    expect(invoke).toHaveBeenCalledWith('get_music_playback_state');
  });

  it('歌词请求保持 Rust 命令需要的扁平参数', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'not_found', lines: [] });

    await mediaCommands.getLyricsForTrack({ title: '晴天', artist: '周杰伦' });

    expect(invoke).toHaveBeenCalledWith('get_lyrics_for_track', {
      title: '晴天',
      artist: '周杰伦',
    });
  });

  it('通过统一命令封装读取歌曲封面', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('data:image/png;base64,cover');

    await mediaCommands.getRandomCoverUrl('晴天', '周杰伦');

    expect(invoke).toHaveBeenCalledWith('get_random_cover_url', {
      songName: '晴天',
      artistName: '周杰伦',
    });
  });

  it('通过统一命令封装跳转播放位置', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);

    await mediaCommands.seekSystemMedia(42_000);

    expect(invoke).toHaveBeenCalledWith('seek_system_media', {
      positionMs: 42_000,
    });
  });
});

describe('窗口 IPC 命令封装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过统一命令封装启动原生拖拽并传递稳定尺寸', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await windowCommands.startIslandDrag({
      targetWidth: 420,
      targetHeight: 206,
      isPinned: false,
    });

    expect(invoke).toHaveBeenCalledWith('start_island_drag', {
      targetWidth: 420,
      targetHeight: 206,
      isPinned: false,
    });
  });
});

describe('系统 IPC 命令封装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('使用后端注册的系统监控命令名称', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([100, 20])
      .mockResolvedValueOnce([35, 8_000, 16_000])
      .mockResolvedValueOnce(42);

    await systemCommands.getNetworkStats();
    await systemCommands.getHardwareStats();
    await systemCommands.getNetworkLatency();

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_network_stats');
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_hardware_stats');
    expect(invoke).toHaveBeenNthCalledWith(3, 'get_network_latency');
  });

  it('通过统一命令封装读取最新通知', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);

    await notificationCommands.fetchLatestNotification();

    expect(invoke).toHaveBeenCalledWith('fetch_latest_notification');
  });
});

describe('动画 IPC 命令封装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('传递窗口动画起终尺寸、停靠状态和时长', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await animationCommands.startIslandAnimation({
      startWidth: 260,
      startHeight: 42,
      targetWidth: 420,
      targetHeight: 182,
      isPinned: false,
      durationMs: 280,
    });

    expect(invoke).toHaveBeenCalledWith('start_island_animation', {
      startWidth: 260,
      startHeight: 42,
      targetWidth: 420,
      targetHeight: 182,
      isPinned: false,
      durationMs: 280,
    });
  });
});

describe('Codex 状态 IPC 命令封装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过统一命令封装读取 Codex 状态快照', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      revision: 1,
      generatedAtMs: 1_784_001_234_567,
      tasks: [],
      representativeTask: null,
      hasWaitingApproval: false,
      hasFailedTask: false,
      listenerStatus: 'waiting_for_event',
    });

    await codexCommands.getStatusSnapshot();

    expect(invoke).toHaveBeenCalledWith('get_codex_status_snapshot');
  });

  it('通过统一命令封装清除指定的失败任务', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);

    await codexCommands.clearFailedTask('session-1');

    expect(invoke).toHaveBeenCalledWith('clear_failed_codex_task', {
      sessionId: 'session-1',
    });
  });

  it('通过统一命令封装同步任务摘要捕获偏好', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await codexCommands.setTaskSummaryCapture(true);

    expect(invoke).toHaveBeenCalledWith('set_codex_task_summary_capture', {
      enabled: true,
    });
  });

  it('通过统一命令封装读取 Codex Hook 集成检查结果', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      selectedConfig: 'hooks_json',
      globalHooks: 'enabled',
      hook: 'waiting_trust',
      bridge: 'ready',
      codexHomeExists: true,
      selectedConfigFile: 'C:\\Users\\tester\\.codex\\hooks.json',
      bridgeFile: 'C:\\Users\\tester\\AppData\\Roaming\\CodePulse\\codepulse-codex-bridge.exe',
      message: null,
    });

    await codexCommands.getIntegrationStatus();

    expect(invoke).toHaveBeenCalledWith('get_codex_integration_status');
  });

  it('通过统一命令封装生成指定动作的 Codex 集成预览', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: 'preview-1' });

    await codexCommands.previewIntegration('install_or_repair');

    expect(invoke).toHaveBeenCalledWith('preview_codex_integration', {
      action: 'install_or_repair',
    });
  });

  it('通过统一命令封装确认已生成的 Codex 集成预览', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ action: 'uninstall' });

    await codexCommands.confirmIntegration('preview-1');

    expect(invoke).toHaveBeenCalledWith('confirm_codex_integration', {
      previewId: 'preview-1',
    });
  });
});

describe('Claude Code 状态 IPC 命令封装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过统一命令封装读取状态、清除失败项并同步摘要偏好', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ sessions: [] })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined);

    await claudeCommands.getStatusSnapshot();
    await claudeCommands.clearFailedTask('claude:task:session-1:task-1');
    await claudeCommands.setTaskSummaryCapture(true);

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_claude_status_snapshot');
    expect(invoke).toHaveBeenNthCalledWith(2, 'clear_failed_claude_task', {
      taskKey: 'claude:task:session-1:task-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'set_claude_task_summary_capture', {
      enabled: true,
    });
  });

  it('通过统一命令封装检查、预览并确认 Claude Code 集成', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ hook: 'not_installed' })
      .mockResolvedValueOnce({ id: 'preview-claude' })
      .mockResolvedValueOnce({ action: 'install_or_repair' });

    await claudeCommands.getIntegrationStatus();
    await claudeCommands.previewIntegration('install_or_repair');
    await claudeCommands.confirmIntegration('preview-claude');

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_claude_integration_status');
    expect(invoke).toHaveBeenNthCalledWith(2, 'preview_claude_integration', {
      action: 'install_or_repair',
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'confirm_claude_integration', {
      previewId: 'preview-claude',
    });
  });
});
