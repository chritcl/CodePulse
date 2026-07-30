<template>
  <div v-if="mode === 'compact'" class="codex-compact" :class="statusClass">
    <span class="codex-status-rail" aria-hidden="true" />
    <div class="codex-compact-copy">
      <span class="codex-compact-phase">{{ presentation.phaseLabel }}</span>
      <span class="codex-compact-project">{{ representativeProject }}</span>
    </div>
    <span v-if="snapshot.tasks.length > 1" class="codex-compact-count">
      {{ snapshot.tasks.length }} 个任务
    </span>
  </div>

  <section v-else class="codex-detail" aria-label="Codex 任务详情">
    <header class="codex-detail-header" :class="statusClass">
      <span class="codex-status-rail" aria-hidden="true" />
      <div class="codex-detail-heading">
        <span class="codex-detail-title">Codex 任务</span>
        <span class="codex-listener-status">{{ listenerLabel }}</span>
      </div>
      <span class="codex-detail-count">{{ snapshot.tasks.length }}</span>
    </header>

    <div v-if="tasks.length" class="codex-task-list" aria-label="活动会话">
      <button
        v-for="task in tasks"
        :key="task.sessionId"
        type="button"
        class="codex-task-card"
        :class="{ 'is-selected': task.sessionId === selectedTask?.sessionId }"
        :data-session-id="task.sessionId"
        @click.stop="selectTask(task.sessionId)"
      >
        <span class="codex-task-card-phase">{{ getCodexPhaseLabel(task.phase) }}</span>
        <span class="codex-task-card-project">{{ task.projectName || '未命名项目' }}</span>
      </button>
    </div>

    <div v-if="selectedTask" class="codex-task-detail">
      <div class="codex-task-detail-topline">
        <span class="codex-task-project">{{ selectedTask.projectName || '未命名项目' }}</span>
        <span class="codex-task-phase">{{ getCodexPhaseLabel(selectedTask.phase) }}</span>
        <span class="codex-task-source">{{ getCodexSourceLabel(selectedTask.source) }}</span>
      </div>
      <p class="codex-task-summary">
        {{ selectedTask.taskSummary || '未提供任务摘要' }}
      </p>
      <p v-if="showOperationSummary && selectedTask.operationSummary" class="codex-task-operation">
        {{ selectedTask.operationSummary }}
      </p>
      <p v-if="selectedTask.errorSummary" class="codex-task-error">
        {{ selectedTask.errorSummary }}
      </p>
      <div class="codex-task-footer">
        <span>{{ activityLabel(selectedTask.lastActivityAtMs) }}</span>
        <button
          v-if="selectedTask.phase === 'failed'"
          type="button"
          class="codex-clear-action"
          aria-label="清除失败任务"
          @click.stop="$emit('clear-failed', selectedTask.sessionId)"
        >
          清除失败
        </button>
      </div>
    </div>

    <div v-else class="codex-empty-state">
      {{ listenerLabel }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CodexStatusSnapshot } from '@/shared/ipc/contracts';
import {
  getCodexListenerLabel,
  getCodexPhaseLabel,
  getCodexSourceLabel,
  resolveCodexIslandPresentation,
  sortCodexTasksByRecentActivity,
} from '@/modules/codex/presentation';

interface Props {
  snapshot: CodexStatusSnapshot;
  mode: 'compact' | 'detail';
  showOperationSummary?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showOperationSummary: true,
});

defineEmits<{
  'clear-failed': [sessionId: string];
}>();

const selectedSessionId = ref<string | null>(null);
const presentation = computed(() => resolveCodexIslandPresentation(props.snapshot));
const tasks = computed(() => sortCodexTasksByRecentActivity(props.snapshot.tasks));
const selectedTask = computed(() => {
  const selected = tasks.value.find((task) => task.sessionId === selectedSessionId.value);
  return selected ?? props.snapshot.representativeTask ?? tasks.value[0] ?? null;
});
const representativeProject = computed(
  () => props.snapshot.representativeTask?.projectName || 'Codex'
);
const listenerLabel = computed(() => getCodexListenerLabel(props.snapshot.listenerStatus));
const statusClass = computed(() => `is-${presentation.value.module.status ?? 'normal'}`);

