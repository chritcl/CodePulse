import type { MusicPlatform } from '@/types';
import { readEnum } from '@/shared/utils/storage';

export const MUSIC_PLATFORMS = ['netease', 'spotify', 'apple', 'qqmusic', 'kugou', 'echo'] as const;

const PLAYER_NAMES: Record<MusicPlatform, string> = {
  netease: '网易云音乐',
  spotify: 'Spotify',
  apple: 'Apple Music',
  qqmusic: 'QQ音乐',
  kugou: '酷狗音乐',
  echo: 'Echo Music',
};

/** 归一化音乐平台，非法值统一回退到网易云 */
export const normalizeTargetPlayer = (player: string | null | undefined): MusicPlatform => {
  if (player && MUSIC_PLATFORMS.includes(player as MusicPlatform)) {
    return player as MusicPlatform;
  }
  return 'netease';
};

/** 读取当前持久化的音乐平台 */
export const readTargetPlayer = (): MusicPlatform =>
  readEnum('nsd_target_player', 'netease', MUSIC_PLATFORMS);

/** 获取音乐平台显示名称 */
export const getPlayerName = (player: MusicPlatform = readTargetPlayer()): string =>
  PLAYER_NAMES[player] ?? PLAYER_NAMES.netease;
