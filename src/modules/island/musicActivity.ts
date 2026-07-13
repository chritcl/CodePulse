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
