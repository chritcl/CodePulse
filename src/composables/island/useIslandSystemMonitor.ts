import { computed, ref, type Ref } from 'vue';
import { systemCommands } from '@/shared/ipc/commands';
import type { HardwareStats, NetworkStats, SystemToastType } from '@/shared/ipc/contracts';
import type { IslandModuleVisualStatus } from '@/modules/island/display';

type NetworkStatus = 'good' | 'warning' | 'error';

interface SystemMonitorCommands {
  getNetworkStats: () => Promise<NetworkStats>;
  getHardwareStats: () => Promise<HardwareStats>;
  getNetworkLatency: () => Promise<number>;
}

interface IslandSystemMonitorOptions {
  hardwareEnabled: Ref<boolean>;
  rotationEnabled: Ref<boolean>;
  commands?: SystemMonitorCommands;
  now?: () => number;
  random?: () => number;
  onToast?: (text: string, type: SystemToastType) => void;
}

const HIGH_TRAFFIC_BYTES = 1024 * 1024;
const NETWORK_ERROR_DELAY_MS = 5_000;
const HARDWARE_STRONG_THRESHOLD = 90;
const HARDWARE_RECOVER_THRESHOLD = 85;
const SYSTEM_POLL_INTERVAL_MS = 800;
const LATENCY_POLL_INTERVAL_MS = 5_500;

const formatSpeed = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
};

