<template>
  <div
    v-if="mode === 'compact'"
    class="claude-compact"
    :class="statusClass(currentSession?.effectivePhase)"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <span class="claude-glyph-frame" aria-hidden="true"><ClaudeGlyph :size="24" /></span>
    <Transition :name="prefersReducedMotion ? undefined : 'claude-session-fade'" mode="out-in">
      <div :key="currentSession?.taskKey || 'idle'" class="claude-compact-copy">
        <span class="claude-compact-project">{{
          currentSession?.projectName || 'Claude Code'
        }}</span>
        <span class="claude-compact-phase">{{ compactPhase }}</span>
      </div>
    </Transition>
    <span class="claude-compact-meta" :title="compactMetaTitle">{{ compactMeta }}</span>
  </div>

  <section
    v-else
    class="claude-detail"
    :class="statusClass(selectedSession?.effectivePhase)"
    data-detail-size="420x260"
    aria-label="Claude Code 会话详情"
  >
    <header class="claude-detail-header">
      <span class="claude-glyph-frame" aria-hidden="true"><ClaudeGlyph :size="24" /></span>
      <span class="claude-detail-heading">
        <strong>Claude Code</strong>
        <small>{{ getClaudeListenerLabel(snapshot.listenerStatus) }}</small>
      </span>
      <span class="claude-session-count">{{ sessions.length }} 个会话</span>
    </header>

    <div v-if="sessions.length" class="claude-session-tabs" aria-label="Claude Code 会话">
      <button
        v-for="session in sessions"
        :key="session.taskKey"
        type="button"
        :class="{ 'is-selected': session.taskKey === selectedSession?.taskKey }"
        @click.stop="selectSession(session.taskKey)"
      >
        <strong>{{ session.sessionLabel || session.projectName || '未命名会话' }}</strong>
        <small>{{ getClaudePhaseLabel(session.effectivePhase) }}</small>
      </button>
    </div>

    <div v-if="selectedSession" class="claude-session-detail">
      <div class="claude-session-summary">
        <div class="claude-session-title-row">
          <strong>{{
            selectedSession.sessionLabel || selectedSession.projectName || '未命名会话'
          }}</strong>
          <button
            v-if="selectedSession.phase === 'failed'"
            type="button"
            class="claude-clear-action"
            :data-clear-task-key="selectedSession.taskKey"
            @click.stop="$emit('clear-failed', selectedSession.taskKey)"
          >
            清除
          </button>
        </div>
        <div class="claude-phase-pair">
          <span>实际：{{ getClaudePhaseLabel(selectedSession.phase) }}</span>
          <span>有效：{{ getClaudePhaseLabel(selectedSession.effectivePhase) }}</span>
        </div>
        <p v-if="showTaskSummary && selectedSession.taskSummary">
          {{ selectedSession.taskSummary }}
        </p>
        <p v-if="showOperationSummary && selectedSession.operationSummary" class="is-muted">
          {{ selectedSession.operationSummary }}
        </p>
      </div>

      <div class="claude-child-list" aria-label="子任务列表">
        <div v-if="!selectedSession.children.length" class="claude-child-empty">暂无子任务</div>
        <div
          v-for="child in selectedSession.children"
          :key="child.taskKey"
          class="claude-child-row"
          :class="statusClass(child.phase)"
        >
          <span class="claude-child-kind">{{
            child.childKind === 'subagent' ? '代理' : '任务'
          }}</span>
          <span class="claude-child-copy">
            <strong>{{ child.taskSummary || child.childId }}</strong>
            <small>
              {{ getClaudePhaseLabel(child.phase) }}
              <template v-if="showOperationSummary && child.operationSummary">
                · {{ child.operationSummary }}
              </template>
            </small>
          </span>
          <button
            v-if="child.phase === 'failed'"
            type="button"
            class="claude-clear-action"
            :data-clear-task-key="child.taskKey"
            @click.stop="$emit('clear-failed', child.taskKey)"
          >
            清除
          </button>
        </div>
      </div>
    </div>

    <div v-else class="claude-empty-state">
      {{ getClaudeListenerLabel(snapshot.listenerStatus) }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, toRef } from 'vue';
import type { AgentTaskPhase, ClaudeStatusSnapshot } from '@/shared/ipc/contracts';
import { useClaudeSessionCarousel } from '@/composables/claude/useClaudeSessionCarousel';
import { getClaudeListenerLabel, getClaudePhaseLabel } from '@/modules/claude/presentation';
import ClaudeGlyph from './ClaudeGlyph.vue';

interface Props {
  snapshot: ClaudeStatusSnapshot;
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

defineEmits<{ 'clear-failed': [taskKey: string] }>();

const carousel = useClaudeSessionCarousel({
  snapshot: toRef(props, 'snapshot'),
  mode: toRef(props, 'mode'),
  rotationPaused: toRef(props, 'rotationPaused'),
});
const {
  sessions,
  currentSession,
  selectedSession,
  isHovered,
  prefersReducedMotion,
  selectSession,
} = carousel;
const compactPhase = computed(() =>
  currentSession.value
    ? getClaudePhaseLabel(currentSession.value.effectivePhase)
    : getClaudeListenerLabel(props.snapshot.listenerStatus)
);
const compactMeta = computed(() => currentSession.value?.children.length ?? 'IDLE');
const compactMetaTitle = computed(() =>
  currentSession.value ? `${currentSession.value.children.length} 个子任务` : '空闲'
);

const statusClass = (phase?: AgentTaskPhase) => {
  if (phase === 'waiting_input' || phase === 'waiting_approval') return 'is-warning';
  if (phase === 'failed') return 'is-error';
  if (phase === 'completed') return 'is-success';
  if (!phase || phase === 'interrupted') return 'is-paused';
  return 'is-running';
};

onMounted(carousel.start);
onBeforeUnmount(carousel.stop);
</script>

<style scoped src="./ClaudeContent.css"></style>
