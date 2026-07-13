import { describe, expect, it, vi } from 'vitest';
import {
  createMusicPresentationIdentityTracker,
  syncMusicActivity,
  type MusicActivityActions,
} from './musicActivity';

const createActions = (): MusicActivityActions => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  resetPresentation: vi.fn(),
});

describe('syncMusicActivity', () => {
  it.each([
    { musicEnabled: true, rotationEnabled: false },
    { musicEnabled: false, rotationEnabled: true },
    { musicEnabled: true, rotationEnabled: true },
  ])('任一音乐入口活跃时启动播放器会话', async (state) => {
    const actions = createActions();

    await syncMusicActivity({ ...state, targetPlayer: 'qqmusic' }, actions);

    expect(actions.start).toHaveBeenCalledWith('qqmusic');
    expect(actions.stop).not.toHaveBeenCalled();
    expect(actions.resetPresentation).not.toHaveBeenCalled();
  });

  it('音乐控制和轮换均关闭时停止会话并重置展示', async () => {
    const actions = createActions();

    await syncMusicActivity(
      { musicEnabled: false, rotationEnabled: false, targetPlayer: 'qqmusic' },
      actions
    );

    expect(actions.start).not.toHaveBeenCalled();
    expect(actions.stop).toHaveBeenCalledTimes(1);
    expect(actions.resetPresentation).toHaveBeenCalledTimes(1);
  });

  it('音乐关闭但轮换开启时不停会话，最后关闭轮换才停止且可重新启动', async () => {
    const actions = createActions();

    await syncMusicActivity(
      { musicEnabled: true, rotationEnabled: true, targetPlayer: 'netease' },
      actions
    );
    await syncMusicActivity(
      { musicEnabled: false, rotationEnabled: true, targetPlayer: 'netease' },
      actions
    );
    expect(actions.stop).not.toHaveBeenCalled();

    await syncMusicActivity(
      { musicEnabled: false, rotationEnabled: false, targetPlayer: 'netease' },
      actions
    );
    await syncMusicActivity(
      { musicEnabled: true, rotationEnabled: false, targetPlayer: 'netease' },
      actions
    );

    expect(actions.stop).toHaveBeenCalledTimes(1);
    expect(actions.resetPresentation).toHaveBeenCalledTimes(1);
    expect(actions.start).toHaveBeenCalledTimes(3);
  });
});

describe('createMusicPresentationIdentityTracker', () => {
  it('短暂空快照后恢复同一歌曲不会触发新的内容切换', () => {
    const tracker = createMusicPresentationIdentityTracker();

    expect(tracker.isNew('歌曲 A')).toBe(true);
    expect(tracker.isNew('')).toBe(false);
    expect(tracker.isNew('歌曲 A')).toBe(false);
    expect(tracker.isNew('歌曲 B')).toBe(true);
  });
});
