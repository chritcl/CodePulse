<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStateStore } from "../../stores/stateStore";
import type { IslandMode } from "../../../shared/types/window";
import { createIslandStateMachine, type IslandState } from "./islandStateMachine";

const stateStore = useStateStore();
const machine = createIslandStateMachine({
  autoCollapseDelay: 5000
});
const mode = ref<IslandMode>(machine.getState().mode);
const activeTaskId = ref<string | null>(machine.getActiveTaskId());
let tickTimer: number | null = null;
let lastWindowMode: IslandMode | null = null;

const snapshot = computed(() => stateStore.snapshot);
const primaryTask = computed(() => snapshot.value.tasks.find((task) => task.id === activeTaskId.value) ?? stateStore.primaryTask);
const primaryQuota = computed(() => snapshot.value.quotas[0] ?? null);
const provider = computed(() =>
  primaryTask.value ? snapshot.value.providers.find((item) => item.id === primaryTask.value?.providerId) : snapshot.value.providers[0]
);

const quotaText = computed(() => {
  if (!primaryQuota.value || primaryQuota.value.remainingPercent === null) {
    return "额度暂不可用";
  }

  return `${primaryQuota.value.remainingPercent}%`;
});

const visualMode = computed(() => mode.value);

const syncState = async (state: IslandState): Promise<void> => {
  mode.value = state.mode;
  activeTaskId.value = state.activeTaskId;

  if (lastWindowMode !== state.mode) {
    lastWindowMode = state.mode;
    await window.codePulse.windows.setIslandMode(state.mode);
  }
};

const setMode = async (nextMode: IslandMode): Promise<void> => {
  await syncState(machine.setMode(nextMode));
};

const cycleMode = async (): Promise<void> => {
  if (visualMode.value === "persistent") {
    await syncState(machine.expandFromPersistent());
    return;
  }

  const nextMode: IslandMode = visualMode.value === "collapsed" ? "normal" : visualMode.value === "normal" ? "expanded" : "collapsed";
  await setMode(nextMode);
};

const openCenter = async (): Promise<void> => {
  await window.codePulse.windows.openTaskCenter(primaryTask.value?.id);
};

const snoozeTask = async (): Promise<void> => {
  if (!primaryTask.value) {
    return;
  }

  const until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await window.codePulse.tasks.snooze(primaryTask.value.id, until);
  await setMode("collapsed");
};

const handleMouseEnter = async (): Promise<void> => {
  await syncState(machine.setHovered(true));
};

const handleMouseLeave = async (): Promise<void> => {
  await syncState(machine.setHovered(false));
};

const handleWheel = (event: WheelEvent): void => {
  event.preventDefault();
  activeTaskId.value = machine.handleWheel(event.deltaY);
};

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    void setMode("collapsed");
  }
};

watch(
  snapshot,
  (nextSnapshot) => {
    void syncState(machine.applySnapshot(nextSnapshot));
  },
  {
    immediate: true
  }
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  tickTimer = window.setInterval(() => {
    void syncState(machine.tick());
  }, 500);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);

  if (tickTimer) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
});
</script>

<template>
  <main
    class="island-shell"
    :class="`island-shell--${visualMode}`"
    @click="cycleMode"
    @dblclick.stop="openCenter"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @wheel="handleWheel"
  >
    <div class="island-drag-strip" aria-hidden="true" />
    <section v-if="visualMode === 'collapsed'" class="island-collapsed">
      <div class="agent-mark">{{ provider?.name.slice(0, 1) ?? "C" }}</div>
      <span class="pulse-dot" />
      <strong>{{ provider?.name ?? "CodePulse" }}</strong>
      <span>{{ snapshot.summary.aggregateText }}</span>
      <b>{{ quotaText }}</b>
    </section>

    <section v-else-if="visualMode === 'normal'" class="island-normal">
      <div class="agent-mark agent-mark--large">{{ provider?.name.slice(0, 1) ?? "C" }}</div>
      <div class="island-normal__content">
        <strong>{{ provider?.name ?? "CodePulse" }}</strong>
        <span>{{ primaryTask?.stage ?? snapshot.summary.aggregateText }}</span>
        <small>{{ primaryTask?.lastActivityText ?? "当前没有运行中的任务" }}</small>
      </div>
      <div class="quota-ring">{{ quotaText }}</div>
    </section>

    <section v-else class="island-expanded" @click.stop>
      <header>
        <div class="agent-mark agent-mark--large">{{ provider?.name.slice(0, 1) ?? "C" }}</div>
        <div>
          <strong>{{ provider?.name ?? "CodePulse" }}</strong>
          <span>{{ primaryTask?.title ?? snapshot.summary.aggregateText }}</span>
          <small>{{ primaryTask?.lastActivityText ?? "当前没有运行中的任务" }}</small>
        </div>
        <button type="button" @click="setMode('collapsed')">×</button>
      </header>
      <div class="island-expanded__grid">
        <div class="island-panel">
          <h2>任务列表</h2>
          <div v-for="task in snapshot.tasks.slice(0, 3)" :key="task.id" class="mini-task">
            <span>{{ task.title }}</span>
            <b>{{ task.stage }}</b>
          </div>
        </div>
        <div class="island-panel">
          <h2>最近活动</h2>
          <div v-for="activity in snapshot.activities.slice(0, 4)" :key="activity.id" class="activity-line">
            <time>{{ new Date(activity.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) }}</time>
            <span>{{ activity.title }}</span>
          </div>
        </div>
      </div>
      <footer>
        <el-button type="primary" size="small" @click="openCenter">打开任务中心</el-button>
        <el-button size="small" @click="snoozeTask">稍后提醒</el-button>
      </footer>
    </section>
  </main>
</template>
