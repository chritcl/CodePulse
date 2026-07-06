<template>
  <div class="card status-card">
    <div class="card-header-row">
      <h3>实时状态</h3>
      <button class="stats-toggle-btn" @click="$emit('toggle-panel')">
        {{ showStats ? '退出' : '数据统计' }}
      </button>
    </div>
    <div class="speed-monitor">
      <div class="speed-item">
        <span class="arrow up">
          <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M16 4C16.8 4 17.5 4.3 18.1 4.9L28.1 14.9C29.3 16.1 29.3 18 28.1 19.1C26.9 20.3 25 20.3 23.9 19.1L18 13.2V26C18 27.7 16.7 29 15 29C13.3 29 12 27.7 12 26V13.2L6.1 19.1C4.9 20.3 3 20.3 1.9 19.1C0.7 18 0.7 16.1 1.9 14.9L11.9 4.9C12.5 4.3 13.2 4 14 4H16Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <div class="speed-info">
          <span class="label">上传速度</span>
          <span class="value">{{ networkStore.uploadSpeed }}</span>
        </div>
      </div>
      <div class="speed-item">
        <span class="arrow down">
          <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M16 28C15.2 28 14.5 27.7 13.9 27.1L3.9 17.1C2.7 15.9 2.7 14 3.9 12.9C5.1 11.7 7 11.7 8.1 12.9L14 18.8V6C14 4.3 15.3 3 17 3C18.7 3 20 4.3 20 6V18.8L25.9 12.9C27.1 11.7 29 11.7 30.1 12.9C31.3 14 31.3 15.9 30.1 17.1L20.1 27.1C19.5 27.7 18.8 28 18 28H16Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <div class="speed-info">
          <span class="label">下载速度</span>
          <span class="value">{{ networkStore.downloadSpeed }}</span>
        </div>
      </div>
    </div>
    <div ref="chartRef" class="mini-chart" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as echarts from 'echarts';
import { useNetworkStore } from '@/stores';
import { useSettingsStore } from '@/stores';

interface Props {
  showStats: boolean;
}

defineProps<Props>();

defineEmits<{
  'toggle-panel': [];
}>();

const networkStore = useNetworkStore();
const settingsStore = useSettingsStore();

const chartRef = ref<HTMLElement | null>(null);
let chartInstance: echarts.ECharts | null = null;

/** 获取图表颜色 */
const getChartColors = () => {
  const isDark = document.documentElement.classList.contains('dark-theme');
  return {
    line: isDark ? '#60a5fa' : '#3b82f6',
    areaStart: isDark ? 'rgba(96, 165, 250, 0.4)' : 'rgba(59, 130, 246, 0.4)',
    areaEnd: isDark ? 'rgba(96, 165, 250, 0.0)' : 'rgba(59, 130, 246, 0.0)',
  };
};

/** 初始化图表 */
const initChart = () => {
  if (!chartRef.value || !echarts) return;
  chartInstance = echarts.init(chartRef.value);
  updateChartOption();
};

/** 更新图表选项 */
const updateChartOption = () => {
  if (!chartInstance) return;
  const colors = getChartColors();
  chartInstance.setOption({
    grid: { top: 5, bottom: 5, left: 0, right: 0 },
    xAxis: { type: 'category', boundaryGap: false, show: false },
    yAxis: { type: 'value', show: false, min: 0 },
    series: [
      {
        data: networkStore.chartDataQueue,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { color: colors.line, width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: colors.areaStart },
            { offset: 1, color: colors.areaEnd },
          ]),
        },
      },
    ],
  });
};

/** 处理窗口大小变更 */
const handleResize = () => {
  chartInstance?.resize();
};

// 监听图表数据变化
watch(
  () => networkStore.chartDataQueue,
  () => {
    chartInstance?.setOption({ series: [{ data: networkStore.chartDataQueue }] });
  }
);

// 监听主题变化
watch(
  () => settingsStore.themeMode,
  () => {
    updateChartOption();
  }
);

onMounted(() => {
  initChart();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  chartInstance?.dispose();
  window.removeEventListener('resize', handleResize);
});
</script>

<style scoped>
.status-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px var(--card-shadow);
  transition: all 0.3s ease;
}

.status-card:hover {
  box-shadow: 0 4px 12px var(--card-shadow-hover);
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.card-header-row h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--card-h3-color);
  margin: 0;
}

.stats-toggle-btn {
  padding: 4px 10px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  color: var(--text-body);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.stats-toggle-btn:hover {
  background: var(--card-bg);
}

.speed-monitor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}

.speed-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
}

.arrow svg {
  width: 18px;
  height: 18px;
}

.arrow.up {
  background: var(--arrow-up-bg);
  color: var(--arrow-up-color);
}

.arrow.down {
  background: var(--arrow-down-bg);
  color: var(--arrow-down-color);
}

.speed-info {
  display: flex;
  flex-direction: column;
}

.speed-info .label {
  font-size: 11px;
  color: var(--speed-label);
}

.speed-info .value {
  font-size: 16px;
  font-weight: 600;
  color: var(--speed-value);
  font-variant-numeric: tabular-nums;
}

.mini-chart {
  width: 100%;
  height: 60px;
  border: 1px solid var(--chart-border);
  border-radius: 8px;
}
</style>
