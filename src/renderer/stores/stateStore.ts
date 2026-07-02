import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { AgentStateSnapshot } from "../../shared/types/agent";

const emptySnapshot = (): AgentStateSnapshot => {
  const now = new Date().toISOString();

  return {
    version: 0,
    generatedAt: now,
    providers: [],
    tasks: [],
    activities: [],
    quotas: [],
    summary: {
      status: "idle",
      label: "空闲",
      runningTaskCount: 0,
      waitingTaskCount: 0,
      failedTaskCount: 0,
      completedTaskCount: 0,
      disconnectedProviderCount: 0,
      quotaCriticalProviderCount: 0,
      primaryTaskId: null,
      aggregateText: "空闲",
      hasStaleData: false,
      updatedAt: now
    }
  };
};

export const useStateStore = defineStore("state", () => {
  const snapshot = ref<AgentStateSnapshot>(emptySnapshot());
  const loading = ref(true);
  const errorMessage = ref<string | null>(null);
  let unsubscribe: (() => void) | null = null;

  const primaryTask = computed(() =>
    snapshot.value.tasks.find((task) => task.id === snapshot.value.summary.primaryTaskId) ?? snapshot.value.tasks[0] ?? null
  );

  const runningTasks = computed(() =>
    snapshot.value.tasks.filter((task) => ["detecting", "analyzing", "planning", "executing", "testing"].includes(task.status))
  );

  const waitingTasks = computed(() => snapshot.value.tasks.filter((task) => task.status === "waiting"));

  const failedTasks = computed(() => snapshot.value.tasks.filter((task) => task.status === "failed"));

  const initialize = async (): Promise<void> => {
    if (unsubscribe) {
      return;
    }

    try {
      snapshot.value = await window.codePulse.state.getSnapshot();
      unsubscribe = window.codePulse.state.subscribe((nextSnapshot) => {
        snapshot.value = nextSnapshot;
      });
      errorMessage.value = null;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "状态读取失败";
    } finally {
      loading.value = false;
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      snapshot.value = await window.codePulse.state.refresh();
      errorMessage.value = null;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "刷新失败";
    }
  };

  const dispose = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };

  return {
    snapshot,
    loading,
    errorMessage,
    primaryTask,
    runningTasks,
    waitingTasks,
    failedTasks,
    initialize,
    refresh,
    dispose
  };
});
