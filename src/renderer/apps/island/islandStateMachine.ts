import type { AgentProvider, AgentStateSnapshot, AgentTask, QuotaSnapshot } from "../../../shared/types/agent";
import type { IslandMode } from "../../../shared/types/window";

export type IslandTrigger =
  | "idle"
  | "taskStarted"
  | "stageChanged"
  | "taskCompleted"
  | "quotaThreshold"
  | "persistent";

export interface IslandState {
  mode: IslandMode;
  activeTaskId: string | null;
  lastTrigger: IslandTrigger;
  hovered: boolean;
}

export interface IslandStateMachineOptions {
  autoCollapseDelay: number;
  eventThrottleMs?: number;
  quotaWarningPercent?: number;
  now?: () => number;
}

export interface IslandStateMachine {
  applySnapshot(snapshot: AgentStateSnapshot): IslandState;
  tick(): IslandState;
  setHovered(hovered: boolean): IslandState;
  setMode(mode: IslandMode): IslandState;
  expandFromPersistent(): IslandState;
  handleWheel(delta: number): string | null;
  getActiveTaskId(): string | null;
  getState(): IslandState;
}

const runningStatuses = new Set<AgentTask["status"]>(["detecting", "analyzing", "planning", "executing", "testing"]);
const disconnectedStatuses = new Set<AgentProvider["connectionStatus"]>([
  "disconnected",
  "error",
  "permissionDenied",
  "notFound",
  "notRunning",
  "stale"
]);

const defaultEventThrottleMs = 12_000;
const defaultQuotaWarningPercent = 15;

const cloneState = (state: IslandState): IslandState => ({
  ...state
});

const hasPersistentCondition = (snapshot: AgentStateSnapshot): boolean =>
  snapshot.tasks.some((task) => task.status === "waiting" || task.status === "failed") ||
  snapshot.quotas.some((quota) => quota.remainingPercent !== null && quota.remainingPercent <= 0) ||
  snapshot.providers.some((provider) => disconnectedStatuses.has(provider.connectionStatus));

const taskSignature = (task: AgentTask): string => `${task.id}:${task.status}:${task.stage}:${task.updatedAt}`;

const taskById = (tasks: AgentTask[], taskId: string | null): AgentTask | null =>
  taskId ? tasks.find((task) => task.id === taskId) ?? null : null;

const firstRunnableTask = (snapshot: AgentStateSnapshot): AgentTask | null => {
  const primaryTask = taskById(snapshot.tasks, snapshot.summary.primaryTaskId);

  return primaryTask ?? snapshot.tasks[0] ?? null;
};

const isQuotaWarning = (quota: QuotaSnapshot, warningPercent: number): boolean =>
  quota.remainingPercent !== null && quota.remainingPercent > 0 && quota.remainingPercent <= warningPercent;

