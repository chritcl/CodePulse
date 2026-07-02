<script setup lang="ts">
import { computed } from "vue";
import type { AgentProvider, AgentTask } from "../../shared/types/agent";

const props = defineProps<{
  task: AgentTask;
  provider?: AgentProvider | undefined;
  compact?: boolean | undefined;
}>();

const statusLabel = computed(() => {
  const labels: Record<AgentTask["status"], string> = {
    idle: "空闲",
    detecting: "检测中",
    analyzing: "分析中",
    planning: "规划中",
    executing: "运行中",
    testing: "测试中",
    waiting: "等待确认",
    completed: "已完成",
    failed: "失败",
    disconnected: "已断开",
    stale: "数据过期",
    unknown: "未知"
  };

  return labels[props.task.status];
});

const progressText = computed(() => {
  if (props.task.progressType === "determinate" && props.task.progressValue !== null) {
    return `${props.task.progressValue}%`;
  }

  if (props.task.progressType === "staged" && props.task.completedSteps !== null && props.task.totalSteps !== null) {
    return `${props.task.completedSteps} / ${props.task.totalSteps}`;
  }

  return "进度暂不可用";
});

const progressWidth = computed(() => {
  if (props.task.progressType === "determinate" && props.task.progressValue !== null) {
    return `${Math.min(Math.max(props.task.progressValue, 0), 100)}%`;
  }

  if (props.task.progressType === "staged" && props.task.completedSteps !== null && props.task.totalSteps) {
    return `${Math.round((props.task.completedSteps / props.task.totalSteps) * 100)}%`;
  }

  return "24%";
});
</script>

<template>
  <article class="task-card" :class="[`task-card--${task.priority}`, { 'task-card--compact': compact }]">
    <div class="task-card__icon">{{ provider?.name.slice(0, 1) ?? "A" }}</div>
    <div class="task-card__body">
      <div class="task-card__topline">
        <strong>{{ task.title }}</strong>
        <span>{{ statusLabel }}</span>
      </div>
      <div class="task-card__meta">
        <span>{{ provider?.name ?? task.providerId }}</span>
        <span>{{ task.projectName }}</span>
        <span>{{ task.stage }}</span>
      </div>
      <div class="task-card__activity">{{ task.lastActivityText }}</div>
      <div class="task-card__progress" :aria-label="progressText">
        <div class="task-card__progress-fill" :style="{ width: progressWidth }" />
      </div>
      <div v-if="task.waitingAction || task.errorMessage" class="task-card__notice">
        {{ task.waitingAction?.description ?? task.errorMessage }}
      </div>
    </div>
    <div class="task-card__metric">{{ progressText }}</div>
  </article>
</template>
