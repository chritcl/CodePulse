import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeSessionSnapshot, ClaudeStatusSnapshot } from '@/shared/ipc/contracts';
import { useClaudeSessionCarousel } from './useClaudeSessionCarousel';

const session = (
  sessionId: string,
  patch: Partial<ClaudeSessionSnapshot> = {}
): ClaudeSessionSnapshot => ({
  taskKey: `claude:session:${sessionId}`,
  sessionId,
  phase: 'analyzing',
  effectivePhase: 'analyzing',
  projectName: sessionId,
  children: [],
  lastActivityAtMs: 100,
  ...patch,
});

const snapshot = (sessions: ClaudeSessionSnapshot[]): ClaudeStatusSnapshot => ({
  revision: 1,
  generatedAtMs: 100,
  sessions,
  representativeSession: sessions[0] ?? null,
  hasWaitingApproval: false,
  hasFailedTask: false,
  listenerStatus: 'running',
});

describe('Claude Code 会话轮换', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('关注状态解除后立即回到最近活动的根会话', async () => {
    const newest = session('newest', { lastActivityAtMs: 300 });
    const waiting = session('waiting', {
      effectivePhase: 'waiting_input',
      lastActivityAtMs: 200,
    });
    const snapshotRef = ref(snapshot([newest, waiting]));
    const carousel = useClaudeSessionCarousel({
      snapshot: snapshotRef,
      mode: ref('compact'),
      rotationPaused: ref(false),
    });

    expect(carousel.currentSession.value?.sessionId).toBe('waiting');

    snapshotRef.value = snapshot([newest, session('waiting', { lastActivityAtMs: 200 })]);
    await Promise.resolve();

    expect(carousel.currentSession.value?.sessionId).toBe('newest');
    carousel.stop();
  });

  it('等待用户的根会话优先于失败会话和普通会话', async () => {
    const active = session('active', { lastActivityAtMs: 400 });
    const failed = session('failed', {
      effectivePhase: 'failed',
      lastActivityAtMs: 300,
    });
    const waiting = session('waiting', {
      effectivePhase: 'waiting_approval',
      lastActivityAtMs: 200,
    });
    const carousel = useClaudeSessionCarousel({
      snapshot: ref(snapshot([active, failed, waiting])),
      mode: ref('compact'),
      rotationPaused: ref(false),
    });

    await vi.advanceTimersByTimeAsync(8_000);

    expect(carousel.currentSession.value?.sessionId).toBe('waiting');
    carousel.stop();
  });

  it('按最近活动轮换，并在悬停或减少动态效果时暂停', async () => {
    const newest = session('newest', { lastActivityAtMs: 300 });
    const older = session('older', { lastActivityAtMs: 200 });
    const carousel = useClaudeSessionCarousel({
      snapshot: ref(snapshot([older, newest])),
      mode: ref('compact'),
      rotationPaused: ref(false),
    });

    await vi.advanceTimersByTimeAsync(4_000);
    expect(carousel.currentSession.value?.sessionId).toBe('older');

    carousel.isHovered.value = true;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(carousel.currentSession.value?.sessionId).toBe('older');
    carousel.stop();

    const removeEventListener = vi.fn();
    const reducedMotionCarousel = useClaudeSessionCarousel({
      snapshot: ref(snapshot([older, newest])),
      mode: ref('compact'),
      rotationPaused: ref(false),
      matchMedia: () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener,
      }),
    });
    reducedMotionCarousel.start();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(reducedMotionCarousel.currentSession.value?.sessionId).toBe('newest');

    reducedMotionCarousel.stop();
    expect(removeEventListener).toHaveBeenCalledOnce();
  });

  it('手动选择详情会话，并在会话消失后回到代表会话', async () => {
    const newest = session('newest', { lastActivityAtMs: 300 });
    const older = session('older', { lastActivityAtMs: 200 });
    const snapshotRef = ref(snapshot([older, newest]));
    const carousel = useClaudeSessionCarousel({
      snapshot: snapshotRef,
      mode: ref('detail'),
      rotationPaused: ref(false),
    });

    carousel.selectSession(older.taskKey);
    expect(carousel.selectedSession.value?.sessionId).toBe('older');

    snapshotRef.value = snapshot([newest]);
    await Promise.resolve();

    expect(carousel.selectedSession.value?.sessionId).toBe('newest');
    carousel.stop();
  });
});
