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
import { computed, onBeforeUnmount, onMounted, toRef } from 'vue';
import type { CodexStatusSnapshot, CodexTaskSnapshot } from '@/shared/ipc/contracts';
import { useCodexTaskCarousel } from '@/composables/codex/useCodexTaskCarousel';
import {
  getCodexListenerLabel,
  getCodexPhaseLabel,
  getCodexSourceCompactLabel,
  getCodexSourceLabel,
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

const carousel = useCodexTaskCarousel({
  snapshot: toRef(props, 'snapshot'),
  mode: toRef(props, 'mode'),
  rotationPaused: toRef(props, 'rotationPaused'),
});
const { tasks, currentTask, selectedTask, isHovered, prefersReducedMotion, selectTask } = carousel;
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

onMounted(carousel.start);
onBeforeUnmount(carousel.stop);

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

<style scoped src="./CodexContent.css"></style>
