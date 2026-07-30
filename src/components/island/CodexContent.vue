<template>
  <div
    v-if="mode === 'compact'"
    class="codex-compact"
    :class="[statusClass, { 'is-reduced-motion': prefersReducedMotion }]"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <span class="codex-glyph-frame" aria-hidden="true">
      <CodexGlyph :size="24" />
    </span>

    <Transition :name="prefersReducedMotion ? undefined : 'codex-task-fade'" mode="out-in">
      <div :key="currentTask?.sessionId || 'idle'" class="codex-compact-copy">
        <span class="codex-compact-project" :title="currentProject">{{ currentProject }}</span>
        <span class="codex-compact-phase">{{ currentPhase }}</span>
      </div>
    </Transition>

    <span class="codex-compact-meta">
      {{ compactMeta }}
    </span>
  </div>

  <section v-else class="codex-detail" :class="detailStatusClass" aria-label="Codex 任务详情">
    <header class="codex-detail-header" :class="detailStatusClass">
      <span class="codex-glyph-frame is-detail" aria-hidden="true">
        <CodexGlyph :size="24" />
      </span>
      <div class="codex-detail-heading">
        <span class="codex-detail-title">Codex 监听</span>
        <span class="codex-listener-status">{{ listenerLabel }}</span>
      </div>
      <span class="codex-detail-count">{{ tasks.length }} 个任务</span>
    </header>

    <div v-if="tasks.length" class="codex-project-strip" aria-label="活动项目">
      <button
        v-for="task in tasks"
        :key="task.sessionId"
        type="button"
        class="codex-project-tab"
        :class="{ 'is-selected': task.sessionId === selectedTask?.sessionId }"
        :data-session-id="task.sessionId"
        :title="task.projectName || '未命名项目'"
        @click.stop="selectTask(task.sessionId)"
      >
        <span class="codex-project-tab-name">{{ task.projectName || '未命名项目' }}</span>
        <span class="codex-project-tab-phase">{{ getCodexPhaseLabel(task.phase) }}</span>
      </button>
    </div>

    <div v-if="selectedTask" class="codex-task-detail">
      <div class="codex-task-detail-topline">
        <span class="codex-task-project" :title="selectedTask.projectName || '未命名项目'">
          {{ selectedTask.projectName || '未命名项目' }}
        </span>
        <span class="codex-task-phase">{{ getCodexPhaseLabel(selectedTask.phase) }}</span>
        <button
          v-if="selectedTask.phase === 'failed'"
          type="button"
          class="codex-clear-action"
          aria-label="清除失败任务"
          @click.stop="$emit('clear-failed', selectedTask.sessionId)"
        >
          清除
        </button>
      </div>

      <div class="codex-task-meta">
        <span>{{ getCodexSourceLabel(selectedTask.source) }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ activityLabel(selectedTask.lastActivityAtMs) }}</span>
      </div>

      <p v-if="showTaskSummary && selectedTask.taskSummary" class="codex-task-summary">
        {{ selectedTask.taskSummary }}
      </p>
      <p v-if="showOperationSummary && selectedTask.operationSummary" class="codex-task-operation">
        {{ selectedTask.operationSummary }}
      </p>
      <p v-if="selectedTask.errorSummary" class="codex-task-error">
        {{ selectedTask.errorSummary }}
      </p>
    </div>

    <div v-else class="codex-empty-state">
      {{ listenerLabel }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CodexStatusSnapshot, CodexTaskSnapshot } from '@/shared/ipc/contracts';
import {
  getCodexListenerLabel,
  getCodexPhaseLabel,
  getCodexSourceCompactLabel,
  getCodexSourceLabel,
  sortCodexTasksByRecentActivity,
} from '@/modules/codex/presentation';
import CodexGlyph from './CodexGlyph.vue';

interface Props {
  snapshot: CodexStatusSnapshot;
  mode: 'compact' | 'detail';
  showOperationSummary?: boolean;
  showTaskSummary?: boolean;
  rotationPaused?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showOperationSummary: true,
  showTaskSummary: false,
  rotationPaused: false,
});

defineEmits<{
  'clear-failed': [sessionId: string];
}>();

const ROTATION_INTERVAL_MS = 4_000;
const ATTENTION_PHASES = new Set<CodexTaskSnapshot['phase']>([
  'waiting_input',
  'waiting_approval',
  'failed',
]);

const tasks = computed(() => sortCodexTasksByRecentActivity(props.snapshot.tasks));
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
let motionQuery: MediaQueryList | null = null;

