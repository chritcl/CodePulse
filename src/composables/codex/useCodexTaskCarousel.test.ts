import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexStatusSnapshot, CodexTaskSnapshot } from '@/shared/ipc/contracts';
import { useCodexTaskCarousel } from './useCodexTaskCarousel';

const task = (sessionId: string, patch: Partial<CodexTaskSnapshot> = {}): CodexTaskSnapshot => ({
  sessionId,
  source: 'cli',
  phase: 'analyzing',
  projectName: sessionId,
  lastActivityAtMs: 100,
  ...patch,
});

const snapshot = (tasks: CodexTaskSnapshot[]): CodexStatusSnapshot => ({
  revision: 1,
  generatedAtMs: 100,
  tasks,
  representativeTask: tasks[0] ?? null,
  hasWaitingApproval: false,
  hasFailedTask: false,
  listenerStatus: 'running',
});

describe('Codex 任务轮换', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('关注任务会锁定紧凑态展示并优先等待用户的任务', async () => {
    const active = task('active', { lastActivityAtMs: 300 });
    const failed = task('failed', { phase: 'failed', lastActivityAtMs: 250 });
    const waiting = task('waiting', { phase: 'waiting_input', lastActivityAtMs: 200 });
    const carousel = useCodexTaskCarousel({
      snapshot: ref(snapshot([active, failed, waiting])),
      mode: ref('compact'),
      rotationPaused: ref(false),
    });

    await vi.advanceTimersByTimeAsync(8_000);

    expect(carousel.currentTask.value?.sessionId).toBe('waiting');
    carousel.stop();
  });

  it('按最近活动轮换，并在悬停或减少动态效果时暂停', async () => {
    const newest = task('newest', { lastActivityAtMs: 300 });
    const older = task('older', { lastActivityAtMs: 200 });
    const carousel = useCodexTaskCarousel({
      snapshot: ref(snapshot([older, newest])),
      mode: ref('compact'),
      rotationPaused: ref(false),
    });

    await vi.advanceTimersByTimeAsync(4_000);
    expect(carousel.currentTask.value?.sessionId).toBe('older');

    carousel.isHovered.value = true;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(carousel.currentTask.value?.sessionId).toBe('older');
    carousel.stop();

    const reducedMotionCarousel = useCodexTaskCarousel({
      snapshot: ref(snapshot([older, newest])),
      mode: ref('compact'),
      rotationPaused: ref(false),
      matchMedia: () => ({ matches: true }),
    });
    reducedMotionCarousel.start();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(reducedMotionCarousel.currentTask.value?.sessionId).toBe('newest');
    reducedMotionCarousel.stop();
  });

  it('手动选择详情任务，并在任务消失后回到代表任务', async () => {
    const newest = task('newest', { lastActivityAtMs: 300 });
    const older = task('older', { lastActivityAtMs: 200 });
    const snapshotRef = ref(snapshot([older, newest]));
    const carousel = useCodexTaskCarousel({
      snapshot: snapshotRef,
      mode: ref('detail'),
      rotationPaused: ref(false),
    });

    carousel.selectTask('older');
    expect(carousel.selectedTask.value?.sessionId).toBe('older');

    snapshotRef.value = snapshot([newest]);
    await Promise.resolve();

    expect(carousel.selectedTask.value?.sessionId).toBe('newest');
    carousel.stop();
  });
});
