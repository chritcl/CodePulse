import { describe, expect, it } from 'vitest';
import { resolveIslandDisplay } from './display';

describe('resolveIslandDisplay', () => {
  it('优先展示 Agent 状态', () => {
    expect(
      resolveIslandDisplay({
        agentActive: true,
        wechatActive: true,
        notificationActive: true,
        rotationEnabled: true,
        rotationIndex: 2,
        musicEnabled: true,
        hardwareEnabled: true,
      })
    ).toBe('agent');
  });

  it('在没有高优先级内容时按轮换索引展示内容', () => {
    expect(
      resolveIslandDisplay({
        rotationEnabled: true,
        rotationIndex: 1,
        musicEnabled: false,
        hardwareEnabled: false,
      })
    ).toBe('music');
  });

  it('系统操作提示优先于普通轮换内容', () => {
    expect(
      resolveIslandDisplay({
        systemToastActive: true,
        rotationEnabled: true,
        rotationIndex: 2,
        musicEnabled: true,
        hardwareEnabled: true,
      })
    ).toBe('system-toast');
  });

  it('通知优先于系统操作提示', () => {
    expect(
      resolveIslandDisplay({
        notificationActive: true,
        systemToastActive: true,
        rotationEnabled: true,
        rotationIndex: 2,
        musicEnabled: true,
        hardwareEnabled: true,
      })
    ).toBe('notification');
  });

  it('未开启轮换时保持硬件优先于音乐的旧行为', () => {
    expect(
      resolveIslandDisplay({
        rotationEnabled: false,
        rotationIndex: 0,
        musicEnabled: true,
        hardwareEnabled: true,
      })
    ).toBe('hardware');
  });

  it('没有模块开启时展示网速', () => {
    expect(
      resolveIslandDisplay({
        rotationEnabled: false,
        rotationIndex: 0,
        musicEnabled: false,
        hardwareEnabled: false,
      })
    ).toBe('network');
  });
});