const currentTask = computed(
  () =>
    attentionTask.value ??
    tasks.value.find((task) => task.sessionId === compactSessionId.value) ??
    tasks.value[0] ??
    null
);
const selectedTask = computed(() => {
  const selected = tasks.value.find((task) => task.sessionId === selectedSessionId.value);
  return selected ?? props.snapshot.representativeTask ?? tasks.value[0] ?? null;
});
const currentIndex = computed(() => {
  if (!currentTask.value) return -1;
  return tasks.value.findIndex((task) => task.sessionId === currentTask.value?.sessionId);
});
const currentProject = computed(() => currentTask.value?.projectName || 'Codex');
const currentPhase = computed(() =>
  currentTask.value
    ? getCodexPhaseLabel(currentTask.value.phase)
    : getCodexListenerLabel(props.snapshot.listenerStatus)
);
const compactMeta = computed(() => {
  if (!currentTask.value) return 'IDLE';
  if (tasks.value.length === 1) return getCodexSourceCompactLabel(currentTask.value.source);
  return `${currentIndex.value + 1}/${tasks.value.length}`;
});
const listenerLabel = computed(() => getCodexListenerLabel(props.snapshot.listenerStatus));
const statusClass = computed(() =>
  getStatusClass(currentTask.value, props.snapshot.listenerStatus)
);
const detailStatusClass = computed(() =>
  getStatusClass(selectedTask.value, props.snapshot.listenerStatus)
);
const rotationBlocked = computed(
  () =>
    props.mode !== 'compact' ||
    tasks.value.length < 2 ||
    props.rotationPaused ||
    isHovered.value ||
    Boolean(attentionTask.value)
);

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
        props.snapshot.representativeTask?.sessionId ?? tasks.value[0]?.sessionId ?? null;
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

function restartRotation() {
  if (rotationTimer !== null) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
  if (rotationBlocked.value) return;

  rotationTimer = setInterval(() => {
    const index = tasks.value.findIndex((task) => task.sessionId === compactSessionId.value);
    const nextIndex = index < 0 ? 0 : (index + 1) % tasks.value.length;
    compactSessionId.value = tasks.value[nextIndex]?.sessionId ?? null;
  }, ROTATION_INTERVAL_MS);
}

const selectTask = (sessionId: string) => {
  selectedSessionId.value = sessionId;
};

const updateReducedMotion = (event: { matches: boolean }) => {
  prefersReducedMotion.value = event.matches;
};

onMounted(() => {
  if (typeof globalThis.matchMedia !== 'function') return;
  motionQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
  updateReducedMotion(motionQuery);
  motionQuery.addEventListener?.('change', updateReducedMotion);
});

onBeforeUnmount(() => {
  if (rotationTimer !== null) clearInterval(rotationTimer);
  motionQuery?.removeEventListener?.('change', updateReducedMotion);
});

function getStatusClass(
  task: CodexTaskSnapshot | null,
  listenerStatus: CodexStatusSnapshot['listenerStatus']
) {
  if (!task) return listenerStatus === 'failed' ? 'is-error' : 'is-paused';
  if (task.phase === 'waiting_input' || task.phase === 'waiting_approval') return 'is-warning';
  if (task.phase === 'completed') return 'is-success';
  if (task.phase === 'failed') return 'is-error';
  if (task.phase === 'interrupted') return 'is-paused';
  return 'is-running';
}

const activityLabel = (timestamp: number) => {
  if (!timestamp) return '尚无活动';
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return '刚刚活动';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前活动`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前活动`;
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(timestamp)
  );
};
</script>

<style scoped>
.codex-compact {
  --codex-accent: rgba(255, 255, 255, 0.62);
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  color: currentColor;
}

.codex-compact.is-running,
.codex-detail.is-running,
.codex-detail-header.is-running {
  --codex-accent: #9592ff;
}

.codex-compact.is-warning,
.codex-detail.is-warning,
.codex-detail-header.is-warning {
  --codex-accent: #ffd43b;
}

.codex-compact.is-success,
.codex-detail.is-success,
.codex-detail-header.is-success {
  --codex-accent: #58d978;
}

.codex-compact.is-error,
.codex-detail.is-error,
.codex-detail-header.is-error {
  --codex-accent: #ff716a;
}

.codex-compact.is-paused,
.codex-detail.is-paused,
.codex-detail-header.is-paused {
  --codex-accent: #9b9ba1;
}

