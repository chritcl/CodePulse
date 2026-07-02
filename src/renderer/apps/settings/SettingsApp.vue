<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { AppSettings } from "../../../shared/types/settings";
import {
  formatNotificationThresholdSummary,
  formatQuietHoursSummary,
  normalizeQuietHourInput
} from "./settingsNotificationControls";

const settings = ref<AppSettings | null>(null);
const saving = ref(false);
const customCommandArgsText = computed({
  get: () => settings.value?.providers.customCommand.args.join("\n") ?? "",
  set: (value: string) => {
    if (!settings.value) {
      return;
    }

    settings.value.providers.customCommand.args = value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
});

const quietHoursSummary = computed(() =>
  settings.value
    ? formatQuietHoursSummary(settings.value.notifications.quietHoursStart, settings.value.notifications.quietHoursEnd)
    : "未启用时间段"
);

const notificationThresholdSummary = computed(() =>
  settings.value
    ? formatNotificationThresholdSummary(settings.value.notifications.quotaWarningPercent, settings.value.notifications.staleMinutes)
    : ""
);

onMounted(async () => {
  settings.value = await window.codePulse.settings.get();
});

const normalizeQuietHours = (): void => {
  if (!settings.value) {
    return;
  }

  settings.value.notifications.quietHoursStart = normalizeQuietHourInput(settings.value.notifications.quietHoursStart);
  settings.value.notifications.quietHoursEnd = normalizeQuietHourInput(settings.value.notifications.quietHoursEnd);
};

const save = async (): Promise<void> => {
  if (!settings.value) {
    return;
  }

  normalizeQuietHours();
  saving.value = true;
  settings.value = await window.codePulse.settings.update(settings.value);
  saving.value = false;
};
</script>

<template>
  <main class="settings-shell">
    <header>
      <h1>设置</h1>
      <span>显示、通知和数据源</span>
    </header>

    <section v-if="settings" class="settings-grid">
      <div class="settings-row">
        <span>显示动态岛</span>
        <el-switch v-model="settings.display.islandEnabled" @change="save" />
      </div>
      <div class="settings-row">
        <span>鼠标穿透</span>
        <el-switch v-model="settings.display.mouseThrough" @change="save" />
      </div>
      <div class="settings-row">
        <span>贴边弹窗</span>
        <el-switch v-model="settings.display.taskbarPopupEnabled" @change="save" />
      </div>
      <div class="settings-row">
        <span>勿扰模式</span>
        <el-switch v-model="settings.notifications.doNotDisturb" @change="save" />
      </div>
      <div class="settings-row">
        <span>通知总开关</span>
        <el-switch v-model="settings.notifications.enabled" @change="save" />
      </div>
      <div class="settings-row settings-row--wide settings-row--stacked settings-row--policy">
        <span>勿扰时间段</span>
        <div class="settings-inline-fields">
          <el-input
            v-model="settings.notifications.quietHoursStart"
            clearable
            placeholder="开始时间，例如 22:00"
            @change="save"
            @clear="save"
          />
          <el-input
            v-model="settings.notifications.quietHoursEnd"
            clearable
            placeholder="结束时间，例如 07:30"
            @change="save"
            @clear="save"
          />
        </div>
        <small>{{ quietHoursSummary }}</small>
      </div>
      <div class="settings-row settings-row--wide settings-row--stacked settings-row--policy">
        <span>通知阈值</span>
        <div class="settings-number-fields">
          <label>
            <small>额度提醒</small>
            <el-input-number
              v-model="settings.notifications.quotaWarningPercent"
              :min="1"
              :max="100"
              :step="1"
              @change="save"
            />
          </label>
          <label>
            <small>无活动提醒</small>
            <el-input-number
              v-model="settings.notifications.staleMinutes"
              :min="1"
              :max="1440"
              :step="1"
              @change="save"
            />
          </label>
        </div>
        <small>{{ notificationThresholdSummary }}</small>
      </div>
      <div class="settings-row settings-row--wide">
        <span>自动收起延迟</span>
        <el-slider v-model="settings.display.autoCollapseDelay" :min="2000" :max="12000" :step="500" @change="save" />
      </div>
      <div class="settings-row settings-row--wide">
        <span>透明度</span>
        <el-slider v-model="settings.display.opacity" :min="0.75" :max="1" :step="0.01" @change="save" />
      </div>
      <div class="settings-row">
        <span>启用 Codex 数据源</span>
        <el-switch v-model="settings.providers.codex.enabled" @change="save" />
      </div>
      <div class="settings-row">
        <span>启用本机进程数据源</span>
        <el-switch v-model="settings.providers.process.enabled" @change="save" />
      </div>
      <div class="settings-row">
        <span>启用通用日志数据源</span>
        <el-switch v-model="settings.providers.log.enabled" @change="save" />
      </div>
      <div class="settings-row">
        <span>启用模拟数据源</span>
        <el-switch v-model="settings.providers.mock.enabled" @change="save" />
      </div>
      <div class="settings-row settings-row--wide settings-row--stacked">
        <span>Codex 状态源 JSON</span>
        <el-input
          v-model="settings.providers.codex.statusFilePath"
          clearable
          placeholder="可选，填写本机 UTF-8 JSON 状态文件路径"
          @change="save"
          @clear="save"
        />
      </div>
      <div class="settings-row settings-row--wide settings-row--stacked">
        <span>Codex 日志源 JSONL</span>
        <el-input
          v-model="settings.providers.codex.logFilePath"
          clearable
          placeholder="可选，填写本机 UTF-8 JSONL 日志文件路径"
          @change="save"
          @clear="save"
        />
      </div>
      <div class="settings-row settings-row--wide settings-row--stacked">
        <span>通用 Agent 日志源 JSONL</span>
        <el-input
          v-model="settings.providers.log.logFilePath"
          clearable
          placeholder="可选，填写本机 UTF-8 JSONL 日志文件路径，重启后生效"
          @change="save"
          @clear="save"
        />
      </div>
      <div class="settings-row">
        <span>启用自定义命令</span>
        <el-switch v-model="settings.providers.customCommand.enabled" @change="save" />
      </div>
      <div class="settings-row">
        <span>授权执行自定义命令</span>
        <el-switch v-model="settings.providers.customCommand.authorized" @change="save" />
      </div>
      <div class="settings-row settings-row--wide settings-row--stacked">
        <span>自定义命令路径</span>
        <el-input
          v-model="settings.providers.customCommand.commandPath"
          clearable
          placeholder="可选，填写本机状态命令路径，重启后生效"
          @change="save"
          @clear="save"
        />
      </div>
      <div class="settings-row settings-row--wide settings-row--stacked">
        <span>自定义命令参数</span>
        <el-input
          v-model="customCommandArgsText"
          type="textarea"
          :rows="3"
          placeholder="每行一个参数"
          @change="save"
        />
      </div>
      <div class="settings-row settings-row--wide settings-row--stacked">
        <span>自定义命令工作目录</span>
        <el-input
          v-model="settings.providers.customCommand.workingDirectory"
          clearable
          placeholder="可选，填写本机工作目录"
          @change="save"
          @clear="save"
        />
      </div>
      <div class="settings-row settings-row--wide">
        <span>自定义命令超时</span>
        <el-input-number
          v-model="settings.providers.customCommand.timeoutMs"
          :min="1000"
          :max="60000"
          :step="1000"
          @change="save"
        />
      </div>
      <div class="settings-row settings-row--wide">
        <span>自定义命令输出限制</span>
        <el-input-number
          v-model="settings.providers.customCommand.outputLimitBytes"
          :min="1024"
          :max="1048576"
          :step="1024"
          @change="save"
        />
      </div>
    </section>

    <footer>
      <el-button :loading="saving" type="primary" @click="save">保存设置</el-button>
    </footer>
  </main>
</template>
