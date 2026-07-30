import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { CodexStatusSnapshot, CodexTaskSnapshot } from '@/shared/ipc/contracts';
import CodexContent from './CodexContent.vue';

const task = (patch: Partial<CodexTaskSnapshot> = {}): CodexTaskSnapshot => ({
  sessionId: 'session-new',
  turnId: 'turn-1',
  source: 'cli',
  phase: 'running_tests',
  projectName: '最新项目',
  taskSummary: '验证 Codex 状态岛',
  operationSummary: 'pnpm run test',
  lastActivityAtMs: 1_784_001_234_500,
  ...patch,
});

const snapshot = (patch: Partial<CodexStatusSnapshot> = {}): CodexStatusSnapshot => {
  const newest = task();
  return {
    revision: 3,
    generatedAtMs: 1_784_001_234_567,
    tasks: [
      task({
        sessionId: 'session-old',
        phase: 'editing',
        projectName: '旧项目',
        taskSummary: '修复旧问题',
        operationSummary: '检查旧测试',
        lastActivityAtMs: 1_784_001_200_000,
      }),
      newest,
    ],
    representativeTask: newest,
    hasWaitingApproval: false,
    hasFailedTask: false,
    listenerStatus: 'running',
    ...patch,
  };
};

describe('CodexContent', () => {
  it('紧凑态展示 Rust 代表任务的阶段、项目与活动数量', () => {
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot(),
        mode: 'compact',
      },
    });

    expect(wrapper.get('.codex-compact-phase').text()).toBe('运行测试');
    expect(wrapper.text()).toContain('最新项目');
    expect(wrapper.text()).toContain('2 个任务');
  });

  it('展开态按最近活动排序，并能切换查看脱敏任务详情', async () => {
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot(),
        mode: 'detail',
      },
    });

    const cards = wrapper.findAll<HTMLButtonElement>('.codex-task-card');
    expect(cards.map((card) => card.attributes('data-session-id'))).toEqual([
      'session-new',
      'session-old',
    ]);
    expect(wrapper.get('.codex-task-phase').text()).toBe('运行测试');
    expect(wrapper.get('.codex-task-summary').text()).toContain('验证 Codex 状态岛');
    expect(wrapper.get('.codex-task-operation').text()).toContain('pnpm run test');

    await wrapper.get('[data-session-id="session-old"]').trigger('click');

    expect(wrapper.get('.codex-task-project').text()).toBe('旧项目');
    expect(wrapper.get('.codex-task-phase').text()).toBe('修改代码');
    expect(wrapper.get('.codex-task-operation').text()).toContain('检查旧测试');
    expect(wrapper.text()).toContain('Codex CLI');
  });

  it('失败任务在展开态发出精确的清除请求', async () => {
    const failed = task({
      sessionId: 'session-failed',
      phase: 'failed',
      errorSummary: 'cargo test 失败',
    });
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot({
          tasks: [failed],
          representativeTask: failed,
          hasFailedTask: true,
        }),
        mode: 'detail',
      },
    });

    await wrapper.get('[aria-label="清除失败任务"]').trigger('click');

    expect(wrapper.get('.codex-task-error').text()).toContain('cargo test 失败');
    expect(wrapper.emitted('clear-failed')).toEqual([['session-failed']]);
  });

  it('关闭显示偏好后不渲染脱敏操作摘要', () => {
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot(),
        mode: 'detail',
        showOperationSummary: false,
      },
    });

    expect(wrapper.find('.codex-task-operation').exists()).toBe(false);
    expect(wrapper.get('.codex-task-summary').text()).toContain('验证 Codex 状态岛');
  });
});
