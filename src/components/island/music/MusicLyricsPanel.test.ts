import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MusicLyricsPanel from './MusicLyricsPanel.vue';

const baseProps = {
  lyricsStatus: 'ready' as const,
  currentLyricText: '故事的小黄花',
  nextLyricText: '从出生那年就飘着',
  fallbackText: '晴天 - 周杰伦',
};

describe('MusicLyricsPanel', () => {
  it('就绪时显示当前歌词与下一句歌词', () => {
    const wrapper = mount(MusicLyricsPanel, { props: baseProps });

    expect(wrapper.find('.current-lyric').text()).toBe('故事的小黄花');
    expect(wrapper.find('.next-lyric').text()).toBe('从出生那年就飘着');
  });

  it.each([
    ['idle', '晴天 - 周杰伦'],
    ['loading', '正在加载歌词…'],
    ['ready', '等待歌词开始…'],
    ['not_found', '未找到可同步歌词'],
    ['retrying', '歌词服务重连中…'],
    ['error', '歌词服务暂不可用'],
  ] as const)('%s 状态显示对应占位文案', (lyricsStatus, expectedText) => {
    const wrapper = mount(MusicLyricsPanel, {
      props: {
        ...baseProps,
        lyricsStatus,
        currentLyricText: '',
        nextLyricText: '',
      },
    });

    expect(wrapper.find('.current-lyric').text()).toBe(expectedText);
    expect(wrapper.find('.current-lyric').classes()).toContain('is-fallback');
    expect(wrapper.find('.next-lyric').exists()).toBe(false);
  });
});
