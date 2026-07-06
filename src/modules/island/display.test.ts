import { describe, expect, it } from 'vitest';
import { resolveIslandLayout, type IslandModuleSnapshot } from './display';

const now = 10_000;

const moduleOf = (module: IslandModuleSnapshot): IslandModuleSnapshot => module;

describe('resolveIslandLayout', () => {
  it('只有兜底模块时只显示主岛', () => {
    const layout = resolveIslandLayout({
      modules: [moduleOf({ kind: 'network', active: true })],
      now,
    });

    expect(layout.main).toBe('network');
    expect(layout.satellites).toHaveLength(0);
    expect(layout.overflowCount).toBe(0);
    expect(layout.size).toEqual({ width: 260, height: 42 });
  });

  it('多模块活跃时生成卫星岛且网速不进入卫星岛', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({ kind: 'hardware', active: true, status: 'normal' }),
      ],
      stableMainKind: 'music',
      now,
    });

    expect(layout.main).toBe('music');
    expect(layout.satellites.map((item) => item.kind)).toEqual(['hardware']);
    expect(layout.satellites.some((item) => item.kind === 'network')).toBe(false);
    expect(layout.size.width).toBeGreaterThan(260);
  });

  it('卫星岛最多显示三个并计算溢出数量', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'agent', active: true, status: 'running' }),
        moduleOf({ kind: 'wechat', active: true, unreadCount: 4, status: 'unread' }),
        moduleOf({ kind: 'notification', active: true, unreadCount: 1, status: 'unread' }),
        moduleOf({ kind: 'hardware', active: true, status: 'warning' }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({ kind: 'update', active: true, status: 'info' }),
      ],
      manualFocusKind: 'music',
      manualFocusUntil: now + 10_000,
      now,
    });

    expect(layout.main).toBe('music');
    expect(layout.satellites.map((item) => item.kind)).toEqual([
      'wechat',
      'agent',
      'notification',
    ]);
    expect(layout.overflowCount).toBe(2);
  });

  it('系统 Toast 临时覆盖主岛但不进入卫星岛', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({ kind: 'system-toast', active: true, interrupt: 'soft', interruptUntil: now + 2_000 }),
      ],
      stableMainKind: 'music',
      now,
    });

    expect(layout.main).toBe('system-toast');
    expect(layout.satellites.map((item) => item.kind)).toEqual(['music']);
    expect(layout.satellites.some((item) => item.kind === 'system-toast')).toBe(false);
  });

  it('通知简略主岛尺寸对标音乐主岛', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({
          kind: 'notification',
          active: true,
          interrupt: 'soft',
          interruptUntil: now + 5_000,
          status: 'unread',
        }),
      ],
      now,
    });

    expect(layout.main).toBe('notification');
    expect(layout.size).toEqual({ width: 260, height: 42 });
  });

  it('用户聚焦保护期内普通通知不能抢占主岛', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({
          kind: 'notification',
          active: true,
          interrupt: 'soft',
          interruptUntil: now + 5_000,
          unreadCount: 2,
          status: 'unread',
        }),
      ],
      manualFocusKind: 'music',
      manualFocusUntil: now + 10_000,
      now,
    });

    expect(layout.main).toBe('music');
    expect(layout.reason).toBe('manual-focus');
    expect(layout.satellites.map((item) => item.kind)).toEqual(['notification']);
  });

  it('硬件严重异常可以覆盖用户聚焦保护期', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({ kind: 'hardware', active: true, interrupt: 'strong', status: 'error' }),
      ],
      manualFocusKind: 'music',
      manualFocusUntil: now + 10_000,
      now,
    });

    expect(layout.main).toBe('hardware');
    expect(layout.reason).toBe('strong-interrupt');
  });

  it('软打断结束后恢复稳定主岛', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({
          kind: 'notification',
          active: true,
          interrupt: 'soft',
          interruptUntil: now - 1,
          unreadCount: 1,
          status: 'unread',
        }),
      ],
      stableMainKind: 'music',
      now,
    });

    expect(layout.main).toBe('music');
    expect(layout.reason).toBe('stable');
  });

  it('轮换只在没有打断和用户保护期时生效', () => {
    const idleLayout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({ kind: 'hardware', active: true, status: 'normal' }),
      ],
      rotationEnabled: true,
      rotationIndex: 2,
      now,
    });

    const interruptedLayout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({ kind: 'hardware', active: true, status: 'normal' }),
        moduleOf({
          kind: 'notification',
          active: true,
          interrupt: 'soft',
          interruptUntil: now + 5_000,
          status: 'unread',
        }),
      ],
      rotationEnabled: true,
      rotationIndex: 2,
      now,
    });

    expect(idleLayout.main).toBe('hardware');
    expect(idleLayout.reason).toBe('rotation');
    expect(interruptedLayout.main).toBe('notification');
    expect(interruptedLayout.reason).toBe('soft-interrupt');
  });

  it('展开态只绑定当前主岛模块', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
      ],
      manualFocusKind: 'music',
      manualFocusUntil: now + 10_000,
      expandedKind: 'music',
      now,
    });

    expect(layout.main).toBe('music');
    expect(layout.expandedKind).toBe('music');
    expect(layout.size).toEqual({ width: 260, height: 136 });
  });

  it('展开态保留紧凑行宽并只增加面板高度', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({ kind: 'hardware', active: true, status: 'normal' }),
      ],
      stableMainKind: 'music',
      expandedKind: 'music',
      now,
    });

    expect(layout.main).toBe('music');
    expect(layout.satellites.map((item) => item.kind)).toEqual(['hardware']);
    expect(layout.size).toEqual({ width: 316, height: 136 });
  });
});
