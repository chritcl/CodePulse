<template>
  <div class="resource-box">
    <div class="resource-group">
      <div class="resource-info-row">
        <span class="resource-label">CPU</span>
        <span class="resource-value" :class="{ 'high-usage': cpuUsage >= 90 }">
          {{ cpuUsage }}%
        </span>
      </div>
      <div
        class="resource-bar-track"
        role="progressbar"
        aria-label="CPU 占用"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="cpuUsage"
      >
        <div
          class="resource-bar-fill"
          :class="{ 'high-usage': cpuUsage >= 90 }"
          :style="{ width: `${cpuUsage}%` }"
        />
      </div>
    </div>

    <div class="resource-group">
      <div class="resource-info-row">
        <span class="resource-label">RAM</span>
        <span class="resource-value" :class="{ 'high-usage': memUsage >= 90 }">
          {{ memUsage }}%
        </span>
      </div>
      <div
        class="resource-bar-track"
        role="progressbar"
        aria-label="内存占用"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="memUsage"
      >
        <div
          class="resource-bar-fill"
          :class="{ 'high-usage': memUsage >= 90 }"
          :style="{ width: `${memUsage}%` }"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  cpuUsage: number;
  memUsage: number;
}

defineProps<Props>();
</script>

<style scoped>
.resource-box {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
}

.resource-group {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
}

.resource-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
}

.resource-label {
  font-size: 9px;
  color: currentColor;
  opacity: 0.55;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0;
  line-height: 1;
}

.resource-value {
  font-size: 12px;
  font-weight: 700;
  color: currentColor;
  font-variant-numeric: tabular-nums;
  transition: color 0.3s ease;
  line-height: 1;
}

.resource-bar-track {
  width: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(150, 150, 150, 0.2);
}

.resource-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.95;
  transition:
    width 0.4s cubic-bezier(0.25, 1, 0.5, 1),
    background-color 0.3s ease;
}

.resource-value.high-usage {
  color: #ff3b30;
}

.resource-bar-fill.high-usage {
  background: #ff3b30;
}

@media (prefers-reduced-motion: reduce) {
  .resource-bar-fill,
  .resource-value {
    transition: none;
  }
}
</style>
