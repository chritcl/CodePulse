/**
 * 网络 Store
 *
 * 管理网速监控和流量统计状态。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { TrafficStats } from '@/types';
import { readString, writeString } from '@/shared/utils/storage';

export const useNetworkStore = defineStore('network', () => {
  // ============================================================
  // 状态
  // ============================================================

  /** 上传速度 (bytes/s) */
  const uploadSpeed = ref('0 B/s');

  /** 下载速度 (bytes/s) */
  const downloadSpeed = ref('0 B/s');

  /** 流量统计数据 */
  const trafficData = ref<TrafficStats>({});

  /** 图表数据队列 (最近 15 个数据点) */
  const chartDataQueue = ref<number[]>(Array(15).fill(0));

  /** 上次接收字节数 */
  let lastRx = 0;

  /** 上次发送字节数 */
  let lastTx = 0;

  /** 保存节流计数器 */
  let saveThrottleCounter = 0;

  // ============================================================
  // 计算属性
  // ============================================================

  /** 总上传流量 */
  const totalUpload = computed(() =>
    Object.values(trafficData.value).reduce((acc, curr) => acc + curr.up, 0)
  );

  /** 总下载流量 */
  const totalDownload = computed(() =>
    Object.values(trafficData.value).reduce((acc, curr) => acc + curr.down, 0)
  );

  /** 本月流量 */
  const monthTraffic = computed(() => {
    const currentMonth = getLocalYYYYMMDD(new Date()).slice(0, 7);
    return Object.entries(trafficData.value)
      .filter(([date]) => date.startsWith(currentMonth))
      .reduce((acc, [, data]) => acc + data.up + data.down, 0);
  });

  // ============================================================
  // 工具函数
  // ============================================================

  /** 获取本地日期格式为 YYYY-MM-DD */
  const getLocalYYYYMMDD = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  /** 格式化速度 */
  const formatSpeed = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B/s';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB/s';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB/s';
  };

  /** 格式化字节数为人类可读格式 */
  const formatBytesValue = (bytes: number): string => {
    if (bytes === 0) return '0';
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)).toString();
  };

  /** 格式化字节单位 */
  const formatBytesUnit = (bytes: number): string => {
    if (bytes === 0) return 'B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return sizes[i];
  };

  // ============================================================
  // 方法
  // ============================================================

  /** 加载流量统计数据 */
  const loadTrafficData = () => {
    try {
      const stored = readString('nsd_traffic_stats', '');
      if (stored) trafficData.value = JSON.parse(stored);
    } catch (e) {
      console.error('加载统计数据失败', e);
    }
  };

  /** 保存流量统计数据 */
  const saveTrafficData = () => {
    writeString('nsd_traffic_stats', JSON.stringify(trafficData.value));
  };

  /** 获取并更新网速 */
  const fetchSpeedStats = async () => {
    try {
      const [currentRx, currentTx] = await invoke<[number, number]>('get_network_stats');

      if (lastRx !== 0) {
        const rxDiff = currentRx - lastRx;
        const txDiff = currentTx - lastTx;
        downloadSpeed.value = formatSpeed(rxDiff);
        uploadSpeed.value = formatSpeed(txDiff);

        const speedMB = rxDiff / (1024 * 1024);

        // 更新图表数据队列
        chartDataQueue.value.push(speedMB);
        if (chartDataQueue.value.length > 15) chartDataQueue.value.shift();

        // 更新流量统计
        if (rxDiff > 0 || txDiff > 0) {
          const todayStr = getLocalYYYYMMDD(new Date());
          if (!trafficData.value[todayStr]) {
            trafficData.value[todayStr] = { up: 0, down: 0 };
          }
          trafficData.value[todayStr].down += rxDiff;
          trafficData.value[todayStr].up += txDiff;

          // 节流保存
          saveThrottleCounter++;
          if (saveThrottleCounter >= 5) {
            saveTrafficData();
            saveThrottleCounter = 0;
          }
        }
      }

      lastRx = currentRx;
      lastTx = currentTx;
    } catch (error) {
      console.error('控制台流量获取失败:', error);
    }
  };

  /** 初始化 */
  const initialize = () => {
    loadTrafficData();
  };

  // ============================================================
  // 导出
  // ============================================================

  return {
    // 状态
    uploadSpeed,
    downloadSpeed,
    trafficData,
    chartDataQueue,

    // 计算属性
    totalUpload,
    totalDownload,
    monthTraffic,

    // 方法
    fetchSpeedStats,
    saveTrafficData,
    initialize,

    // 工具函数
    formatBytesValue,
    formatBytesUnit,
    getLocalYYYYMMDD,
  };
});
