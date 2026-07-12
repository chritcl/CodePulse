import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MusicContent from './MusicContent.vue';

const baseProps = {
  isPlaying: true,
  coverUrl: '',
  currentTrackInfo: '晴天 - 周杰伦',
  currentSongName: '晴天',
  currentArtistName: '周杰伦',
  lyricsStatus: 'ready' as const,
  currentLyricText: '故事的小黄花',
  nextLyricText: '从出生那年就飘着',
  isMusicExpanded: false,
};

describe('MusicContent', () => {
  it('紧凑态优先显示当前歌词', () => {
    const wrapper = mount(MusicContent, {
      props: baseProps,
    });

    expect(wrapper.find('.single-line').text()).toContain('故事的小黄花');
  });

  it('无当前歌词时紧凑态回退显示歌曲信息', () => {
    const wrapper = mount(MusicContent, {
      props: {
        ...baseProps,
        currentLyricText: '',
      },
    });

    expect(wrapper.find('.single-line').text()).toContain('晴天 - 周杰伦');
  });

  it('展开态显示标题作者歌词并保留播放控制', () => {
    const wrapper = mount(MusicContent, {
      props: {
        ...baseProps,
        isMusicExpanded: true,
      },
    });

    expect(wrapper.find('.song-title').text()).toBe('晴天');
    expect(wrapper.find('.song-artist').text()).toBe('周杰伦');
    expect(wrapper.find('.current-lyric').text()).toContain('故事的小黄花');
    expect(wrapper.find('.next-lyric').text()).toContain('从出生那年就飘着');
    expect(wrapper.findAll('.ctl-btn')).toHaveLength(3);
  });

  it.each([
    ['ready', '等待歌词开始…'],
    ['loading', '正在加载歌词…'],
    ['not_found', '未找到可同步歌词'],
    ['error', '歌词服务暂不可用'],
  ] as const)('展开态显示 %s 的歌词状态', (lyricsStatus, expectedText) => {
    const wrapper = mount(MusicContent, {
      props: {
        ...baseProps,
        lyricsStatus,
        currentLyricText: '',
        nextLyricText: '',
        isMusicExpanded: true,
      },
    });

    expect(wrapper.find('.current-lyric').text()).toBe(expectedText);
    expect(wrapper.find('.next-lyric').exists()).toBe(false);
  });
});
