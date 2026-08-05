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
        moduleOf({ kind: 'codex', active: true, status: 'running' }),
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
    expect(layout.satellites.map((item) => item.kind)).toEqual(['wechat', 'codex', 'notification']);
    expect(layout.overflowCount).toBe(2);
  });

  it('系统 Toast 临时覆盖主岛但不进入卫星岛', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
        moduleOf({
          kind: 'system-toast',
          active: true,
          interrupt: 'soft',
          interruptUntil: now + 2_000,
        }),
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
    expect(layout.size).toEqual({ width: 420, height: 182 });
  });

  it('音乐进度条可见时增加详情高度', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'music', active: true, status: 'running' }),
      ],
      stableMainKind: 'music',
      expandedKind: 'music',
      musicProgressVisible: true,
      now,
    });

    expect(layout.size).toEqual({ width: 420, height: 206 });
  });

  it('展开态宽度取详情宽度和紧凑行宽的较大值', () => {
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
    expect(layout.size).toEqual({ width: 420, height: 182 });
  });

  it('网络展开态使用网络详情尺寸', () => {
    const layout = resolveIslandLayout({
      modules: [moduleOf({ kind: 'network', active: true })],
      expandedKind: 'network',
      now,
    });

    expect(layout.main).toBe('network');
    expect(layout.size).toEqual({ width: 316, height: 142 });
  });

  it('通知展开态使用通知详情尺寸', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'notification', active: true, interrupt: 'soft', status: 'unread' }),
      ],
      expandedKind: 'notification',
      now,
    });

    expect(layout.main).toBe('notification');
    expect(layout.size).toEqual({ width: 380, height: 162 });
  });

  it('Codex 展开态为会话列表与详情预留足够空间', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'network', active: true }),
        moduleOf({ kind: 'codex', active: true, status: 'running' }),
      ],
      stableMainKind: 'codex',
      expandedKind: 'codex',
      now,
    });

    expect(layout.main).toBe('codex');
    expect(layout.size).toEqual({ width: 390, height: 254 });
  });

  it('Codex 与 Claude 同级状态按最近活动选择主岛', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({
          kind: 'codex',
          active: true,
          status: 'running',
          lastActivityAtMs: now - 10,
        }),
        moduleOf({
          kind: 'claude',
          active: true,
          status: 'running',
          lastActivityAtMs: now,
        }),
        moduleOf({ kind: 'network', active: true }),
      ],
      now,
    });

    expect(layout.main).toBe('claude');
    expect(layout.satellites.map((item) => item.kind)).toContain('codex');
  });

  it('等待用户的 Agent 优先于活动时间更新的失败 Agent', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({
          kind: 'codex',
          active: true,
          interrupt: 'strong',
          status: 'warning',
          lastActivityAtMs: now - 100,
        }),
        moduleOf({
          kind: 'claude',
          active: true,
          interrupt: 'strong',
          status: 'error',
          lastActivityAtMs: now,
        }),
        moduleOf({ kind: 'network', active: true }),
      ],
      now,
    });

    expect(layout.main).toBe('codex');
    expect(layout.reason).toBe('strong-interrupt');
  });

  it('Claude 展开态提供固定的四百二十乘二百六十内容区', () => {
    const layout = resolveIslandLayout({
      modules: [
        moduleOf({ kind: 'claude', active: true, status: 'running' }),
        moduleOf({ kind: 'network', active: true }),
      ],
      stableMainKind: 'claude',
      expandedKind: 'claude',
      now,
    });

    expect(layout.main).toBe('claude');
    expect(layout.size).toEqual({ width: 448, height: 334 });
  });
});
