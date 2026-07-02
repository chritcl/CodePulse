<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStateStore } from "../../stores/stateStore";
import TaskCard from "../../components/TaskCard.vue";
import type { AgentActivity, AgentTask } from "../../../shared/types/agent";
import { buildCenterProviderFailures } from "./centerProviderFailures";
import {
  buildCenterRuntimeStats,
  buildCenterTaskSource,
  filterCenterTasks,
  formatCenterRuntimeMinutes,
  getCenterFilterOptions,
  getTaskTimeline,
  type CenterTaskStatusFilter,
  type CenterTaskTimeRange
} from "./centerTaskFilters";

const stateStore = useStateStore();
const selectedTaskId = ref<string | null>(null);
const keyword = ref("");
const statusFilter = ref<CenterTaskStatusFilter>("all");
const providerFilter = ref<string | null>(null);
const projectFilter = ref<string | null>(null);
const timeRange = ref<CenterTaskTimeRange>("all");
const actionMessage = ref<string | null>(null);
const historyTasks = ref<AgentTask[]>([]);
const historyActivities = ref<Record<string, AgentActivity[]>>({});
const historyLoading = ref(false);
const historyErrorMessage = ref<string | null>(null);

const statusFilters: Array<{ label: string; value: CenterTaskStatusFilter }> = [
  {
    label: "全部任务",
    value: "all"
  },
  {
    label: "运行中",
    value: "running"
  },
  {
    label: "等待处理",
    value: "waiting"
  },
  {
    label: "失败任务",
    value: "failed"
  },
  {
    label: "最近完成",
    value: "completed"
  },
  {
    label: "历史任务",
    value: "history"
  }
];

const timeRangeOptions: Array<{ label: string; value: CenterTaskTimeRange }> = [
  {
    label: "全部时间",
    value: "all"
  },
  {
    label: "今天",
    value: "today"
  },
  {
    label: "最近 24 小时",
    value: "last24h"
  },
  {
    label: "最近 7 天",
    value: "last7d"
  }
];

const isHistoryMode = computed(() => statusFilter.value === "history");

const taskSource = computed(() => buildCenterTaskSource(stateStore.snapshot.tasks, historyTasks.value, isHistoryMode.value));

const filterOptions = computed(() => getCenterFilterOptions(taskSource.value));
const runtimeStats = computed(() => buildCenterRuntimeStats(taskSource.value));
const providerFailures = computed(() => buildCenterProviderFailures(stateStore.snapshot.providers));

const filteredTasks = computed(() =>
  filterCenterTasks(taskSource.value, {
    status: statusFilter.value,
    keyword: keyword.value,
    providerId: providerFilter.value,
    projectName: projectFilter.value,
    timeRange: timeRange.value
  })
);

const selectedTask = computed<AgentTask | null>(() => {
  if (selectedTaskId.value) {
    return taskSource.value.find((task) => task.id === selectedTaskId.value) ?? null;
  }

  return filteredTasks.value.find((task) => task.id === stateStore.snapshot.summary.primaryTaskId) ?? filteredTasks.value[0] ?? stateStore.primaryTask;
});

const selectedTimeline = computed<AgentActivity[]>(() => {
  const taskId = selectedTask.value?.id ?? null;
  const currentTimeline = getTaskTimeline(stateStore.snapshot.activities, taskId);

  if (!isHistoryMode.value || currentTimeline.length > 0 || !taskId) {
    return currentTimeline;
  }

  return getTaskTimeline(historyActivities.value[taskId] ?? [], taskId);
});

const selectedProvider = computed(() =>
  selectedTask.value ? stateStore.snapshot.providers.find((provider) => provider.id === selectedTask.value?.providerId) : undefined
);

const taskCountText = computed(() => `${isHistoryMode.value ? "历史" : "当前"} ${filteredTasks.value.length} 个任务`);

const loadHistoryTasks = async (): Promise<void> => {
  historyLoading.value = true;
  historyErrorMessage.value = null;

  try {
    historyTasks.value = await window.codePulse.tasks.listHistory(200);
  } catch (error) {
    historyErrorMessage.value = error instanceof Error ? error.message : "历史任务读取失败";
  } finally {
    historyLoading.value = false;
  }
};

const loadHistoryActivities = async (taskId: string | null): Promise<void> => {
  if (!isHistoryMode.value || !taskId || historyActivities.value[taskId]) {
    return;
  }

  try {
    const activities = await window.codePulse.tasks.getHistoryActivities(taskId, 100);
    historyActivities.value = {
      ...historyActivities.value,
      [taskId]: activities
    };
  } catch (error) {
    historyErrorMessage.value = error instanceof Error ? error.message : "历史活动读取失败";
  }
};

