<template>
  <label class="material-switch" :class="{ 'is-disabled': disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="label"
      @change="handleChange"
    />
    <span class="material-switch-track" aria-hidden="true">
      <span class="material-switch-thumb" />
    </span>
  </label>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  label: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const handleChange = (event: Event) => {
  emit('update:modelValue', (event.target as HTMLInputElement).checked);
};
</script>

<style scoped>
.material-switch {
  position: relative;
  display: inline-grid;
  width: 46px;
  height: 28px;
  flex: 0 0 46px;
  cursor: pointer;
}

.material-switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.material-switch-track {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 1px solid var(--switch-border);
  border-radius: 999px;
  background: var(--switch-track);
  transition:
    background-color var(--motion-standard),
    border-color var(--motion-standard);
}

.material-switch-thumb {
  position: absolute;
  top: 50%;
  left: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--switch-thumb);
  box-shadow: 0 2px 6px rgba(17, 19, 25, 0.24);
  transform: translateY(-50%);
  transition:
    width var(--motion-fast),
    transform var(--motion-expressive),
    background-color var(--motion-standard);
}

.material-switch:hover .material-switch-thumb {
  width: 20px;
}

.material-switch input:checked + .material-switch-track {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
}

.material-switch input:checked + .material-switch-track .material-switch-thumb {
  width: 20px;
  background: var(--on-accent);
  transform: translate(17px, -50%);
}

.material-switch input:focus-visible + .material-switch-track {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.material-switch.is-disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

@media (prefers-reduced-motion: reduce) {
  .material-switch-track,
  .material-switch-thumb {
    transition-duration: 120ms;
  }
}
</style>
