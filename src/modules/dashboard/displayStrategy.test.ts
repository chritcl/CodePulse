import { describe, expect, it } from 'vitest';
import {
  createDisplayStrategyPatch,
  resolveDisplayStrategy,
  type DisplayStrategy,
} from './displayStrategy';

describe('灵动岛展示策略', () => {
  it.each<{
    messageModeEnabled: boolean;
    rotationEnabled: boolean;
    expected: DisplayStrategy;
  }>([
    { messageModeEnabled: false, rotationEnabled: false, expected: 'stable' },
    { messageModeEnabled: true, rotationEnabled: false, expected: 'message' },
    { messageModeEnabled: false, rotationEnabled: true, expected: 'rotation' },
    { messageModeEnabled: true, rotationEnabled: true, expected: 'rotation' },
  ])('将现有布尔状态解析为 $expected', ({ messageModeEnabled, rotationEnabled, expected }) => {
    expect(resolveDisplayStrategy(messageModeEnabled, rotationEnabled)).toBe(expected);
  });

  it('选择消息优先时强制开启通知并关闭轮换', () => {
    expect(createDisplayStrategyPatch('message', false)).toEqual({
      msgModeEnabled: true,
      enableRotation: false,
      enableMsgNotify: true,
    });
  });

  it.each<DisplayStrategy>(['stable', 'rotation'])('选择 %s 时保留当前通知开关', (strategy) => {
    expect(createDisplayStrategyPatch(strategy, true).enableMsgNotify).toBe(true);
    expect(createDisplayStrategyPatch(strategy, false).enableMsgNotify).toBe(false);
  });
});
