import { describe, expect, it, vi } from 'vitest';
import {
  createMusicPresentationIdentityTracker,
  initializeMusicActivity,
  resolveMusicStartupState,
  syncMusicActivity,
  type MusicActivityActions,
  type MusicInitializationActions,
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

describe('initializeMusicActivity', () => {
  it.each([
    { musicEnabled: true, rotationEnabled: false },
    { musicEnabled: false, rotationEnabled: true },
    { musicEnabled: true, rotationEnabled: true },
  ])('最终状态活跃时只启动最终目标播放器', async (state) => {
    const actions: MusicInitializationActions = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      setTargetPlayer: vi.fn().mockResolvedValue(undefined),
      resetPresentation: vi.fn(),
    };

    await initializeMusicActivity({ ...state, targetPlayer: 'qqmusic' }, actions);

    expect(actions.start).toHaveBeenCalledWith('qqmusic');
    expect(actions.stop).not.toHaveBeenCalled();
    expect(actions.setTargetPlayer).not.toHaveBeenCalled();
    expect(actions.resetPresentation).not.toHaveBeenCalled();
  });

  it('旧状态已启动但最终关闭时按顺序停止并同步最终目标', async () => {
    const calls: string[] = [];
    let finishTargetUpdate!: () => void;
    const targetUpdate = new Promise<void>((resolve) => {
      finishTargetUpdate = resolve;
    });
    const actions: MusicInitializationActions = {
      start: vi.fn(async (player: string) => {
        calls.push(`启动:${player}`);
      }),
      stop: vi.fn(() => {
        calls.push('停止');
      }),
      setTargetPlayer: vi.fn(async (player: string) => {
        calls.push(`切换:${player}`);
        await targetUpdate;
        calls.push('切换完成');
      }),
      resetPresentation: vi.fn(() => {
        calls.push('重置展示');
      }),
    };

    await initializeMusicActivity(
      { musicEnabled: true, rotationEnabled: false, targetPlayer: 'netease' },
      actions
    );
    const finalInitialization = initializeMusicActivity(
      { musicEnabled: false, rotationEnabled: false, targetPlayer: 'qqmusic' },
      actions
    );

    expect(calls).toEqual(['启动:netease', '停止', '切换:qqmusic']);
    expect(actions.start).toHaveBeenCalledTimes(1);
    expect(actions.start).not.toHaveBeenCalledWith('qqmusic');
    expect(actions.resetPresentation).not.toHaveBeenCalled();

    finishTargetUpdate();
    await finalInitialization;

    expect(calls).toEqual(['启动:netease', '停止', '切换:qqmusic', '切换完成', '重置展示']);
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

describe('resolveMusicStartupState', () => {
  it('监听注册期间未收到事件时采用最新持久化设置', () => {
    const persistedState = {
      musicEnabled: true,
      rotationEnabled: true,
      targetPlayer: 'qqmusic',
    };

    expect(
      resolveMusicStartupState(
        {
          musicEnabled: false,
          rotationEnabled: false,
          targetPlayer: 'netease',
        },
        persistedState,
        {
          musicEnabled: false,
          rotationEnabled: false,
          targetPlayer: false,
        }
      )
    ).toEqual(persistedState);
  });

  it('监听注册期间收到目标播放器事件时保留事件值', () => {
    expect(
      resolveMusicStartupState(
        {
          musicEnabled: false,
          rotationEnabled: false,
          targetPlayer: 'kugou',
        },
        {
          musicEnabled: true,
          rotationEnabled: true,
          targetPlayer: 'qqmusic',
        },
        {
          musicEnabled: false,
          rotationEnabled: false,
          targetPlayer: true,
        }
      )
    ).toEqual({
      musicEnabled: true,
      rotationEnabled: true,
      targetPlayer: 'kugou',
    });
  });

  it('监听注册期间收到音乐与轮换事件时保留事件值', () => {
    expect(
      resolveMusicStartupState(
        {
          musicEnabled: false,
          rotationEnabled: true,
          targetPlayer: 'netease',
        },
        {
          musicEnabled: true,
          rotationEnabled: false,
          targetPlayer: 'qqmusic',
        },
        {
          musicEnabled: true,
          rotationEnabled: true,
          targetPlayer: false,
        }
      )
    ).toEqual({
      musicEnabled: false,
      rotationEnabled: true,
      targetPlayer: 'qqmusic',
    });
  });
});