export const createIslandStateMachine = (options: IslandStateMachineOptions): IslandStateMachine => {
  const now = options.now ?? (() => Date.now());
  const eventThrottleMs = options.eventThrottleMs ?? defaultEventThrottleMs;
  const quotaWarningPercent = options.quotaWarningPercent ?? defaultQuotaWarningPercent;
  let state: IslandState = {
    mode: "collapsed",
    activeTaskId: null,
    lastTrigger: "idle",
    hovered: false
  };
  let taskSignatures = new Map<string, string>();
  let quotaWarningProviders = new Set<string>();
  let taskIds: string[] = [];
  let lastTemporaryTriggerAt = -Infinity;
  let autoCollapseStartedAt: number | null = null;
  let persistentConditionActive = false;

  const setTemporaryMode = (trigger: IslandTrigger): void => {
    state = {
      ...state,
      mode: "normal",
      lastTrigger: trigger
    };
    lastTemporaryTriggerAt = now();
    autoCollapseStartedAt = now();
  };

  const setPersistentMode = (): void => {
    state = {
      ...state,
      mode: "persistent",
      lastTrigger: "persistent"
    };
    autoCollapseStartedAt = null;
  };

  const resetActiveTask = (snapshot: AgentStateSnapshot): void => {
    taskIds = snapshot.tasks.map((task) => task.id);

    if (state.activeTaskId && taskIds.includes(state.activeTaskId)) {
      return;
    }

    state = {
      ...state,
      activeTaskId: firstRunnableTask(snapshot)?.id ?? null
    };
  };

  const shouldThrottleTemporaryTrigger = (): boolean => now() - lastTemporaryTriggerAt < eventThrottleMs;

  const detectTemporaryTrigger = (snapshot: AgentStateSnapshot): IslandTrigger | null => {
    for (const task of snapshot.tasks) {
      const previousSignature = taskSignatures.get(task.id);

      if (!previousSignature && runningStatuses.has(task.status)) {
        return "taskStarted";
      }

      if (previousSignature && previousSignature !== taskSignature(task)) {
        if (task.status === "completed") {
          return "taskCompleted";
        }

        if (runningStatuses.has(task.status)) {
          return "stageChanged";
        }
      }
    }

    for (const quota of snapshot.quotas) {
      const wasWarning = quotaWarningProviders.has(quota.providerId);

      if (!wasWarning && isQuotaWarning(quota, quotaWarningPercent)) {
        return "quotaThreshold";
      }
    }

    return null;
  };

  const rememberSnapshot = (snapshot: AgentStateSnapshot): void => {
    taskSignatures = new Map(snapshot.tasks.map((task) => [task.id, taskSignature(task)]));
    quotaWarningProviders = new Set(
      snapshot.quotas
        .filter((quota) => quota.remainingPercent !== null && quota.remainingPercent <= quotaWarningPercent)
        .map((quota) => quota.providerId)
    );
  };

  return {
    applySnapshot(snapshot) {
      resetActiveTask(snapshot);

      const hasPersistent = hasPersistentCondition(snapshot);

      if (hasPersistent) {
        persistentConditionActive = true;

        if (state.mode !== "expanded") {
          setPersistentMode();
        }

        rememberSnapshot(snapshot);
        return cloneState(state);
      }

      if (persistentConditionActive) {
        persistentConditionActive = false;
        state = {
          ...state,
          mode: "collapsed",
          lastTrigger: "idle"
        };
        autoCollapseStartedAt = null;
      }

      const trigger = detectTemporaryTrigger(snapshot);

      if (trigger && (trigger !== "stageChanged" || !shouldThrottleTemporaryTrigger())) {
        setTemporaryMode(trigger);
      }

      rememberSnapshot(snapshot);
      return cloneState(state);
    },
    tick() {
      if (state.hovered || state.mode !== "normal" || autoCollapseStartedAt === null) {
        return cloneState(state);
      }

      if (now() - autoCollapseStartedAt >= options.autoCollapseDelay) {
        state = {
          ...state,
          mode: "collapsed",
          lastTrigger: "idle"
        };
        autoCollapseStartedAt = null;
      }

      return cloneState(state);
    },
    setHovered(hovered) {
      state = {
        ...state,
        hovered
      };

      if (!hovered && state.mode === "normal") {
        autoCollapseStartedAt = now();
      }

      return cloneState(state);
    },
    setMode(mode) {
      state = {
        ...state,
        mode
      };
      autoCollapseStartedAt = mode === "normal" ? now() : null;
      return cloneState(state);
    },
    expandFromPersistent() {
      if (state.mode === "persistent") {
        state = {
          ...state,
          mode: "expanded"
        };
      }

      return cloneState(state);
    },
    handleWheel(delta) {
      if (taskIds.length === 0) {
        state = {
          ...state,
          activeTaskId: null
        };
        return null;
      }

      const currentIndex = Math.max(taskIds.findIndex((taskId) => taskId === state.activeTaskId), 0);
      const direction = delta > 0 ? 1 : -1;
      const nextIndex = (currentIndex + direction + taskIds.length) % taskIds.length;
      state = {
        ...state,
        activeTaskId: taskIds[nextIndex] ?? null
      };

      return state.activeTaskId;
    },
    getActiveTaskId() {
      return state.activeTaskId;
    },
    getState() {
      return cloneState(state);
    }
  };
};