const setStatusFilter = (value: CenterTaskStatusFilter): void => {
  statusFilter.value = value;
};

const providerName = (providerId: string): string =>
  stateStore.snapshot.providers.find((provider) => provider.id === providerId)?.name ?? providerId;

const formatTime = (value: string): string => new Date(value).toLocaleString("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const latestActivityText = computed(() => (runtimeStats.value.latestActivityAt ? formatTime(runtimeStats.value.latestActivityAt) : "暂无活动"));

const longestInactiveText = computed(() =>
  runtimeStats.value.longestInactiveTask
    ? `${runtimeStats.value.longestInactiveTask.title} · ${formatCenterRuntimeMinutes(runtimeStats.value.longestInactiveTask.inactiveMinutes)}`
    : "暂无运行或等待任务"
);

const copySummary = async (): Promise<void> => {
  if (!selectedTask.value) {
    return;
  }

  try {
    await window.codePulse.tasks.copySummary(selectedTask.value.id);
    actionMessage.value = "任务摘要已复制";
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "复制摘要失败";
  }
};

const openProjectDirectory = async (): Promise<void> => {
  if (!selectedTask.value) {
    return;
  }

  try {
    await window.codePulse.tasks.open(selectedTask.value.id);
    actionMessage.value = "已请求打开项目目录";
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "打开项目目录失败";
  }
};

const openAgent = async (): Promise<void> => {
  if (!selectedTask.value) {
    return;
  }

  try {
    await window.codePulse.tasks.openAgent(selectedTask.value.id);
    actionMessage.value = "已请求打开 Agent";
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "打开 Agent 失败";
  }
};

const refreshCenter = async (): Promise<void> => {
  await stateStore.refresh();

  if (isHistoryMode.value) {
    await loadHistoryTasks();
  }
};

const openSettings = (): void => {
  void window.codePulse.windows.openSettings();
};

watch(statusFilter, (value) => {
  selectedTaskId.value = null;

  if (value === "history") {
    void loadHistoryTasks();
  }
});

watch(
  () => selectedTask.value?.id ?? null,
  (taskId) => {
    void loadHistoryActivities(taskId);
  }
);
</script>

<template>
  <main class="center-shell">
    <aside class="center-sidebar">
      <h1>CodePulse</h1>
      <button
        v-for="item in statusFilters"
        :key="item.value"
        type="button"
        class="filter-button"
        :class="{ 'filter-button--active': statusFilter === item.value }"
        @click="setStatusFilter(item.value)"
      >
        {{ item.label }}
      </button>

      <div class="filter-group">
        <span>数据源</span>
        <el-select v-model="providerFilter" clearable placeholder="全部数据源" size="small">
          <el-option v-for="providerId in filterOptions.providers" :key="providerId" :label="providerName(providerId)" :value="providerId" />
        </el-select>
      </div>

      <div class="filter-group">
        <span>项目</span>
        <el-select v-model="projectFilter" clearable placeholder="全部项目" size="small">
          <el-option v-for="projectName in filterOptions.projects" :key="projectName" :label="projectName" :value="projectName" />
        </el-select>
      </div>

      <div class="connection-box">
        <span>连接状态</span>
        <b>{{ stateStore.snapshot.summary.label }}</b>
      </div>

      <div class="provider-failure-box">
        <span>数据源状态</span>
        <div v-if="providerFailures.length === 0" class="provider-failure-empty">暂无异常数据源</div>
        <div
          v-for="item in providerFailures"
          :key="item.providerId"
          class="provider-failure-item"
          :class="`provider-failure-item--${item.severity}`"
        >
          <strong>{{ item.providerName }}</strong>
          <b>{{ item.statusLabel }}</b>
          <small>{{ item.recoveryText }}</small>
          <time v-if="item.lastErrorAt">{{ formatTime(item.lastErrorAt) }}</time>
        </div>
      </div>
    </aside>

    <section class="center-main">
      <header class="center-toolbar">
        <div>
          <h2>任务中心</h2>
          <span>{{ stateStore.snapshot.summary.aggregateText }} · {{ taskCountText }}</span>
        </div>
        <div class="center-toolbar__actions">
          <el-input v-model="keyword" clearable placeholder="搜索任务、项目、阶段或最近活动" />
          <el-select v-model="timeRange" class="time-range-select">
            <el-option v-for="item in timeRangeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-button @click="refreshCenter">刷新</el-button>
          <el-button type="primary" @click="openSettings">设置</el-button>
        </div>
      </header>
      <p v-if="historyLoading || historyErrorMessage" class="history-message">
        {{ historyLoading ? "正在读取历史任务" : historyErrorMessage }}
      </p>

      <div class="center-content">
        <section class="task-list">
          <TaskCard
            v-for="task in filteredTasks"
            :key="task.id"
            :task="task"
            :provider="stateStore.snapshot.providers.find((provider) => provider.id === task.providerId)"
            @click="selectedTaskId = task.id"
          />
          <div v-if="filteredTasks.length === 0" class="empty-state">没有符合筛选条件的任务</div>
        </section>

        <aside class="task-detail">
          <header class="task-detail__header">
            <div>
              <h2>{{ selectedTask?.title ?? "任务详情" }}</h2>
              <span>{{ selectedProvider?.name ?? selectedTask?.providerId ?? "未选择任务" }}</span>
            </div>
            <div class="task-detail__actions">
              <el-button size="small" :disabled="!selectedTask" @click="copySummary">复制摘要</el-button>
              <el-button size="small" :disabled="!selectedTask?.projectPath" @click="openAgent">打开 Agent</el-button>
              <el-button size="small" type="primary" :disabled="!selectedTask?.projectPath" @click="openProjectDirectory">打开项目目录</el-button>
            </div>
          </header>
          <p v-if="actionMessage" class="copy-message">{{ actionMessage }}</p>
          <dl v-if="selectedTask">
            <dt>当前阶段</dt>
            <dd>{{ selectedTask.stage }}</dd>
            <dt>最近活动</dt>
            <dd>{{ selectedTask.lastActivityText }}</dd>
            <dt>项目</dt>
            <dd>{{ selectedTask.projectName }}</dd>
            <dt>项目路径</dt>
            <dd>{{ selectedTask.projectPath ?? "暂不可用" }}</dd>
            <dt>更新时间</dt>
            <dd>{{ formatTime(selectedTask.updatedAt) }}</dd>
            <dt>错误</dt>
            <dd>{{ selectedTask.errorMessage ?? "无" }}</dd>
          </dl>
          <section class="timeline-panel">
            <h3>活动时间线</h3>
            <div v-for="activity in selectedTimeline" :key="activity.id" class="timeline-item">
              <time>{{ formatTime(activity.createdAt) }}</time>
              <strong>{{ activity.title }}</strong>
              <span>{{ activity.description }}</span>
            </div>
            <div v-if="selectedTask && selectedTimeline.length === 0" class="empty-state empty-state--compact">暂无活动记录</div>
          </section>
          <section class="runtime-panel">
            <h3>运行统计</h3>
            <div class="runtime-grid">
              <div>
                <b>{{ runtimeStats.totalTaskCount }}</b>
                <span>总任务</span>
              </div>
              <div>
                <b>{{ runtimeStats.runningTaskCount }}</b>
                <span>运行中</span>
              </div>
              <div>
                <b>{{ runtimeStats.waitingTaskCount }}</b>
                <span>等待</span>
              </div>
              <div>
                <b>{{ runtimeStats.failedTaskCount }}</b>
                <span>失败</span>
              </div>
              <div>
                <b>{{ runtimeStats.completedTaskCount }}</b>
                <span>完成</span>
              </div>
              <div>
                <b>{{ runtimeStats.historyTaskCount }}</b>
                <span>历史样本</span>
              </div>
            </div>
            <dl class="runtime-list">
              <dt>覆盖数据源</dt>
              <dd>{{ runtimeStats.providerCount }}</dd>
              <dt>覆盖项目</dt>
              <dd>{{ runtimeStats.projectCount }}</dd>
              <dt>平均结束耗时</dt>
              <dd>{{ formatCenterRuntimeMinutes(runtimeStats.averageFinishedDurationMinutes) }}</dd>
              <dt>最长无活动</dt>
              <dd>{{ longestInactiveText }}</dd>
              <dt>最近活动</dt>
              <dd>{{ latestActivityText }}</dd>
            </dl>
          </section>
          <div class="quota-panel">
            <h3>额度</h3>
            <div v-for="quota in stateStore.snapshot.quotas" :key="quota.id" class="quota-row">
              <span>{{ stateStore.snapshot.providers.find((provider) => provider.id === quota.providerId)?.name }}</span>
              <b>{{ quota.remainingPercent === null ? "额度暂不可用" : `${quota.remainingPercent}%` }}</b>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </main>
</template>
