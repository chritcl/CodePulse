<template>
  <section class="codex-integration-card" aria-label="Claude Code CLI 状态集成">
    <header class="codex-integration-header">
      <div>
        <h2>Claude Code CLI 集成</h2>
        <p>只管理用户 settings.json 中带有 codepulse-claude-v1 参数的 Hook。</p>
      </div>
      <button
        type="button"
        class="codex-secondary-action"
        aria-label="检测 Claude Code 集成"
        :disabled="integration.isChecking.value || integration.isActing.value"
        @click="void integration.refresh()"
      >
        {{ integration.isChecking.value ? '检测中…' : '检测环境' }}
      </button>
    </header>

    <div class="codex-status-grid">
      <p>
        <span>CLI：</span><strong>{{ cliLabel }}</strong>
      </p>
      <p>
        <span>CodePulse Hook：</span><strong>{{ hookLabel }}</strong>
      </p>
      <p>
        <span>Bridge：</span><strong>{{ bridgeLabel }}</strong>
      </p>
      <p>
        <span>监听状态：</span><strong>{{ listenerLabel }}</strong>
      </p>
    </div>

    <p class="codex-latest-event">
      <span>最近事件：</span>
      <strong>{{ latestEventLabel }}</strong>
      <small v-if="settingsStore.showClaudeTaskSummary && latestSession?.taskSummary">
        · {{ latestSession.taskSummary }}
      </small>
    </p>

    <p v-if="integration.status.value?.message" class="codex-status-message">
      {{ integration.status.value.message }}
    </p>

    <div class="codex-preferences" aria-label="Claude Code 显示偏好">
      <label class="codex-preference-row">
        <span>
          <strong>Claude Code 空闲时常驻</strong>
          <small>没有会话时以卫星岛待命，不会启停接收器。</small>
        </span>
        <input
          v-model="settingsStore.claudeIdleResident"
          type="checkbox"
          aria-label="Claude Code 空闲时常驻"
          @change="void syncDisplayPreferences()"
        />
      </label>
      <label class="codex-preference-row">
        <span>
          <strong>显示 Claude Code 脱敏任务摘要</strong>
          <small>默认关闭；开启后仅采集脱敏截断的提示词与 Task 标题。</small>
        </span>
        <input
          v-model="settingsStore.showClaudeTaskSummary"
          type="checkbox"
          aria-label="显示 Claude Code 脱敏任务摘要"
          @change="void syncDisplayPreferences()"
        />
      </label>
      <label class="codex-preference-row">
        <span>
          <strong>显示 Claude Code 脱敏操作摘要</strong>
          <small>只显示安全阶段说明，不显示命令、路径或工具正文。</small>
        </span>
        <input
          v-model="settingsStore.showClaudeOperationSummary"
          type="checkbox"
          aria-label="显示 Claude Code 脱敏操作摘要"
          @change="void syncDisplayPreferences()"
        />
      </label>
    </div>

    <div class="codex-integration-actions">
      <button
        type="button"
        class="codex-primary-action"
        aria-label="预览安装或修复 Claude Code 集成"
        :disabled="integration.isActing.value || !canInstall"
        @click="void integration.previewAction('install_or_repair')"
      >
        预览安装或修复
      </button>
      <button
        type="button"
        class="codex-secondary-action"
        aria-label="预览卸载 Claude Code 集成"
        :disabled="integration.isActing.value || !canUninstall"
        @click="void integration.previewAction('uninstall')"
      >
        预览卸载
      </button>
    </div>

    <section
      v-if="integration.preview.value"
      class="codex-preview"
      aria-label="Claude Code 集成预览"
    >
      <h3>{{ previewTitle }}</h3>
      <p class="codex-preview-path">目标配置：{{ integration.preview.value.targetFile }}</p>
      <p class="codex-preview-path">Bridge：{{ integration.preview.value.bridgeFile }}</p>
      <ul class="codex-preview-list">
        <li v-for="change in integration.preview.value.changes" :key="change">{{ change }}</li>
      </ul>
      <ul v-if="integration.preview.value.warnings.length" class="codex-preview-list is-warning">
        <li v-for="warning in integration.preview.value.warnings" :key="warning">{{ warning }}</li>
      </ul>
      <div class="codex-preview-actions">
        <button
          type="button"
          class="codex-secondary-action"
          :disabled="integration.isActing.value"
          @click="integration.cancelPreview"
        >
          取消
        </button>
        <button
          type="button"
          class="codex-primary-action"
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
      <p v-if="integration.lastResult.value.bridgeCleanupPending">Bridge 待手动清理。</p>
      <p v-if="integration.lastResult.value.listenerStartFailed">
        配置已写入，但本地接收器未能启动。
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
import { useClaudeIntegration, useClaudeStatus } from '@/composables';
import { getClaudeListenerLabel, getClaudePhaseLabel } from '@/modules/claude/presentation';
import { useSettingsStore } from '@/stores';
import { CLAUDE_DISPLAY_PREFERENCES_UPDATED } from '@/shared/ipc/events';
import { claudeCommands } from '@/shared/ipc/commands';

const settingsStore = useSettingsStore();
const integration = useClaudeIntegration();
const claudeStatus = useClaudeStatus();

const cliLabel = computed(() => {
  const status = integration.status.value;
  if (status?.cli === 'ready') return `已就绪 · ${status.cliVersion}`;
  if (status?.cli === 'unsupported') return `版本过低 · ${status.cliVersion || '未知'}`;
  return '未找到';
});
const hookLabel = computed(() => {
  const status = integration.status.value?.hook;
  if (status === 'installed') return '已安装';
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
  getClaudeListenerLabel(claudeStatus.snapshot.value.listenerStatus)
);
const latestSession = computed(() => claudeStatus.snapshot.value.representativeSession);
const latestEventLabel = computed(() =>
  latestSession.value
    ? `${getClaudePhaseLabel(latestSession.value.effectivePhase)} · CLI`
    : '尚未收到事件'
);
const canInstall = computed(
  () =>
    integration.status.value?.cli === 'ready' &&
    integration.status.value.hook !== 'manual_intervention' &&
    !integration.status.value.allowManagedHooksOnly
);
const canUninstall = computed(() => {
  const status = integration.status.value?.hook;
  return status === 'installed' || status === 'needs_repair';
});
const previewTitle = computed(() =>
  integration.preview.value?.action === 'uninstall' ? '卸载预览' : '安装或修复预览'
);

const syncDisplayPreferences = async () => {
  try {
    await claudeCommands.setTaskSummaryCapture(settingsStore.showClaudeTaskSummary);
    await emit(CLAUDE_DISPLAY_PREFERENCES_UPDATED, {
      idleResident: settingsStore.claudeIdleResident,
      showOperationSummary: settingsStore.showClaudeOperationSummary,
      showTaskSummary: settingsStore.showClaudeTaskSummary,
    });
  } catch (error) {
    console.error('同步 Claude Code 显示偏好失败:', error);
  }
};

onMounted(() => {
  void integration.start();
  void claudeStatus.start();
  void syncDisplayPreferences();
});
</script>

<style scoped src="./CodexIntegrationSettings.css"></style>
