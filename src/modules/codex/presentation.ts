import type {
  CodexStatusSnapshot,
  CodexTaskPhase,
  CodexTaskSnapshot,
} from '@/shared/ipc/contracts';
import type { IslandModuleSnapshot } from '@/modules/island/display';

export interface CodexIslandPresentation {
  module: IslandModuleSnapshot;
  phaseLabel: string;
}

export interface CodexPresentationOptions {
  idleResident?: boolean;
}

const RUNNING_PHASE_LABELS: Partial<Record<CodexTaskPhase, string>> = {
  analyzing: '分析任务',
  reading: '读取项目',
  editing: '修改代码',
  running_command: '运行命令',
  running_tests: '运行测试',
};

const PHASE_LABELS: Record<CodexTaskPhase, string> = {
  analyzing: '分析任务',
  reading: '读取项目',
  editing: '修改代码',
  running_command: '运行命令',
  running_tests: '运行测试',
  waiting_approval: '等待授权',
  completed: '任务完成',
  failed: '执行失败',
  interrupted: '任务中断',
};

export const getCodexPhaseLabel = (phase: CodexTaskPhase) => PHASE_LABELS[phase];

export const getCodexSourceLabel = (source: CodexTaskSnapshot['source']) => {
  if (source === 'cli') return 'Codex CLI';
  if (source === 'app') return 'Codex App';
  return 'Codex';
};

export const getCodexListenerLabel = (status: CodexStatusSnapshot['listenerStatus']) => {
  if (status === 'waiting_for_event') return '等待事件';
  if (status === 'running') return '正常监听';
  if (status === 'failed') return '服务异常';
  return '未运行';
};

export const resolveCodexIslandPresentation = (
  snapshot: CodexStatusSnapshot,
  options: CodexPresentationOptions = {}
): CodexIslandPresentation => {
  const task = snapshot.representativeTask;

  if (!task) {
    if (options.idleResident) {
      return {
        module: { kind: 'agent', active: true, status: 'paused', label: 'Codex 待命' },
        phaseLabel: 'Codex 待命',
      };
    }
    return {
      module: { kind: 'agent', active: false, label: 'Codex' },
      phaseLabel: '暂无任务',
    };
  }

  const phaseLabel = getCodexPhaseLabel(task.phase);

  if (task.phase === 'waiting_approval') {
    return {
      module: {
        kind: 'agent',
        active: true,
        interrupt: 'strong',
        status: 'warning',
        label: phaseLabel,
      },
      phaseLabel,
    };
  }

  if (task.phase === 'completed') {
    return {
      module: {
        kind: 'agent',
        active: true,
        interrupt: 'soft',
        status: 'success',
        label: phaseLabel,
      },
      phaseLabel,
    };
  }

  if (task.phase === 'failed') {
    return {
      module: {
        kind: 'agent',
        active: true,
        interrupt: 'strong',
        status: 'error',
        label: phaseLabel,
      },
      phaseLabel,
    };
  }

  const runningPhaseLabel = RUNNING_PHASE_LABELS[task.phase];
  if (runningPhaseLabel) {
    return {
      module: {
        kind: 'agent',
        active: true,
        interrupt: 'none',
        status: 'running',
        label: runningPhaseLabel,
      },
      phaseLabel,
    };
  }

  if (task.phase === 'interrupted') {
    return {
      module: {
        kind: 'agent',
        active: true,
        interrupt: 'soft',
        status: 'paused',
        label: phaseLabel,
      },
      phaseLabel,
    };
  }

  return { module: { kind: 'agent', active: true, label: phaseLabel }, phaseLabel };
};

export const sortCodexTasksByRecentActivity = (tasks: CodexTaskSnapshot[]) =>
  [...tasks].sort((first, second) => second.lastActivityAtMs - first.lastActivityAtMs);