/** 统一管理桌面岛的网络与硬件采样生命周期。 */
export const useIslandSystemMonitor = (options: IslandSystemMonitorOptions) => {
  const commands = options.commands ?? systemCommands;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const uploadSpeed = ref('0 KB/s');
  const downloadSpeed = ref('0 KB/s');
  const isHighDownload = ref(false);
  const isHighUpload = ref(false);
  const networkStatus = ref<NetworkStatus>('good');
  const cpuUsage = ref('0%');
  const gpuUsage = ref('0%');
  const memUsage = ref('0%');
  const hardwareStrongActive = ref(false);

  let lastRx = 0;
  let lastTx = 0;
  let lowTrafficStartTime = now();
  let hardwareHighSampleCount = 0;
  let systemTimer: number | null = null;
  let latencyTimer: number | null = null;
  let generation = 0;

  const hardwareVisualStatus = computed<IslandModuleVisualStatus>(() => {
    const maxUsage = Math.max(
      Number.parseInt(cpuUsage.value) || 0,
      Number.parseInt(gpuUsage.value) || 0,
      Number.parseInt(memUsage.value) || 0
    );
    if (hardwareStrongActive.value) return 'error';
    if (maxUsage >= 80) return 'warning';
    return 'normal';
  });

  const isCurrent = (requestGeneration: number): boolean => generation === requestGeneration;

  const setNetworkStatus = (nextStatus: NetworkStatus) => {
    const previousStatus = networkStatus.value;
    if (previousStatus === nextStatus) return;
    networkStatus.value = nextStatus;
    if (nextStatus === 'error') {
      options.onToast?.('网络连接已断开', 'sys');
    } else if (nextStatus === 'good' && previousStatus === 'error') {
      options.onToast?.('网络已恢复连接', 'sys');
    }
  };

  const updateHardwareSeverity = () => {
    const cpu = Number.parseInt(cpuUsage.value) || 0;
    const gpu = Number.parseInt(gpuUsage.value) || 0;
    const memory = Number.parseInt(memUsage.value) || 0;
    const maxUsage = Math.max(cpu, gpu, memory);

    if (maxUsage >= HARDWARE_STRONG_THRESHOLD) {
      hardwareHighSampleCount += 1;
      if (hardwareHighSampleCount >= 2) hardwareStrongActive.value = true;
      return;
    }

    hardwareHighSampleCount = 0;
    if (
      hardwareStrongActive.value &&
      cpu < HARDWARE_RECOVER_THRESHOLD &&
      gpu < HARDWARE_RECOVER_THRESHOLD &&
      memory < HARDWARE_RECOVER_THRESHOLD
    ) {
      hardwareStrongActive.value = false;
    }
  };

  const fetchSpeedStats = async (requestGeneration: number) => {
    try {
      const [currentRx, currentTx] = await commands.getNetworkStats();
      if (!isCurrent(requestGeneration)) return;
      if (lastRx !== 0) {
        const rxDiff = currentRx - lastRx;
        const txDiff = currentTx - lastTx;
        downloadSpeed.value = formatSpeed(rxDiff);
        uploadSpeed.value = formatSpeed(txDiff);
        isHighDownload.value = rxDiff >= HIGH_TRAFFIC_BYTES;
        isHighUpload.value = txDiff >= HIGH_TRAFFIC_BYTES;
        if (isHighDownload.value || isHighUpload.value) lowTrafficStartTime = now();
      }
      lastRx = currentRx;
      lastTx = currentTx;
    } catch (error) {
      if (isCurrent(requestGeneration)) console.error('流量获取失败:', error);
    }
  };

  const fetchHardwareStats = async (requestGeneration: number) => {
    try {
      const [cpu, usedMem, totalMem] = await commands.getHardwareStats();
      if (!isCurrent(requestGeneration)) return;
      cpuUsage.value = `${Math.round(cpu)}%`;
      if (totalMem > 0) memUsage.value = `${Math.round((usedMem / totalMem) * 100)}%`;
      const randomOffset = Math.floor(random() * 5);
      const estimatedGpu = Math.min(
        Math.max(Math.round((Number.parseInt(cpuUsage.value) || 10) * 0.4) + randomOffset, 1),
        99
      );
      gpuUsage.value = `${estimatedGpu}%`;
      updateHardwareSeverity();
    } catch (error) {
      if (isCurrent(requestGeneration)) console.error('获取硬件信息失败:', error);
    }
  };

  const checkNetworkLatency = async (requestGeneration: number) => {
    try {
      const latency = await commands.getNetworkLatency();
      if (!isCurrent(requestGeneration)) return;
      setNetworkStatus(latency < 150 ? 'good' : 'warning');
    } catch {
      if (!isCurrent(requestGeneration)) return;
      if (isHighDownload.value || isHighUpload.value) {
        setNetworkStatus('warning');
        return;
      }
      setNetworkStatus(now() - lowTrafficStartTime < NETWORK_ERROR_DELAY_MS ? 'warning' : 'error');
    }
  };

  const pollSystemStats = async (requestGeneration: number) => {
    await fetchSpeedStats(requestGeneration);
    if (
      !isCurrent(requestGeneration) ||
      (!options.hardwareEnabled.value && !options.rotationEnabled.value)
    ) {
      return;
    }
    await fetchHardwareStats(requestGeneration);
  };

  const start = () => {
    if (systemTimer !== null || latencyTimer !== null) return;
    generation += 1;
    const requestGeneration = generation;
    void fetchSpeedStats(requestGeneration);
    void checkNetworkLatency(requestGeneration);
    systemTimer = window.setInterval(
      () => void pollSystemStats(requestGeneration),
      SYSTEM_POLL_INTERVAL_MS
    );
    latencyTimer = window.setInterval(
      () => void checkNetworkLatency(requestGeneration),
      LATENCY_POLL_INTERVAL_MS
    );
  };

  const stop = () => {
    generation += 1;
    if (systemTimer !== null) window.clearInterval(systemTimer);
    if (latencyTimer !== null) window.clearInterval(latencyTimer);
    systemTimer = null;
    latencyTimer = null;
  };

  return {
    uploadSpeed,
    downloadSpeed,
    isHighDownload,
    isHighUpload,
    networkStatus,
    cpuUsage,
    gpuUsage,
    memUsage,
    hardwareStrongActive,
    hardwareVisualStatus,
    start,
    stop,
  };
};
