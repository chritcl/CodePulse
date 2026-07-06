import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import IslandStatusIndicator from './IslandStatusIndicator.vue';

describe('IslandStatusIndicator', () => {
  it('播放音乐时按真实频谱渲染 5 个柱子', () => {
    const wrapper = mount(IslandStatusIndicator, {
      props: {
        showMusicSpectrum: true,
        isPlaying: true,
        isMusicExpanded: false,
        networkStatus: 'good',
        spectrumData: [0.4, 0.5, 0.6, 0.7, 0.8],
      },
    });

    const bars = wrapper.findAll('.bar');
    expect(bars).toHaveLength(5);
    expect(bars[0].attributes('style')).toContain('scaleY(0.4)');
    expect(bars[4].attributes('style')).toContain('scaleY(0.8)');
  });

  it('暂停音乐时频谱回落到最低高度', () => {
    const wrapper = mount(IslandStatusIndicator, {
      props: {
        showMusicSpectrum: true,
        isPlaying: false,
        isMusicExpanded: false,
        networkStatus: 'good',
        spectrumData: [0.7, 0.7, 0.7, 0.7, 0.7],
      },
    });

    const bars = wrapper.findAll('.bar');
    expect(bars).toHaveLength(5);
    for (const bar of bars) {
      expect(bar.attributes('style')).toContain('scaleY(0.35)');
    }
  });

  it('展开音乐岛时仍保持频谱结构', () => {
    const wrapper = mount(IslandStatusIndicator, {
      props: {
        showMusicSpectrum: true,
        isPlaying: true,
        isMusicExpanded: true,
        networkStatus: 'good',
        spectrumData: [0.4, 0.5, 0.6, 0.7, 0.8],
      },
    });

    expect(wrapper.find('.audio-spectrum').classes()).toContain('expanded');
    expect(wrapper.findAll('.bar')).toHaveLength(5);
  });

  it('不展示音乐频谱时显示网络状态灯', () => {
    const wrapper = mount(IslandStatusIndicator, {
      props: {
        showMusicSpectrum: false,
        isPlaying: true,
        isMusicExpanded: false,
        networkStatus: 'warning',
        spectrumData: [0.4, 0.5, 0.6, 0.7, 0.8],
      },
    });

    expect(wrapper.find('.status-dot.warning').exists()).toBe(true);
    expect(wrapper.findAll('.bar')).toHaveLength(0);
  });
});
