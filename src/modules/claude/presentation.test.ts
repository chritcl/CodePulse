import { describe, expect, it } from 'vitest';
import type { ClaudeStatusSnapshot } from '@/shared/ipc/contracts';
import { resolveClaudeIslandPresentation } from './presentation';

const snapshot = (effectivePhase: ClaudeStatusSnapshot['sessions'][number]['effectivePhase']) => ({
  revision: 1,
  generatedAtMs: 2_000,
  sessions: [
    {
      taskKey: 'claude:session:session-1',
      sessionId: 'session-1',
      phase: 'analyzing' as const,
      effectivePhase,
      projectName: 'CodePulse',
      children: [],
      lastActivityAtMs: 1_900,
    },
  ],
  representativeSession: null,
  hasWaitingApproval: effectivePhase === 'waiting_approval',
  hasFailedTask: effectivePhase === 'failed',
  listenerStatus: 'running' as const,
});

describe('resolveClaudeIslandPresentation', () => {
  it('等待回答使用强打断并携带最近活动时间', () => {
    const presentation = resolveClaudeIslandPresentation(snapshot('waiting_input'));

    expect(presentation.module).toMatchObject({
      kind: 'claude',
      active: true,
      interrupt: 'strong',
      status: 'warning',
      lastActivityAtMs: 1_900,
    });
  });

  it('没有会话时只在空闲常驻开启后激活', () => {
    const empty: ClaudeStatusSnapshot = {
      ...snapshot('analyzing'),
      sessions: [],
      representativeSession: null,
    };

    expect(resolveClaudeIslandPresentation(empty).module.active).toBe(false);
    expect(resolveClaudeIslandPresentation(empty, { idleResident: true }).module).toMatchObject({
      kind: 'claude',
      active: true,
      status: 'paused',
    });
  });
});
