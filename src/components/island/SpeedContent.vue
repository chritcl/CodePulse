<template>
  <div class="speed-box">
    <div class="speed-item">
      <span :class="['label', { 'high-traffic': isHighUpload }]">↑</span>
      <span class="value">{{ uploadSpeed }}</span>
    </div>
    <div class="speed-item">
      <span :class="['label', { 'high-traffic': isHighDownload }]">↓</span>
      <span class="value">{{ downloadSpeed }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  uploadSpeed: string;
  downloadSpeed: string;
  isHighUpload: boolean;
  isHighDownload: boolean;
}

defineProps<Props>();
</script>

<style scoped>
.speed-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.speed-item {
  display: flex;
  align-items: center;
  gap: 4px;
  transform: translateY(-1px);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
}

.label {
  font-size: 10px;
  color: currentColor;
  opacity: 0.4;
  font-weight: bold;
  padding: 2px 4px;
  border-radius: 4px;
  transition: all 0.3s ease;
}

.label.high-traffic {
  color: currentColor;
  opacity: 1;
  background: rgba(255, 59, 48, 0.15);
}

.value {
  font-size: 13px;
  font-weight: 600;
  color: currentColor;
  font-variant-numeric: tabular-nums;
}
</style>
