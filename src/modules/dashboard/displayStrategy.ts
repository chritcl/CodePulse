export type DisplayStrategy = 'stable' | 'message' | 'rotation';

export interface DisplayStrategyPatch {
  msgModeEnabled: boolean;
  enableRotation: boolean;
  enableMsgNotify: boolean;
}

export const resolveDisplayStrategy = (
  messageModeEnabled: boolean,
  rotationEnabled: boolean
): DisplayStrategy => {
  if (rotationEnabled) return 'rotation';
  if (messageModeEnabled) return 'message';
  return 'stable';
};

export const createDisplayStrategyPatch = (
  strategy: DisplayStrategy,
  notificationsEnabled: boolean
): DisplayStrategyPatch => {
  if (strategy === 'message') {
    return {
      msgModeEnabled: true,
      enableRotation: false,
      enableMsgNotify: true,
    };
  }

  if (strategy === 'rotation') {
    return {
      msgModeEnabled: false,
      enableRotation: true,
      enableMsgNotify: notificationsEnabled,
    };
  }

  return {
    msgModeEnabled: false,
    enableRotation: false,
    enableMsgNotify: notificationsEnabled,
  };
};
