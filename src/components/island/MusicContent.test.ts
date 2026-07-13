import { mount, shallowMount } from '@vue/test-utils';
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
  it('将展开歌词交给独立面板渲染', () => {
    const wrapper = shallowMount(MusicContent, {
      props: {
        ...baseProps,
        isMusicExpanded: true,
      },
    });

    expect(wrapper.find('music-lyrics-panel-stub').exists()).toBe(true);
  });

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

  it('点击内容区请求展开音乐面板', async () => {
    const wrapper = mount(MusicContent, { props: baseProps });

    await wrapper.find('.music-ctl-box').trigger('click');

    expect(wrapper.emitted('expand-music')).toHaveLength(1);
  });

  it('播放时旋转封面并显示封面图片', () => {
    const wrapper = mount(MusicContent, {
      props: {
        ...baseProps,
        coverUrl: 'https://example.com/cover.jpg',
      },
    });

    expect(wrapper.find('.album-cover').classes()).toContain('is-playing');
    expect(wrapper.find('.cover-inner').attributes('style')).toContain(
      'https://example.com/cover.jpg'
    );
  });

  it('紧凑文本溢出时启用往返滚动', async () => {
    const wrapper = mount(MusicContent, { props: baseProps });
    const maskBox = wrapper.find('.music-info-mask-box').element;
    const textInner = wrapper.find('.scroll-inner').element;
    Object.defineProperty(maskBox, 'clientWidth', { configurable: true, value: 40 });
    Object.defineProperty(textInner, 'scrollWidth', { configurable: true, value: 140 });

    await wrapper.setProps({ currentLyricText: '新的长歌词会触发重新测量' });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.scroll-inner').classes()).toContain('is-scrolling');
    expect(wrapper.find('.scroll-inner').attributes('style')).toContain('--scroll-dist: 112px');
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

  it('播放控制按钮提供无障碍名称', () => {
    const wrapper = mount(MusicContent, {
      props: {
        ...baseProps,
        isMusicExpanded: true,
      },
    });

    expect(wrapper.find('[aria-label="上一首"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="播放或暂停"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="下一首"]').exists()).toBe(true);
  });

  it.each([
    ['上一首', 'prev-track'],
    ['播放或暂停', 'toggle-play'],
    ['下一首', 'next-track'],
  ] as const)('点击%s按钮发送 %s 事件', async (ariaLabel, eventName) => {
    const wrapper = mount(MusicContent, {
      props: {
        ...baseProps,
        isMusicExpanded: true,
      },
    });

    await wrapper.find(`[aria-label="${ariaLabel}"]`).trigger('click');

    expect(wrapper.emitted(eventName)).toHaveLength(1);
    expect(wrapper.emitted('expand-music')).toBeUndefined();
  });

  it.each([
    ['ready', '等待歌词开始…'],
    ['loading', '正在加载歌词…'],
    ['not_found', '未找到可同步歌词'],
    ['retrying', '歌词服务重连中…'],
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
