<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useStateStore } from "../../stores/stateStore";
import TaskCard from "../../components/TaskCard.vue";

const stateStore = useStateStore();

const closeOnEsc = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    void window.codePulse.windows.closePopup();
  }
};

const openSettings = (): void => {
  void window.codePulse.windows.openSettings();
};

const openTaskCenter = (): void => {
  void window.codePulse.windows.openTaskCenter();
};

onMounted(() => {
  window.addEventListener("keydown", closeOnEsc);
});

onUnmounted(() => {
  window.removeEventListener("keydown", closeOnEsc);
});
</script>

<template>
  <main class="popup-shell">
    <header class="popup-header">
      <div>
        <strong>CodePulse</strong>
        <span>{{ stateStore.snapshot.summary.aggregateText }}</span>
      </div>
      <div class="popup-header__actions">
        <button type="button" title="勿扰">◐</button>
        <button type="button" title="设置" @click="openSettings">⚙</button>
      </div>
    </header>

    <section class="stat-strip">
      <div>
        <b>{{ stateStore.snapshot.summary.runningTaskCount }}</b>
        <span>运行中</span>
      </div>
      <div>
        <b>{{ stateStore.snapshot.summary.waitingTaskCount }}</b>
        <span>待处理</span>
      </div>
      <div>
        <b>{{ stateStore.snapshot.summary.failedTaskCount }}</b>
        <span>失败</span>
      </div>
    </section>

    <section class="popup-section">
      <h2>运行中</h2>
      <TaskCard
        v-for="task in stateStore.snapshot.tasks"
        :key="task.id"
        compact
        :task="task"
        :provider="stateStore.snapshot.providers.find((provider) => provider.id === task.providerId)"
      />
      <div v-if="stateStore.snapshot.tasks.length === 0" class="empty-state">当前没有运行中的任务</div>
    </section>

    <section class="quota-list">
      <h2>额度</h2>
      <div v-for="quota in stateStore.snapshot.quotas" :key="quota.id" class="quota-row">
        <span>{{ stateStore.snapshot.providers.find((provider) => provider.id === quota.providerId)?.name ?? quota.providerId }}</span>
        <b>{{ quota.remainingPercent === null ? "额度暂不可用" : `${quota.remainingPercent}%` }}</b>
      </div>
    </section>

    <footer class="popup-footer">
      <el-button type="primary" @click="openTaskCenter">打开任务中心</el-button>
      <el-button @click="stateStore.refresh">刷新状态</el-button>
    </footer>
  </main>
</template>
