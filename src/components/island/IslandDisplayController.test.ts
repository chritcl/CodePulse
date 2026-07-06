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
});
