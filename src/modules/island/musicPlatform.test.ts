import { beforeEach, describe, expect, it } from 'vitest';
import { getPlayerName, readTargetPlayer } from './musicPlatform';

describe('musicPlatform', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('缺失平台设置时回退到网易云', () => {
    expect(readTargetPlayer()).toBe('netease');
    expect(getPlayerName()).toBe('网易云音乐');
  });

  it('非法平台设置时回退到网易云', () => {
    localStorage.setItem('nsd_target_player', 'invalid-player');

    expect(readTargetPlayer()).toBe('netease');
    expect(getPlayerName()).toBe('网易云音乐');
  });

  it('读取合法平台设置并返回对应显示名称', () => {
    localStorage.setItem('nsd_target_player', 'spotify');

    expect(readTargetPlayer()).toBe('spotify');
    expect(getPlayerName()).toBe('Spotify');
  });
});
