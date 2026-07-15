<template>
  <div
    class="music-progress-control"
    :aria-busy="isPending"
    @pointerdown.stop
    @mousedown.stop
    @touchstart.stop
    @click.stop
    @keydown.stop
  >
    <input
      class="progress-slider"
      type="range"
      min="0"
      :max="normalizedDurationMs"
      step="100"
      :value="displayPositionMs"
      :disabled="isPending"
      aria-label="播放进度"
      :aria-valuetext="`${formattedPosition} / ${formattedDuration}`"
      :style="{ '--progress-percent': `${progressPercent}%` }"
      @input="handleInput"
      @change="handleChange"
    />
    <div class="progress-time-row">
      <span v-if="showFailure" class="seek-feedback" role="status">无法跳转</span>
      <span v-else class="progress-time-current">{{ formattedPosition }}</span>
      <span class="progress-time-total">{{ formattedDuration }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

interface Props {
  positionMs: number | null;
  durationMs?: number;
  isPending: boolean;
  failureId: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'seek-to': [positionMs: number];
}>();

const draftPositionMs = ref<number | null>(null);
const showFailure = ref(false);
let failureTimer: number | null = null;

const normalizedDurationMs = computed(() => {
  if (!Number.isFinite(props.durationMs) || (props.durationMs ?? 0) <= 0) return 0;
  return Math.round(props.durationMs ?? 0);
});

const normalizePosition = (positionMs: number): number =>
  Math.min(Math.max(0, Math.round(positionMs)), normalizedDurationMs.value);

const displayPositionMs = computed(() =>
  normalizePosition(draftPositionMs.value ?? props.positionMs ?? 0)
);

const readInputPosition = (event: Event): number =>
  normalizePosition(Number((event.target as HTMLInputElement).value));

const handleInput = (event: Event): void => {
  draftPositionMs.value = readInputPosition(event);
};

const handleChange = (event: Event): void => {
  const positionMs = readInputPosition(event);
  draftPositionMs.value = positionMs;
  emit('seek-to', positionMs);
};

watch(
  () => props.isPending,
  (isPending, wasPending) => {
    if (wasPending && !isPending) draftPositionMs.value = null;
  }
);

const clearFailureTimer = (): void => {
  if (failureTimer === null) return;
  window.clearTimeout(failureTimer);
  failureTimer = null;
};

watch(
  () => props.failureId,
  (failureId, previousFailureId) => {
    if (failureId <= 0 || failureId === previousFailureId) return;
    clearFailureTimer();
    showFailure.value = true;
    failureTimer = window.setTimeout(() => {
      failureTimer = null;
      showFailure.value = false;
    }, 2_000);
  }
);

onBeforeUnmount(clearFailureTimer);

const formatTime = (milliseconds: number): string => {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const minuteText = hours > 0 ? minutes.toString().padStart(2, '0') : minutes.toString();
  const base = `${minuteText}:${seconds.toString().padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${base}` : base;
};

const formattedPosition = computed(() => formatTime(displayPositionMs.value));
const formattedDuration = computed(() => formatTime(normalizedDurationMs.value));
const progressPercent = computed(() =>
  normalizedDurationMs.value > 0
    ? (displayPositionMs.value / normalizedDurationMs.value) * 100
    : 0
);
</script>

<style scoped>
.music-progress-control {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px;
  color: currentColor;
}

.progress-slider {
  appearance: none;
  width: 100%;
  height: 12px;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  cursor: pointer;
}

.progress-slider::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    currentColor 0 var(--progress-percent),
    rgba(127, 127, 127, 0.42) var(--progress-percent) 100%
  );
}

.progress-slider::-webkit-slider-thumb {
  appearance: none;
  width: 10px;
  height: 10px;
  margin-top: -3.5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.28);
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease;
}

.progress-slider:hover::-webkit-slider-thumb {
  transform: scale(1.12);
}

.progress-slider:focus-visible::-webkit-slider-thumb {
  box-shadow:
    0 1px 5px rgba(0, 0, 0, 0.28),
    0 0 0 3px rgba(127, 127, 127, 0.36);
}

.progress-slider:disabled {
  cursor: progress;
  opacity: 0.55;
}

.progress-time-row {
  min-height: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  opacity: 0.68;
}

.seek-feedback {
  font-weight: 600;
  opacity: 0.95;
}

@media (prefers-reduced-motion: reduce) {
  .progress-slider::-webkit-slider-thumb {
    transition: none;
  }
}
</style>
