import { computed, ref, watch, type Ref } from 'vue';
import type { CodexStatusSnapshot, CodexTaskSnapshot } from '@/shared/ipc/contracts';
import { sortCodexTasksByRecentActivity } from '@/modules/codex/presentation';

interface MotionPreferenceQuery {
  matches: boolean;
  addEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
}

interface CodexTaskCarouselOptions {
  snapshot: Readonly<Ref<CodexStatusSnapshot>>;
  mode: Readonly<Ref<'compact' | 'detail'>>;
  rotationPaused: Readonly<Ref<boolean>>;
  matchMedia?: (query: string) => MotionPreferenceQuery;
}

const ROTATION_INTERVAL_MS = 4_000;
const ATTENTION_PHASES = new Set<CodexTaskSnapshot['phase']>([
  'waiting_input',
  'waiting_approval',
  'failed',
]);

/** 管理 Codex 紧凑态轮换与详情态任务选择。 */
export const useCodexTaskCarousel = (options: CodexTaskCarouselOptions) => {
  const tasks = computed(() => sortCodexTasksByRecentActivity(options.snapshot.value.tasks));
  const taskIds = computed(() => tasks.value.map((task) => task.sessionId).join('|'));
  const attentionTask = computed(() => {
    const candidates = tasks.value.filter((task) => ATTENTION_PHASES.has(task.phase));
    return (
      candidates.sort((left, right) => {
        const leftRank = left.phase === 'failed' ? 1 : 0;
        const rightRank = right.phase === 'failed' ? 1 : 0;
        return leftRank - rightRank || right.lastActivityAtMs - left.lastActivityAtMs;
      })[0] ?? null
    );
  });
  const compactSessionId = ref<string | null>(null);
  const selectedSessionId = ref<string | null>(null);
  const isHovered = ref(false);
  const prefersReducedMotion = ref(false);
  let rotationTimer: ReturnType<typeof setInterval> | null = null;
  let motionQuery: MotionPreferenceQuery | null = null;
  let stopped = false;

  const currentTask = computed(
    () =>
      attentionTask.value ??
      tasks.value.find((task) => task.sessionId === compactSessionId.value) ??
      tasks.value[0] ??
      null
  );
  const selectedTask = computed(() => {
    const selected = tasks.value.find((task) => task.sessionId === selectedSessionId.value);
    return selected ?? options.snapshot.value.representativeTask ?? tasks.value[0] ?? null;
  });
  const rotationBlocked = computed(
    () =>
      options.mode.value !== 'compact' ||
      tasks.value.length < 2 ||
      options.rotationPaused.value ||
      isHovered.value ||
      prefersReducedMotion.value ||
      Boolean(attentionTask.value)
  );

  const restartRotation = () => {
    if (rotationTimer !== null) {
      clearInterval(rotationTimer);
      rotationTimer = null;
    }
    if (stopped || rotationBlocked.value) return;
    rotationTimer = setInterval(() => {
      const index = tasks.value.findIndex((task) => task.sessionId === compactSessionId.value);
      const nextIndex = index < 0 ? 0 : (index + 1) % tasks.value.length;
      compactSessionId.value = tasks.value[nextIndex]?.sessionId ?? null;
    }, ROTATION_INTERVAL_MS);
  };

  watch(
    taskIds,
    () => {
      if (attentionTask.value) {
        compactSessionId.value = attentionTask.value.sessionId;
      } else if (!tasks.value.some((task) => task.sessionId === compactSessionId.value)) {
        compactSessionId.value = tasks.value[0]?.sessionId ?? null;
      }
      if (!tasks.value.some((task) => task.sessionId === selectedSessionId.value)) {
        selectedSessionId.value =
          options.snapshot.value.representativeTask?.sessionId ?? tasks.value[0]?.sessionId ?? null;
      }
      restartRotation();
    },
    { immediate: true }
  );

  watch(
    () => attentionTask.value?.sessionId ?? null,
    (sessionId, previousSessionId) => {
      if (sessionId) {
        compactSessionId.value = sessionId;
      } else if (previousSessionId) {
        compactSessionId.value = tasks.value[0]?.sessionId ?? null;
      }
      restartRotation();
    }
  );

  watch(rotationBlocked, restartRotation);

  const selectTask = (sessionId: string) => {
    selectedSessionId.value = sessionId;
  };

  const updateReducedMotion = (event: { matches: boolean }) => {
    prefersReducedMotion.value = event.matches;
  };

  const start = () => {
    const matchMedia = options.matchMedia ?? globalThis.matchMedia;
    if (typeof matchMedia !== 'function') return;
    motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    updateReducedMotion(motionQuery);
    motionQuery.addEventListener?.('change', updateReducedMotion);
  };

  const stop = () => {
    stopped = true;
    if (rotationTimer !== null) clearInterval(rotationTimer);
    rotationTimer = null;
    motionQuery?.removeEventListener?.('change', updateReducedMotion);
    motionQuery = null;
  };

  return {
    tasks,
    currentTask,
    selectedTask,
    isHovered,
    prefersReducedMotion,
    selectTask,
    start,
    stop,
  };
};
