import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('紧凑态展示 GPT 图标、最近项目、阶段与多任务序号', () => {
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot(),
        mode: 'compact',
      },
    });

    expect(wrapper.findComponent({ name: 'CodexGlyph' }).exists()).toBe(true);
    expect(wrapper.get('.codex-compact-project').text()).toBe('最新项目');
    expect(wrapper.get('.codex-compact-phase').text()).toBe('运行测试');
    expect(wrapper.get('.codex-compact-meta').text()).toBe('1/2');
  });

  it('单任务紧凑态显示来源缩写', () => {
    const onlyTask = task({ source: 'app' });
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot({ tasks: [onlyTask], representativeTask: onlyTask }),
        mode: 'compact',
      },
    });

    expect(wrapper.get('.codex-compact-meta').text()).toBe('APP');
  });

  it('多任务每四秒轮播，并在悬停或展开时暂停', async () => {
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot(),
        mode: 'compact',
      },
    });

    await vi.advanceTimersByTimeAsync(4_000);
    expect(wrapper.get('.codex-compact-project').text()).toBe('旧项目');
    expect(wrapper.get('.codex-compact-meta').text()).toBe('2/2');

    await wrapper.get('.codex-compact').trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(wrapper.get('.codex-compact-project').text()).toBe('旧项目');

    await wrapper.get('.codex-compact').trigger('mouseleave');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(wrapper.get('.codex-compact-project').text()).toBe('最新项目');

    await wrapper.setProps({ rotationPaused: true });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(wrapper.get('.codex-compact-project').text()).toBe('最新项目');
  });

  it('当前轮播任务消失后回到剩余的最近活动任务', async () => {
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot(),
        mode: 'compact',
      },
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(wrapper.get('.codex-compact-project').text()).toBe('旧项目');

    const newest = task();
    await wrapper.setProps({
      snapshot: snapshot({
        tasks: [newest],
        representativeTask: newest,
      }),
    });

    expect(wrapper.get('.codex-compact-project').text()).toBe('最新项目');
    expect(wrapper.get('.codex-compact-meta').text()).toBe('CLI');
  });

  it('等待回答与失败任务锁定展示，解除后回到最近活动任务', async () => {
    const waiting = task({
      sessionId: 'session-waiting',
      phase: 'waiting_input',
      projectName: '等待项目',
      lastActivityAtMs: 1_784_001_200_000,
    });
    const newest = task({ sessionId: 'session-active', projectName: '最近项目' });
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot({
          tasks: [newest, waiting],
          representativeTask: waiting,
        }),
        mode: 'compact',
      },
    });

    await vi.advanceTimersByTimeAsync(8_000);
    expect(wrapper.get('.codex-compact-project').text()).toBe('等待项目');
    expect(wrapper.classes()).toContain('is-warning');

    const resumed = { ...waiting, phase: 'analyzing' as const };
    await wrapper.setProps({
      snapshot: snapshot({
        tasks: [newest, resumed],
        representativeTask: newest,
      }),
    });
    await nextTick();

    expect(wrapper.get('.codex-compact-project').text()).toBe('最近项目');
  });

  it('减少动态效果时禁用淡入淡出样式', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot(),
        mode: 'compact',
      },
    });
    await nextTick();

    expect(wrapper.get('.codex-compact').classes()).toContain('is-reduced-motion');
  });

  it('展开态按最近活动生成横向项目切换条，并能切换查看当前任务', async () => {
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot(),
        mode: 'detail',
        showTaskSummary: true,
      },
    });

    expect(wrapper.findComponent({ name: 'CodexGlyph' }).exists()).toBe(true);
    const cards = wrapper.findAll<HTMLButtonElement>('.codex-project-tab');
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

  it('展开态为超长项目名保留完整提示并使用可省略的标签', () => {
    const projectName = '这是一个需要在横向项目切换条中安全省略的超长项目名称';
    const longNameTask = task({ projectName });
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot({
          tasks: [longNameTask],
          representativeTask: longNameTask,
        }),
        mode: 'detail',
      },
    });

    const tab = wrapper.get('.codex-project-tab');
    expect(tab.attributes('title')).toBe(projectName);
    expect(tab.get('.codex-project-tab-name').text()).toBe(projectName);
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
    expect(wrapper.find('.codex-task-summary').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('未提供任务摘要');
  });

  it('只有开启任务摘要偏好时才展示已捕获摘要', () => {
    const wrapper = mount(CodexContent, {
      props: {
        snapshot: snapshot(),
        mode: 'detail',
        showTaskSummary: true,
      },
    });

    expect(wrapper.get('.codex-task-summary').text()).toContain('验证 Codex 状态岛');
  });
});
