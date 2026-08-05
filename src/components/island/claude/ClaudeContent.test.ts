import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ClaudeStatusSnapshot } from '@/shared/ipc/contracts';
import ClaudeContent from './ClaudeContent.vue';

const snapshot: ClaudeStatusSnapshot = {
  revision: 4,
  generatedAtMs: 2_000,
  sessions: [
    {
      taskKey: 'claude:session:session-1',
      sessionId: 'session-1',
      phase: 'analyzing',
      effectivePhase: 'waiting_input',
      projectName: 'CodePulse',
      sessionLabel: '重构状态岛',
      taskSummary: '适配 Claude Code',
      operationSummary: '等待用户回答',
      children: [
        {
          taskKey: 'claude:subagent:session-1:agent-1',
          childKind: 'subagent',
          childId: 'agent-1',
          phase: 'failed',
          taskSummary: '检查 Hook',
          operationSummary: '执行失败',
          lastActivityAtMs: 1_990,
        },
        {
          taskKey: 'claude:task:session-1:task-1',
          childKind: 'task',
          childId: 'task-1',
          phase: 'completed',
          taskSummary: '更新契约',
          lastActivityAtMs: 1_980,
        },
      ],
      lastActivityAtMs: 1_990,
    },
  ],
  representativeSession: null,
  hasWaitingApproval: false,
  hasFailedTask: true,
  listenerStatus: 'running',
};

describe('ClaudeContent', () => {
  it('紧凑态只展示根会话项目、有效阶段和子任务数', () => {
    const wrapper = mount(ClaudeContent, {
      props: { snapshot, mode: 'compact' },
    });

    expect(wrapper.text()).toContain('CodePulse');
    expect(wrapper.text()).toContain('等待回答');
    expect(wrapper.text()).toContain('2');
    expect(wrapper.find('.claude-child-list').exists()).toBe(false);
    wrapper.unmount();
  });

  it('详情态区分实际阶段和有效阶段并渲染可滚动子任务列表', () => {
    const wrapper = mount(ClaudeContent, {
      props: {
        snapshot,
        mode: 'detail',
        showTaskSummary: true,
        showOperationSummary: true,
      },
    });

    expect(wrapper.get('.claude-detail').attributes('data-detail-size')).toBe('420x260');
    expect(wrapper.text()).toContain('实际：分析任务');
    expect(wrapper.text()).toContain('有效：等待回答');
    expect(wrapper.findAll('.claude-child-row')).toHaveLength(2);
    expect(wrapper.text()).toContain('检查 Hook');
    wrapper.unmount();
  });

  it('失败子项按稳定 taskKey 发出清除事件', async () => {
    const wrapper = mount(ClaudeContent, {
      props: { snapshot, mode: 'detail', showTaskSummary: true },
    });

    expect(wrapper.find('[data-clear-task-key="claude:session:session-1"]').exists()).toBe(false);
    await wrapper.get('[data-clear-task-key="claude:subagent:session-1:agent-1"]').trigger('click');
    expect(wrapper.emitted('clear-failed')).toEqual([['claude:subagent:session-1:agent-1']]);
    wrapper.unmount();
  });

  it('父会话实际失败时即使有效阶段上浮也可清除整棵会话树', async () => {
    const failedParent: ClaudeStatusSnapshot = {
      ...snapshot,
      sessions: snapshot.sessions.map((session) => ({
        ...session,
        phase: 'failed',
        children: session.children.map((child, index) => ({
          ...child,
          phase: index === 0 ? 'waiting_input' : child.phase,
        })),
      })),
    };
    const wrapper = mount(ClaudeContent, {
      props: { snapshot: failedParent, mode: 'detail' },
    });

    await wrapper.get('[data-clear-task-key="claude:session:session-1"]').trigger('click');
    expect(wrapper.emitted('clear-failed')).toEqual([['claude:session:session-1']]);
    wrapper.unmount();
  });
});
