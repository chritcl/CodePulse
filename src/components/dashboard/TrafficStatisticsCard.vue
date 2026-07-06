<template>
  <div class="card stats-card">
    <div class="card-header-row">
      <h3>数据统计</h3>
      <select v-model="chartType" class="theme-select" @change="updateChart">
        <option value="bar">柱状图</option>
        <option value="line">折线图</option>
      </select>
    </div>

    <div class="stats-overview">
      <div class="stat-box">
        <span class="stat-label">总上传</span>
        <span class="stat-val">{{ networkStore.formatBytesValue(networkStore.totalUpload) }}</span>
        <span class="stat-unit">{{ networkStore.formatBytesUnit(networkStore.totalUpload) }}</span>
      </div>
      <div class="stat-box">
        <span class="stat-label">总下载</span>
        <span class="stat-val">{{
          networkStore.formatBytesValue(networkStore.totalDownload)
        }}</span>
        <span class="stat-unit">{{
          networkStore.formatBytesUnit(networkStore.totalDownload)
        }}</span>
      </div>
      <div class="stat-box">
        <span class="stat-label">本月流量</span>
        <span class="stat-val">{{ networkStore.formatBytesValue(networkStore.monthTraffic) }}</span>
        <span class="stat-unit">{{ networkStore.formatBytesUnit(networkStore.monthTraffic) }}</span>
      </div>
    </div>

    <div ref="chartRef" class="stats-chart-container" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as echarts from 'echarts';
import { useNetworkStore, useSettingsStore } from '@/stores';

const networkStore = useNetworkStore();
const settingsStore = useSettingsStore();

const chartRef = ref<HTMLElement | null>(null);
let chartInstance: echarts.ECharts | null = null;

const chartType = ref<'bar' | 'line'>('bar');

/** 更新统计图表 */
const updateChart = () => {
  if (!chartInstance) return;

  const isDark = document.documentElement.classList.contains('dark-theme');
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const splitLineColor = isDark ? '#383c41' : '#f1f5f9';

  const days: string[] = [];
  const upData: number[] = [];
  const downData: number[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = networkStore.getLocalYYYYMMDD(d);
    days.push(dateStr.slice(5));

    const dayData = networkStore.trafficData[dateStr] || { up: 0, down: 0 };
    upData.push(Number((dayData.up / (1024 * 1024)).toFixed(2)));
    downData.push(Number((dayData.down / (1024 * 1024)).toFixed(2)));
  }

  chartInstance.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['上传 (MB)', '下载 (MB)'], textStyle: { color: textColor }, top: 0 },
    grid: { left: '2%', right: '2%', bottom: '0%', containLabel: true },
    xAxis: {
      type: 'category',
      data: days,
      axisLabel: { color: textColor },
      axisLine: { lineStyle: { color: splitLineColor } },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: splitLineColor, type: 'dashed' } },
      axisLabel: { color: textColor },
    },
    series: [
      {
        name: '上传 (MB)',
        type: chartType.value,
        smooth: true,
        data: upData,
        itemStyle: { color: isDark ? '#60a5fa' : '#3b82f6' },
        barMaxWidth: 15,
      },
      {
        name: '下载 (MB)',
        type: chartType.value,
        smooth: true,
        data: downData,
        itemStyle: { color: isDark ? '#34d399' : '#10b981' },
        barMaxWidth: 15,
      },
    ],
  });
};

/** 初始化图表 */
const initChart = () => {
  if (!chartRef.value || !echarts) return;
  chartInstance = echarts.init(chartRef.value);
  updateChart();
};

/** 处理窗口大小变更 */
const handleResize = () => {
  chartInstance?.resize();
};

// 监听主题变化
watch(
  () => settingsStore.themeMode,
  () => {
    updateChart();
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
.stats-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px var(--card-shadow);
  transition: all 0.3s ease;
}

.stats-card:hover {
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

.theme-select {
  padding: 4px 8px;
  border: 1px solid var(--select-border);
  border-radius: 6px;
  background: var(--select-bg);
  color: var(--select-text);
  font-size: 11px;
  cursor: pointer;
}

.stats-overview {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}

.stat-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.stat-label {
  font-size: 11px;
  color: var(--speed-label);
  margin-bottom: 4px;
}

.stat-val {
  font-size: 18px;
  font-weight: 600;
  color: var(--speed-value);
  font-variant-numeric: tabular-nums;
}

.stat-unit {
  font-size: 11px;
  color: var(--speed-label);
}

.stats-chart-container {
  width: 100%;
  height: 200px;
  border: 1px solid var(--chart-border);
  border-radius: 8px;
}
</style>