.codex-glyph-frame {
  width: 28px;
  height: 28px;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--codex-accent);
  flex: 0 0 28px;
}

.codex-glyph-frame::before {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.11;
  filter: blur(5px);
}

.codex-glyph-frame :deep(svg) {
  position: relative;
}

.codex-glyph-frame.is-detail {
  width: 30px;
  height: 30px;
  flex-basis: 30px;
}

.codex-compact-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.codex-compact-project,
.codex-detail-title,
.codex-task-project {
  overflow: hidden;
  color: currentColor;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-compact-project {
  font-size: 12px;
  line-height: 1;
}

.codex-compact-phase {
  overflow: hidden;
  color: currentColor;
  font-size: 9px;
  line-height: 1;
  opacity: 0.58;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-compact-meta {
  min-width: 34px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--codex-accent);
  background: color-mix(in srgb, var(--codex-accent) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--codex-accent) 24%, transparent);
  flex-shrink: 0;
  font-size: 8px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

.codex-task-fade-enter-active,
.codex-task-fade-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.codex-task-fade-enter-from,
.codex-task-fade-leave-to {
  opacity: 0;
  transform: translateY(2px);
}

.codex-detail {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: currentColor;
}

.codex-detail,
.codex-detail * {
  box-sizing: border-box;
}

.codex-detail-header,
.codex-task-detail-topline,
.codex-task-meta {
  display: flex;
  align-items: center;
}

.codex-detail-header {
  --codex-accent: #9592ff;
  gap: 9px;
}

.codex-detail-heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.codex-detail-title {
  font-size: 13px;
  line-height: 1;
}

.codex-listener-status,
.codex-task-meta,
.codex-project-tab-phase {
  color: currentColor;
  font-size: 9px;
  line-height: 1;
  opacity: 0.56;
}

.codex-detail-count {
  height: 22px;
  margin-left: auto;
  border-radius: 999px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  color: currentColor;
  background: rgba(255, 255, 255, 0.09);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.codex-project-strip {
  width: 100%;
  min-width: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.codex-project-strip::-webkit-scrollbar {
  display: none;
}

.codex-project-tab {
  min-width: 104px;
  max-width: 148px;
  height: 34px;
  border: 0;
  border-radius: 9px;
  padding: 5px 8px;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 3px;
  color: currentColor;
  background: rgba(255, 255, 255, 0.055);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.055);
  cursor: pointer;
  text-align: left;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.codex-project-tab:hover,
.codex-project-tab.is-selected {
  background: rgba(149, 146, 255, 0.13);
  box-shadow: inset 0 0 0 1px rgba(149, 146, 255, 0.3);
}

.codex-project-tab-name {
  width: 100%;
  overflow: hidden;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-task-detail {
  min-width: 0;
  height: 100px;
  border-radius: 11px;
  padding: 10px 11px;
  background: rgba(0, 0, 0, 0.16);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.055);
}

.codex-task-detail-topline {
  min-width: 0;
  gap: 8px;
}

.codex-task-project {
  min-width: 0;
  font-size: 11px;
}

.codex-task-phase {
  margin-left: auto;
  color: var(--codex-accent, #9592ff);
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
}

.codex-task-meta {
  gap: 5px;
  margin-top: 5px;
}

.codex-task-summary,
.codex-task-operation,
.codex-task-error {
  margin: 6px 0 0;
  overflow: hidden;
  color: currentColor;
  font-size: 10px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-task-summary + .codex-task-operation,
.codex-task-summary + .codex-task-error,
.codex-task-operation + .codex-task-error {
  margin-top: 3px;
}

.codex-task-summary {
  font-weight: 650;
}

.codex-task-operation {
  opacity: 0.62;
}

.codex-task-error {
  color: #ff918b;
}

.codex-clear-action {
  height: 21px;
  margin-left: 1px;
  border: 0;
  border-radius: 999px;
  padding: 0 9px;
  color: #ffd6d3;
  background: rgba(255, 91, 85, 0.18);
  cursor: pointer;
  font-size: 9px;
  font-weight: 700;
}

.codex-clear-action:hover {
  background: rgba(255, 91, 85, 0.28);
}

.codex-empty-state {
  border-radius: 10px;
  padding: 31px 10px;
  color: currentColor;
  background: rgba(255, 255, 255, 0.045);
  font-size: 11px;
  opacity: 0.62;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .codex-task-fade-enter-active,
  .codex-task-fade-leave-active,
  .codex-project-tab {
    transition: none;
  }
}
</style>
