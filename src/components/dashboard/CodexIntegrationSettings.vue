<template>
  <section class="codex-integration-card" aria-label="Codex 状态集成">
    <header class="codex-integration-header">
      <div>
        <h2>Codex 状态集成</h2>
        <p>只管理用户层带有 CodePulse 标记的 Hook，不会替你启用 Codex 全局 Hooks。</p>
      </div>
      <button
        type="button"
        class="codex-secondary-action"
        aria-label="检测 Codex 集成"
        :disabled="integration.isChecking.value || integration.isActing.value"
        @click="void integration.refresh()"
      >
        {{ integration.isChecking.value ? '检测中…' : '检测环境' }}
      </button>
    </header>

    <div class="codex-status-grid">
      <p>
        <span>全局 Hooks：</span>
        <strong>{{ globalHooksLabel }}</strong>
      </p>
      <p>
        <span>CodePulse Hook：</span>
        <strong>{{ hookLabel }}</strong>
      </p>
      <p>
        <span>Bridge：</span>
        <strong>{{ bridgeLabel }}</strong>
      </p>
      <p>
        <span>监听状态：</span>
        <strong>{{ listenerLabel }}</strong>
      </p>
    </div>

    <p class="codex-latest-event">
      <span>最近事件：</span>
      <strong>{{ latestEventLabel }}</strong>
      <small v-if="settingsStore.showCodexTaskSummary && latestTask?.taskSummary">
        · {{ latestTask.taskSummary }}
      </small>
    </p>

    <p v-if="integration.status.value?.message" class="codex-status-message">
      {{ integration.status.value.message }}
    </p>

    <div class="codex-preferences" aria-label="Codex 显示偏好">
      <label class="codex-preference-row">
        <span>
          <strong>Codex 空闲时常驻</strong>
          <small>没有任务时以卫星岛待命，不会启停接收器。</small>
        </span>
        <input
          v-model="settingsStore.codexIdleResident"
          type="checkbox"
          aria-label="Codex 空闲时常驻"
          @change="void syncDisplayPreferences()"
        />
      </label>
      <label class="codex-preference-row">
        <span>
          <strong>显示 Codex 脱敏任务摘要</strong>
          <small>默认关闭；开启后 Bridge 仅采集当前提示的本机脱敏摘要。</small>
        </span>
        <input
          v-model="settingsStore.showCodexTaskSummary"
          type="checkbox"
          aria-label="显示 Codex 脱敏任务摘要"
          @change="void syncDisplayPreferences()"
        />
      </label>
      <label class="codex-preference-row">
        <span>
          <strong>显示 Codex 脱敏操作摘要</strong>
          <small>只控制灵动岛显示，摘要已由 Bridge 与 Rust 脱敏。</small>
        </span>
        <input
          v-model="settingsStore.showCodexOperationSummary"
          type="checkbox"
          aria-label="显示 Codex 脱敏操作摘要"
          @change="void syncDisplayPreferences()"
        />
      </label>
    </div>

    <div class="codex-integration-actions">
      <button
        type="button"
        class="codex-primary-action"
        aria-label="预览安装或修复"
        :disabled="integration.isActing.value"
        @click="void integration.previewAction('install_or_repair')"
      >
        预览安装或修复
      </button>
      <button
        type="button"
        class="codex-secondary-action"
        aria-label="预览卸载"
        :disabled="integration.isActing.value || !canUninstall"
        @click="void integration.previewAction('uninstall')"
      >
        预览卸载
      </button>
    </div>

    <section v-if="integration.preview.value" class="codex-preview" aria-label="Codex 集成预览">
      <h3>{{ previewTitle }}</h3>
      <p class="codex-preview-path">目标配置：{{ integration.preview.value.targetFile }}</p>
      <p class="codex-preview-path">Bridge：{{ integration.preview.value.bridgeFile }}</p>
      <ul v-if="integration.preview.value.changes.length" class="codex-preview-list">
        <li v-for="change in integration.preview.value.changes" :key="change">{{ change }}</li>
      </ul>
      <ul v-if="integration.preview.value.warnings.length" class="codex-preview-list is-warning">
        <li v-for="warning in integration.preview.value.warnings" :key="warning">{{ warning }}</li>
      </ul>
      <div class="codex-preview-actions">
        <button
          type="button"
          class="codex-secondary-action"
          aria-label="取消 Codex 集成预览"
          :disabled="integration.isActing.value"
          @click="integration.cancelPreview"
        >
          取消
        </button>
        <button
          type="button"
          class="codex-primary-action"
          aria-label="确认 Codex 集成操作"
          :disabled="integration.isActing.value || !integration.preview.value.canConfirm"
          @click="void integration.confirmPreview()"
        >
          {{ integration.isActing.value ? '处理中…' : '确认执行' }}
        </button>
      </div>
    </section>

    <div v-if="integration.lastResult.value" class="codex-action-result" aria-live="polite">
      <p v-if="integration.lastResult.value.backupFile">
        已创建配置备份：{{ integration.lastResult.value.backupFile }}
      </p>
      <p v-if="integration.lastResult.value.bridgeCleanupPending">
        Bridge 待手动清理；CodePulse 不会回滚已经成功完成的 Hook 卸载。
      </p>
      <p v-if="integration.lastResult.value.listenerStartFailed">
        配置已写入，但本地接收器未能启动，请使用“预览安装或修复”检查环境。
      </p>
    </div>

    <p v-if="integration.errorMessage.value" class="codex-error" role="alert">
      {{ integration.errorMessage.value }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { emit } from '@tauri-apps/api/event';
import { useCodexIntegration, useCodexStatus } from '@/composables';
import {
  getCodexListenerLabel,
  getCodexPhaseLabel,
  getCodexSourceLabel,
} from '@/modules/codex/presentation';
import { useSettingsStore } from '@/stores';
import { CODEX_DISPLAY_PREFERENCES_UPDATED } from '@/shared/ipc/events';
import { codexCommands } from '@/shared/ipc/commands';

const settingsStore = useSettingsStore();
const integration = useCodexIntegration();
const codexStatus = useCodexStatus();

const globalHooksLabel = computed(() => {
  const status = integration.status.value?.globalHooks;
  if (status === 'enabled') return '已启用';
  if (status === 'organization_managed') return '由组织管理';
  return '需在 Codex 中手动启用';
});

const hookLabel = computed(() => {
  const status = integration.status.value?.hook;
  if (status === 'installed') return '已安装';
  if (status === 'waiting_trust') {
    return codexStatus.snapshot.value.listenerStatus === 'running' ? '已安装' : '等待 Codex 信任';
  }
  if (status === 'needs_repair') return '需要修复';
  if (status === 'manual_intervention') return '需人工处理';
  return '未安装';
});

const bridgeLabel = computed(() => {
  const status = integration.status.value?.bridge;
  if (status === 'ready') return '已就绪';
  if (status === 'needs_repair') return '需要修复';
  return '缺失';
});

const listenerLabel = computed(() =>
  getCodexListenerLabel(codexStatus.snapshot.value.listenerStatus)
);
const latestTask = computed(() => codexStatus.snapshot.value.representativeTask);
const latestEventLabel = computed(() => {
  if (!latestTask.value) return '尚未收到事件';

  return `${getCodexPhaseLabel(latestTask.value.phase)} · ${getCodexSourceLabel(
    latestTask.value.source
  )}`;
});
const canUninstall = computed(() => {
  const status = integration.status.value?.hook;
  return status === 'installed' || status === 'waiting_trust' || status === 'needs_repair';
});
const previewTitle = computed(() =>
  integration.preview.value?.action === 'uninstall' ? '卸载预览' : '安装或修复预览'
);

const syncDisplayPreferences = async () => {
  try {
    await codexCommands.setTaskSummaryCapture(settingsStore.showCodexTaskSummary);
    await emit(CODEX_DISPLAY_PREFERENCES_UPDATED, {
      idleResident: settingsStore.codexIdleResident,
      showOperationSummary: settingsStore.showCodexOperationSummary,
      showTaskSummary: settingsStore.showCodexTaskSummary,
    });
  } catch (error) {
    console.error('同步 Codex 显示偏好失败:', error);
  }
};

onMounted(() => {
  void integration.start();
  void codexStatus.start();
  void syncDisplayPreferences();
});
</script>

<style scoped src="./CodexIntegrationSettings.css"></style>
