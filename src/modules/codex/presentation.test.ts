import { describe, expect, it } from 'vitest';
import type { CodexStatusSnapshot } from '@/shared/ipc/contracts';
import { resolveCodexIslandPresentation, sortCodexTasksByRecentActivity } from './presentation';

const waitingApprovalSnapshot: CodexStatusSnapshot = {
  revision: 7,
  generatedAtMs: 1_784_001_234_567,
  tasks: [
    {
      sessionId: 'session-1',
      turnId: 'turn-1',
      source: 'cli',
      phase: 'waiting_approval',
      projectName: 'CodePulse',
      taskSummary: '实现状态岛',
      operationSummary: '等待执行 PowerShell 命令',
      lastActivityAtMs: 1_784_001_234_500,
    },
  ],
  representativeTask: {
    sessionId: 'session-1',
    turnId: 'turn-1',
    source: 'cli',
    phase: 'waiting_approval',
    projectName: 'CodePulse',
    taskSummary: '实现状态岛',
    operationSummary: '等待执行 PowerShell 命令',
    lastActivityAtMs: 1_784_001_234_500,
  },
  hasWaitingApproval: true,
  hasFailedTask: false,
  listenerStatus: 'running',
};

describe('resolveCodexIslandPresentation', () => {
  it('将等待授权的 Rust 代表任务映射为强打断的 Agent 岛', () => {
    const presentation = resolveCodexIslandPresentation(waitingApprovalSnapshot);

    expect(presentation.phaseLabel).toBe('等待授权');
    expect(presentation.module).toMatchObject({
      kind: 'agent',
      active: true,
      interrupt: 'strong',
      status: 'warning',
      label: '等待授权',
    });
  });

  it('将等待回答映射为需要立即处理的警告状态', () => {
    const presentation = resolveCodexIslandPresentation({
      ...waitingApprovalSnapshot,
      representativeTask: {
        ...waitingApprovalSnapshot.representativeTask!,
        phase: 'waiting_input',
      },
      hasWaitingApproval: false,
    });

    expect(presentation.module).toMatchObject({
      interrupt: 'strong',
      status: 'warning',
      label: '等待回答',
    });
  });

  it('将完成任务映射为短暂的软打断成功状态', () => {
    const presentation = resolveCodexIslandPresentation({
      ...waitingApprovalSnapshot,
      representativeTask: {
        ...waitingApprovalSnapshot.representativeTask!,
        phase: 'completed',
      },
      hasWaitingApproval: false,
    });

    expect(presentation.phaseLabel).toBe('任务完成');
    expect(presentation.module).toMatchObject({
      kind: 'agent',
      active: true,
      interrupt: 'soft',
      status: 'success',
      label: '任务完成',
    });
  });

  it('将最终失败任务映射为需要处理的强打断状态', () => {
    const presentation = resolveCodexIslandPresentation({
      ...waitingApprovalSnapshot,
      representativeTask: {
        ...waitingApprovalSnapshot.representativeTask!,
        phase: 'failed',
        errorSummary: 'cargo test 失败',
      },
      hasWaitingApproval: false,
      hasFailedTask: true,
    });

    expect(presentation.phaseLabel).toBe('执行失败');
    expect(presentation.module).toMatchObject({
      kind: 'agent',
      active: true,
      interrupt: 'strong',
      status: 'error',
      label: '执行失败',
    });
  });

  it('将运行中的任务映射为不打断用户的运行状态', () => {
    const presentation = resolveCodexIslandPresentation({
      ...waitingApprovalSnapshot,
      representativeTask: {
        ...waitingApprovalSnapshot.representativeTask!,
        phase: 'running_tests',
      },
      hasWaitingApproval: false,
    });

    expect(presentation.phaseLabel).toBe('运行测试');
    expect(presentation.module).toMatchObject({
      kind: 'agent',
      active: true,
      interrupt: 'none',
      status: 'running',
      label: '运行测试',
    });
  });

  it('将中断任务映射为短暂保留的软打断状态', () => {
    const presentation = resolveCodexIslandPresentation({
      ...waitingApprovalSnapshot,
      representativeTask: {
        ...waitingApprovalSnapshot.representativeTask!,
        phase: 'interrupted',
      },
      hasWaitingApproval: false,
    });

    expect(presentation.phaseLabel).toBe('任务中断');
    expect(presentation.module).toMatchObject({
      kind: 'agent',
      active: true,
      interrupt: 'soft',
      status: 'paused',
      label: '任务中断',
    });
  });

  it('没有代表任务时不激活 Agent 岛', () => {
    const presentation = resolveCodexIslandPresentation({
      ...waitingApprovalSnapshot,
      tasks: [],
      representativeTask: null,
      hasWaitingApproval: false,
      hasFailedTask: false,
      listenerStatus: 'waiting_for_event',
    });

    expect(presentation.phaseLabel).toBe('暂无任务');
    expect(presentation.module).toEqual({
      kind: 'agent',
      active: false,
      label: 'Codex',
    });
  });

  it('开启空闲常驻偏好后让没有任务的 Codex 保持为卫星岛', () => {
    const presentation = resolveCodexIslandPresentation(
      {
        ...waitingApprovalSnapshot,
        tasks: [],
        representativeTask: null,
        hasWaitingApproval: false,
        hasFailedTask: false,
        listenerStatus: 'waiting_for_event',
      },
      { idleResident: true }
    );

    expect(presentation.phaseLabel).toBe('Codex 待命');
    expect(presentation.module).toEqual({
      kind: 'agent',
      active: true,
      status: 'paused',
      label: 'Codex 待命',
    });
  });

  it('将会话列表按最近活动时间降序展示', () => {
    const tasks = [
      {
        ...waitingApprovalSnapshot.tasks[0],
        sessionId: 'session-old',
        lastActivityAtMs: 1_784_001_200_000,
      },
      {
        ...waitingApprovalSnapshot.tasks[0],
        sessionId: 'session-new',
        lastActivityAtMs: 1_784_001_240_000,
      },
    ];

    expect(sortCodexTasksByRecentActivity(tasks).map((task) => task.sessionId)).toEqual([
      'session-new',
      'session-old',
    ]);
  });

  it.each([
    ['analyzing', '分析任务'],
    ['reading', '读取项目'],
    ['editing', '修改代码'],
    ['running_command', '运行命令'],
    ['browsing', '浏览网页'],
    ['generating', '生成内容'],
    ['delegating', '分派子任务'],
    ['waiting', '等待任务'],
    ['compacting', '整理上下文'],
  ] as const)('将 %s 映射为运行中的 Agent 岛', (phase, label) => {
    const presentation = resolveCodexIslandPresentation({
      ...waitingApprovalSnapshot,
      representativeTask: {
        ...waitingApprovalSnapshot.representativeTask!,
        phase,
      },
      hasWaitingApproval: false,
    });

    expect(presentation.phaseLabel).toBe(label);
    expect(presentation.module).toMatchObject({
      kind: 'agent',
      active: true,
      interrupt: 'none',
      status: 'running',
      label,
    });
  });
});