const selectTask = (sessionId: string) => {
  selectedSessionId.value = sessionId;
};

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
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  color: currentColor;
}

.codex-status-rail {
  width: 4px;
  height: 22px;
  border-radius: 999px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.42);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.12);
}

.is-running .codex-status-rail {
  background: #7d7aff;
  box-shadow: 0 0 12px rgba(125, 122, 255, 0.58);
}

.is-warning .codex-status-rail {
  background: #ffcc00;
  box-shadow: 0 0 12px rgba(255, 204, 0, 0.52);
}

.is-success .codex-status-rail {
  background: #34c759;
  box-shadow: 0 0 12px rgba(52, 199, 89, 0.5);
}

.is-error .codex-status-rail {
  background: #ff5b55;
  box-shadow: 0 0 12px rgba(255, 91, 85, 0.62);
}

.is-paused .codex-status-rail {
  background: #8e8e93;
}

.codex-compact-copy,
.codex-detail-heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.codex-compact-phase,
.codex-detail-title,
.codex-task-project {
  overflow: hidden;
  color: currentColor;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-compact-phase {
  font-size: 12px;
  line-height: 1;
}

.codex-compact-project,
.codex-compact-count,
.codex-listener-status,
.codex-detail-count,
.codex-task-source,
.codex-task-footer {
  color: currentColor;
  font-size: 9px;
  line-height: 1;
  opacity: 0.58;
}

.codex-compact-project {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-compact-count {
  margin-left: auto;
  padding: 4px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.09);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.codex-detail {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  color: currentColor;
}

.codex-detail-header,
.codex-task-detail-topline,
.codex-task-footer {
  display: flex;
  align-items: center;
}

.codex-detail-header {
  gap: 8px;
}

.codex-detail-header .codex-status-rail {
  height: 26px;
}

.codex-detail-title {
  font-size: 13px;
}

.codex-listener-status {
  font-size: 10px;
}

.codex-detail-count {
  min-width: 22px;
  height: 22px;
  margin-left: auto;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  font-size: 10px;
  opacity: 0.9;
  font-variant-numeric: tabular-nums;
}

.codex-task-list {
  max-height: 62px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 2px;
}

.codex-task-card {
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 8px;
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: currentColor;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.16s ease,
    transform 0.16s ease;
}

.codex-task-card:hover,
.codex-task-card.is-selected {
  background: rgba(255, 255, 255, 0.14);
}

.codex-task-card:hover {
  transform: translateX(1px);
}

.codex-task-card-phase {
  flex-shrink: 0;
  color: currentColor;
  font-size: 10px;
  font-weight: 700;
}

.codex-task-card-project {
  min-width: 0;
  overflow: hidden;
  color: currentColor;
  font-size: 10px;
  opacity: 0.62;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-task-detail {
  min-width: 0;
  border-radius: 10px;
  padding: 9px 10px;
  background: rgba(0, 0, 0, 0.16);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.codex-task-detail-topline {
  gap: 8px;
}

.codex-task-project {
  font-size: 11px;
}

.codex-task-source {
  margin-left: auto;
  white-space: nowrap;
}

.codex-task-phase {
  flex-shrink: 0;
  color: currentColor;
  font-size: 9px;
  opacity: 0.58;
  white-space: nowrap;
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

.codex-task-summary {
  font-weight: 600;
}

.codex-task-operation {
  opacity: 0.65;
}

.codex-task-error {
  color: #ff918b;
}

.codex-task-footer {
  gap: 8px;
  margin-top: 8px;
  min-height: 20px;
}

.codex-clear-action {
  height: 20px;
  margin-left: auto;
  border: 0;
  border-radius: 999px;
  padding: 0 8px;
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
  border-radius: 9px;
  padding: 18px 10px;
  color: currentColor;
  background: rgba(255, 255, 255, 0.05);
  font-size: 11px;
  opacity: 0.64;
  text-align: center;
}
</style>
