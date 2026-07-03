<template>
  <div class="systemstate-box">
    <div class="hw-item">
      <span class="hw-label">CPU</span>
      <span class="hw-value" :class="{ 'high-usage': parseInt(cpuUsage) >= 90 }">
        {{ cpuUsage }}
      </span>
    </div>
    <div class="hw-divider" />
    <div class="hw-item">
      <span class="hw-label">GPU</span>
      <span class="hw-value" :class="{ 'high-usage': parseInt(gpuUsage) >= 90 }">
        {{ gpuUsage }}
      </span>
    </div>
    <div class="hw-divider" />
    <div class="hw-item">
      <span class="hw-label">RAM</span>
      <span class="hw-value" :class="{ 'high-usage': parseInt(memUsage) >= 90 }">
        {{ memUsage }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  cpuUsage: string;
  gpuUsage: string;
  memUsage: string;
}

defineProps<Props>();
</script>

<style scoped>
.systemstate-box {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
}

.hw-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.hw-label {
  font-size: 9px;
  color: currentColor;
  opacity: 0.5;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.hw-value {
  font-size: 14px;
  font-weight: 700;
  color: currentColor;
  font-variant-numeric: tabular-nums;
  transition: color 0.3s ease;
}

.hw-value.high-usage {
  color: #ff3b30;
}

.hw-divider {
  width: 1px;
  height: 20px;
  background: currentColor;
  opacity: 0.15;
}
</style>
