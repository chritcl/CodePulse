import type {
  AgentListenerStatus,
  AgentTaskPhase,
  ClaudeSessionSnapshot,
  ClaudeStatusSnapshot,
} from '@/shared/ipc/contracts';
import type { IslandModuleSnapshot } from '@/modules/island/display';

export interface ClaudeIslandPresentation {
  module: IslandModuleSnapshot;
  phaseLabel: string;
}

export interface ClaudePresentationOptions {
  idleResident?: boolean;
}

const PHASE_LABELS: Record<AgentTaskPhase, string> = {
  analyzing: '分析任务',
  reading: '读取项目',
  editing: '修改代码',
  running_command: '运行命令',
  running_tests: '运行测试',
  waiting_input: '等待回答',
  browsing: '浏览网页',
  generating: '生成内容',
  delegating: '分派子任务',
  waiting: '等待任务',
  compacting: '整理上下文',
  waiting_approval: '等待授权',
  completed: '任务完成',
  failed: '执行失败',
  interrupted: '任务中断',
};

export const getClaudePhaseLabel = (phase: AgentTaskPhase) => PHASE_LABELS[phase];

export const getClaudeListenerLabel = (status: AgentListenerStatus) => {
  if (status === 'waiting_for_event') return '等待事件';
  if (status === 'running') return '正常监听';
  if (status === 'failed') return '服务异常';
  return '未运行';
};

export const sortClaudeSessionsByRecentActivity = (sessions: ClaudeSessionSnapshot[]) =>
  [...sessions].sort((left, right) => right.lastActivityAtMs - left.lastActivityAtMs);

export const resolveClaudeIslandPresentation = (
  snapshot: ClaudeStatusSnapshot,
  options: ClaudePresentationOptions = {}
): ClaudeIslandPresentation => {
  const session =
    snapshot.representativeSession ?? sortClaudeSessionsByRecentActivity(snapshot.sessions)[0];
  if (!session) {
    return options.idleResident
      ? {
          module: { kind: 'claude', active: true, status: 'paused', label: 'Claude 待命' },
          phaseLabel: 'Claude 待命',
        }
      : {
          module: { kind: 'claude', active: false, label: 'Claude Code' },
          phaseLabel: '暂无会话',
        };
  }

  const phase = session.effectivePhase;
  const phaseLabel = getClaudePhaseLabel(phase);
  const base = {
    kind: 'claude' as const,
    active: true,
    label: phaseLabel,
    lastActivityAtMs: session.lastActivityAtMs,
  };
  if (phase === 'waiting_input' || phase === 'waiting_approval') {
    return {
      module: { ...base, interrupt: 'strong', status: 'warning' },
      phaseLabel,
    };
  }
  if (phase === 'failed') {
    return { module: { ...base, interrupt: 'strong', status: 'error' }, phaseLabel };
  }
  if (phase === 'completed') {
    return { module: { ...base, interrupt: 'soft', status: 'success' }, phaseLabel };
  }
  if (phase === 'interrupted') {
    return { module: { ...base, interrupt: 'soft', status: 'paused' }, phaseLabel };
  }
  return { module: { ...base, interrupt: 'none', status: 'running' }, phaseLabel };
};
