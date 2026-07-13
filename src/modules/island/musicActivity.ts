export interface MusicActivityState {
  musicEnabled: boolean;
  rotationEnabled: boolean;
  targetPlayer: string;
}

export interface MusicActivityActions {
  start: (player: string) => Promise<void>;
  stop: () => void;
  resetPresentation: () => void;
}

export type MusicStartupReceivedState = Record<keyof MusicActivityState, boolean>;

/** 启动期间已收到事件的字段保留当前值，其余字段采用最新持久化设置 */
export const resolveMusicStartupState = (
  current: MusicActivityState,
  persisted: MusicActivityState,
  received: MusicStartupReceivedState
): MusicActivityState => ({
  musicEnabled: received.musicEnabled ? current.musicEnabled : persisted.musicEnabled,
  rotationEnabled: received.rotationEnabled ? current.rotationEnabled : persisted.rotationEnabled,
  targetPlayer: received.targetPlayer ? current.targetPlayer : persisted.targetPlayer,
});

/** 根据音乐控制和轮换开关统一启停播放器会话 */
export const syncMusicActivity = async (
  state: MusicActivityState,
  actions: MusicActivityActions
): Promise<void> => {
  if (state.musicEnabled || state.rotationEnabled) {
    await actions.start(state.targetPlayer);
    return;
  }
  actions.stop();
  actions.resetPresentation();
};

/** 记录最后一个非空播放身份，只把真正的歌曲变化视为内容切换 */
export const createMusicPresentationIdentityTracker = () => {
  let lastIdentity = '';
  const isNew = (identity: string): boolean => {
    if (!identity || identity === lastIdentity) return false;
    lastIdentity = identity;
    return true;
  };
  return { isNew };
};
