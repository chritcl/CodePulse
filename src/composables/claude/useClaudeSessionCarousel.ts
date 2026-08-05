import { computed, ref, watch, type Ref } from 'vue';
import type { ClaudeSessionSnapshot, ClaudeStatusSnapshot } from '@/shared/ipc/contracts';
import { sortClaudeSessionsByRecentActivity } from '@/modules/claude/presentation';

interface MotionPreferenceQuery {
  matches: boolean;
  addEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
}

interface ClaudeSessionCarouselOptions {
  snapshot: Readonly<Ref<ClaudeStatusSnapshot>>;
  mode: Readonly<Ref<'compact' | 'detail'>>;
  rotationPaused: Readonly<Ref<boolean>>;
  matchMedia?: (query: string) => MotionPreferenceQuery;
}

const ROTATION_INTERVAL_MS = 4_000;
const ATTENTION_PHASES = new Set<ClaudeSessionSnapshot['effectivePhase']>([
  'waiting_input',
  'waiting_approval',
  'failed',
]);

export const useClaudeSessionCarousel = (options: ClaudeSessionCarouselOptions) => {
  const sessions = computed(() =>
    sortClaudeSessionsByRecentActivity(options.snapshot.value.sessions)
  );
  const sessionKeys = computed(() => sessions.value.map((session) => session.taskKey).join('|'));
  const attentionSession = computed(() => {
    const candidates = sessions.value.filter((session) =>
      ATTENTION_PHASES.has(session.effectivePhase)
    );
    return (
      candidates.sort((left, right) => {
        const leftRank = left.effectivePhase === 'failed' ? 1 : 0;
        const rightRank = right.effectivePhase === 'failed' ? 1 : 0;
        return leftRank - rightRank || right.lastActivityAtMs - left.lastActivityAtMs;
      })[0] ?? null
    );
  });
  const compactTaskKey = ref<string | null>(null);
  const selectedTaskKey = ref<string | null>(null);
  const isHovered = ref(false);
  const prefersReducedMotion = ref(false);
  let rotationTimer: ReturnType<typeof setInterval> | null = null;
  let motionQuery: MotionPreferenceQuery | null = null;
  let stopped = false;

  const currentSession = computed(
    () =>
      attentionSession.value ??
      sessions.value.find((session) => session.taskKey === compactTaskKey.value) ??
      sessions.value[0] ??
      null
  );
  const selectedSession = computed(
    () =>
      sessions.value.find((session) => session.taskKey === selectedTaskKey.value) ??
      options.snapshot.value.representativeSession ??
      sessions.value[0] ??
      null
  );
  const rotationBlocked = computed(
    () =>
      options.mode.value !== 'compact' ||
      sessions.value.length < 2 ||
      options.rotationPaused.value ||
      isHovered.value ||
      prefersReducedMotion.value ||
      Boolean(attentionSession.value)
  );

  const restartRotation = () => {
    if (rotationTimer !== null) clearInterval(rotationTimer);
    rotationTimer = null;
    if (stopped || rotationBlocked.value) return;
    rotationTimer = setInterval(() => {
      const index = sessions.value.findIndex((session) => session.taskKey === compactTaskKey.value);
      compactTaskKey.value =
        sessions.value[(index < 0 ? 0 : index + 1) % sessions.value.length]?.taskKey ?? null;
    }, ROTATION_INTERVAL_MS);
  };

  watch(
    sessionKeys,
    () => {
      if (attentionSession.value) compactTaskKey.value = attentionSession.value.taskKey;
      else if (!sessions.value.some((session) => session.taskKey === compactTaskKey.value)) {
        compactTaskKey.value = sessions.value[0]?.taskKey ?? null;
      }
      if (!sessions.value.some((session) => session.taskKey === selectedTaskKey.value)) {
        selectedTaskKey.value =
          options.snapshot.value.representativeSession?.taskKey ??
          sessions.value[0]?.taskKey ??
          null;
      }
      restartRotation();
    },
    { immediate: true }
  );
  watch(
    () => attentionSession.value?.taskKey ?? null,
    (taskKey, previousTaskKey) => {
      if (taskKey) compactTaskKey.value = taskKey;
      else if (previousTaskKey) compactTaskKey.value = sessions.value[0]?.taskKey ?? null;
      restartRotation();
    }
  );
  watch(rotationBlocked, restartRotation);

  const selectSession = (taskKey: string) => {
    selectedTaskKey.value = taskKey;
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
    sessions,
    currentSession,
    selectedSession,
    isHovered,
    prefersReducedMotion,
    selectSession,
    start,
    stop,
  };
};
