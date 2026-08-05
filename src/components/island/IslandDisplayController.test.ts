import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ClaudeStatusSnapshot, CodexStatusSnapshot } from '@/shared/ipc/contracts';
import IslandDisplayController from './IslandDisplayController.vue';

const noopTransition = (_el: Element, done: () => void) => done();

const codexSnapshot: CodexStatusSnapshot = {
  revision: 3,
  generatedAtMs: 1_784_001_234_567,
  tasks: [
    {
      sessionId: 'session-1',
      source: 'cli',
      phase: 'running_tests',
      projectName: 'CodePulse',
      taskSummary: '验证状态岛',
      operationSummary: 'pnpm run test',
      lastActivityAtMs: 1_784_001_234_500,
    },
  ],
  representativeTask: {
    sessionId: 'session-1',
    source: 'cli',
    phase: 'running_tests',
    projectName: 'CodePulse',
    taskSummary: '验证状态岛',
    operationSummary: 'pnpm run test',
    lastActivityAtMs: 1_784_001_234_500,
  },
  hasWaitingApproval: false,
  hasFailedTask: false,
  listenerStatus: 'running',
};

const claudeSnapshot: ClaudeStatusSnapshot = {
  revision: 1,
  generatedAtMs: 1_784_001_234_567,
  sessions: [
    {
      taskKey: 'claude:session:session-1',
      sessionId: 'session-1',
      phase: 'analyzing',
      effectivePhase: 'editing',
      projectName: 'CodePulse',
      children: [],
      lastActivityAtMs: 1_784_001_234_500,
    },
  ],
  representativeSession: null,
  hasWaitingApproval: false,
  hasFailedTask: false,
  listenerStatus: 'running',
};

const baseProps = {
  display: 'network' as const,
  mode: 'compact' as const,
  network: {
    uploadSpeed: '12 KB/s',
    downloadSpeed: '34 KB/s',
    isHighUpload: false,
    isHighDownload: false,
  },
  hardware: {
    cpuUsage: 12,
    memUsage: 45,
  },
  music: {
    boxKey: 0,
    isPlaying: false,
    coverUrl: '',
    currentTrackInfo: '未在播放歌曲',
    currentSongName: '未在播放歌曲',
    currentArtistName: '网易云音乐',
    lyricsStatus: 'idle' as const,
    currentLyricText: '',
    nextLyricText: '',
    progressVisible: true,
    positionMs: 10_000,
    durationMs: 269_000,
    seekPending: false,
    seekFailureId: 0,
  },
  notification: {
    icon: '/icon.png',
    title: '通知',
    body: '正文',
  },
  systemToast: {
    text: '提示',
    type: 'app' as const,
  },
  codex: codexSnapshot,
  claude: claudeSnapshot,
  innerEnterTransition: noopTransition,
  innerLeaveTransition: noopTransition,
};

describe('IslandDisplayController', () => {
  it('紧凑模式不渲染详情面板', () => {
    const wrapper = mount(IslandDisplayController, {
      props: baseProps,
    });

    expect(wrapper.find('.speed-box').exists()).toBe(true);
    expect(wrapper.find('.detail-panel').exists()).toBe(false);
  });

  it('详情模式渲染对应模块详情', () => {
    const wrapper = mount(IslandDisplayController, {
      props: {
        ...baseProps,
        mode: 'detail',
      },
    });

    expect(wrapper.find('.detail-panel').exists()).toBe(true);
    expect(wrapper.text()).toContain('实时网络状态');
  });

  it.each(['compact', 'detail'] as const)('硬件模块在%s模式只显示真实 CPU 和内存', (mode) => {
    const wrapper = mount(IslandDisplayController, {
      props: {
        ...baseProps,
        display: 'hardware',
        mode,
      },
    });

    expect(wrapper.text()).toContain('CPU');
    expect(wrapper.text()).toContain('RAM');
    expect(wrapper.text()).not.toContain('GPU');
    expect(wrapper.findAll('.resource-bar-fill')).toHaveLength(2);
  });

  it('音乐模块透传当前歌词', () => {
    const wrapper = mount(IslandDisplayController, {
      props: {
        ...baseProps,
        display: 'music',
        music: {
          ...baseProps.music,
          lyricsStatus: 'ready',
          currentLyricText: '故事的小黄花',
          nextLyricText: '从出生那年就飘着',
        },
      },
    });

    expect(wrapper.text()).toContain('故事的小黄花');
  });

  it('音乐模块透传歌词重连状态', () => {
    const wrapper = mount(IslandDisplayController, {
      props: {
        ...baseProps,
        display: 'music',
        mode: 'detail',
        music: {
          ...baseProps.music,
          lyricsStatus: 'retrying',
        },
      },
    });

    expect(wrapper.text()).toContain('歌词服务重连中…');
  });

  it.each([
    ['上一首', 'prev-track'],
    ['播放或暂停', 'toggle-play'],
    ['下一首', 'next-track'],
  ] as const)('音乐模块透传%s控制事件', async (ariaLabel, eventName) => {
    const wrapper = mount(IslandDisplayController, {
      props: {
        ...baseProps,
        display: 'music',
        mode: 'detail',
      },
    });

    await wrapper.find(`[aria-label="${ariaLabel}"]`).trigger('click');

    expect(wrapper.emitted(eventName)).toHaveLength(1);
  });

  it('音乐模块透传跳转播放位置事件', async () => {
    const wrapper = mount(IslandDisplayController, {
      props: {
        ...baseProps,
        display: 'music',
        mode: 'detail',
      },
    });
    const slider = wrapper.get<HTMLInputElement>('input[type="range"]');

    slider.element.value = '42000';
    await slider.trigger('input');
    await slider.trigger('change');

    expect(wrapper.emitted('seek-to')).toEqual([[42_000]]);
  });

  it('Codex 模块渲染真实的紧凑态内容', () => {
    const wrapper = mount(IslandDisplayController, {
      props: {
        ...baseProps,
        display: 'codex',
      },
    });

    expect(wrapper.get('.codex-compact-phase').text()).toBe('运行测试');
    expect(wrapper.text()).toContain('CodePulse');
  });

  it('Codex 模块将脱敏操作摘要显示偏好透传给详情内容', () => {
    const wrapper = mount(IslandDisplayController, {
      props: {
        ...baseProps,
        display: 'codex',
        mode: 'detail',
        showCodexOperationSummary: false,
      },
    });

    expect(wrapper.find('.codex-task-operation').exists()).toBe(false);
  });

  it('Claude 模块渲染独立的根会话紧凑态', () => {
    const wrapper = mount(IslandDisplayController, {
      props: {
        ...baseProps,
        display: 'claude',
      },
    });

    expect(wrapper.get('.claude-compact-phase').text()).toBe('修改代码');
    expect(wrapper.text()).toContain('CodePulse');
  });
});
