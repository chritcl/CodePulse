<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { AppSettings, IslandCustomPosition } from "../../../shared/types/settings";
import type { DisplayLike } from "../../../shared/types/window";
import {
  formatDisplayLabel,
  formatIslandPlacementSummary,
  islandPositionOptions,
  normalizeIslandCustomPositionInput,
  normalizeTargetDisplayId
} from "./settingsDisplayControls";
import {
  formatNotificationThresholdSummary,
  formatQuietHoursSummary,
  normalizeQuietHourInput
} from "./settingsNotificationControls";

const settings = ref<AppSettings | null>(null);
const displays = ref<DisplayLike[]>([]);
const displayErrorMessage = ref<string | null>(null);
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

const islandPlacementSummary = computed(() =>
  settings.value ? formatIslandPlacementSummary(settings.value.display, displays.value) : "暂未读取显示设置"
);

const displayOptions = computed(() =>
  displays.value.map((display) => ({
    value: display.id,
    label: formatDisplayLabel(display)
  }))
);

const getFallbackCustomPosition = (): IslandCustomPosition => ({
  displayId: settings.value?.display.targetDisplayId ?? displays.value.find((display) => display.primary)?.id ?? displays.value[0]?.id ?? null,
  x: 0,
  y: 0
});

const updateIslandCustomPosition = (partial: Partial<IslandCustomPosition>): void => {
  if (!settings.value) {
    return;
  }

  const currentPosition = settings.value.display.islandCustomPosition ?? getFallbackCustomPosition();
  settings.value.display.islandPosition = "free";
  settings.value.display.islandCustomPosition = normalizeIslandCustomPositionInput(
    {
      ...currentPosition,
      ...partial
    },
    displays.value
  );
};

const islandCustomDisplayId = computed({
  get: () => settings.value?.display.islandCustomPosition?.displayId ?? getFallbackCustomPosition().displayId,
  set: (value: string | null) => {
    updateIslandCustomPosition({
      displayId: value
    });
  }
});

const islandCustomX = computed({
  get: () => settings.value?.display.islandCustomPosition?.x ?? 0,
  set: (value: number | undefined) => {
    updateIslandCustomPosition({
      x: value ?? 0
    });
  }
});

const islandCustomY = computed({
  get: () => settings.value?.display.islandCustomPosition?.y ?? 0,
  set: (value: number | undefined) => {
    updateIslandCustomPosition({
      y: value ?? 0
    });
  }
});

const refreshDisplays = async (): Promise<void> => {
  try {
    displays.value = await window.codePulse.system.getDisplays();
    displayErrorMessage.value = null;

    if (settings.value) {
      settings.value.display.targetDisplayId = normalizeTargetDisplayId(
        settings.value.display.targetDisplayId,
        displays.value,
        settings.value.display.followActiveDisplay
      );

      if (settings.value.display.islandCustomPosition) {
        settings.value.display.islandCustomPosition = normalizeIslandCustomPositionInput(
          settings.value.display.islandCustomPosition,
          displays.value
        );
      }
    }
  } catch (error) {
    displayErrorMessage.value = error instanceof Error ? error.message : "显示器列表读取失败";
  }
};

onMounted(async () => {
  const [loadedSettings] = await Promise.all([window.codePulse.settings.get(), refreshDisplays()]);
  settings.value = loadedSettings;
  settings.value.display.targetDisplayId = normalizeTargetDisplayId(
    settings.value.display.targetDisplayId,
    displays.value,
    settings.value.display.followActiveDisplay
  );
});

const normalizeQuietHours = (): void => {
  if (!settings.value) {
    return;
  }

  settings.value.notifications.quietHoursStart = normalizeQuietHourInput(settings.value.notifications.quietHoursStart);
  settings.value.notifications.quietHoursEnd = normalizeQuietHourInput(settings.value.notifications.quietHoursEnd);
};

const normalizeDisplayTarget = (): void => {
  if (!settings.value) {
    return;
  }

  settings.value.display.targetDisplayId = normalizeTargetDisplayId(
    settings.value.display.targetDisplayId,
    displays.value,
    settings.value.display.followActiveDisplay
  );

  if (settings.value.display.islandPosition === "free" || settings.value.display.islandCustomPosition) {
    settings.value.display.islandCustomPosition = normalizeIslandCustomPositionInput(
      settings.value.display.islandCustomPosition,
      displays.value
    );
  }
};

const save = async (): Promise<void> => {
  if (!settings.value) {
    return;
  }

  normalizeQuietHours();
  normalizeDisplayTarget();
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
      <div class="settings-row settings-row--wide settings-row--stacked settings-row--policy">
        <span>动态岛位置</span>
        <div class="settings-inline-fields">
          <el-select v-model="settings.display.islandPosition" placeholder="选择动态岛位置" @change="save">
            <el-option v-for="item in islandPositionOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-switch
            v-model="settings.display.followActiveDisplay"
            active-text="跟随活动显示器"
            inactive-text="固定显示器"
            @change="save"
          />
        </div>
        <small>{{ islandPlacementSummary }}</small>
      </div>
      <div class="settings-row settings-row--wide settings-row--stacked settings-row--policy">
        <span>目标显示器</span>
        <div class="settings-inline-fields">
          <el-select
            v-model="settings.display.targetDisplayId"
            clearable
            :disabled="settings.display.followActiveDisplay"
            placeholder="自动使用主显示器"
            @change="save"
            @clear="save"
          >
            <el-option v-for="item in displayOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-button @click="refreshDisplays">刷新显示器</el-button>
        </div>
        <small>{{ displayErrorMessage ?? (settings.display.followActiveDisplay ? "当前会跟随活动显示器" : "显示器断开时会回落到主显示器") }}</small>
      </div>
      <div
        v-if="settings.display.islandPosition === 'free'"
        class="settings-row settings-row--wide settings-row--stacked settings-row--policy"
      >
        <span>自由坐标</span>
        <div class="settings-coordinate-fields">
          <label>
            <small>显示器</small>
            <el-select v-model="islandCustomDisplayId" placeholder="选择坐标所属显示器" @change="save">
              <el-option v-for="item in displayOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
          <label>
            <small>X 坐标</small>
            <el-input-number v-model="islandCustomX" :min="0" :step="1" @change="save" />
          </label>
          <label>
            <small>Y 坐标</small>
            <el-input-number v-model="islandCustomY" :min="0" :step="1" @change="save" />
          </label>
        </div>
        <small>保存时会按目标显示器工作区自动限制坐标，避免动态岛移动到屏幕外。</small>
      </div>
      <div class="settings-row">
        <span>全屏自动隐藏</span>
        <el-switch v-model="settings.display.hideInFullscreen" @change="save" />
      </div>
      <div class="settings-row">
        <span>始终置顶</span>
        <el-switch v-model="settings.display.alwaysOnTop" @change="save" />
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
