export type IslandDisplayKind =
  'agent' | 'wechat' | 'notification' | 'hardware' | 'music' | 'network';

export interface IslandDisplayInput {
  agentActive?: boolean;
  wechatActive?: boolean;
  notificationActive?: boolean;
  rotationEnabled: boolean;
  rotationIndex: number;
  musicEnabled: boolean;
  hardwareEnabled: boolean;
}

const ROTATION_DISPLAYS: IslandDisplayKind[] = ['network', 'music', 'hardware'];

/** 解析灵动岛当前应展示的内容类型 */
export function resolveIslandDisplay(input: IslandDisplayInput): IslandDisplayKind {
  if (input.agentActive) return 'agent';
  if (input.wechatActive) return 'wechat';
  if (input.notificationActive) return 'notification';

  if (input.rotationEnabled) {
    const safeIndex = Math.abs(input.rotationIndex) % ROTATION_DISPLAYS.length;
    return ROTATION_DISPLAYS[safeIndex];
  }

  if (input.hardwareEnabled) return 'hardware';
  if (input.musicEnabled) return 'music';

  return 'network';
}
