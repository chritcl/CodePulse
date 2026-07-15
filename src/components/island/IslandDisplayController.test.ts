import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import IslandDisplayController from './IslandDisplayController.vue';

const noopTransition = (_el: Element, done: () => void) => done();

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
    cpuUsage: '12%',
    gpuUsage: '23%',
    memUsage: '45%',
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
});
