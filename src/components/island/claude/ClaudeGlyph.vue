<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
    <path d="m7.6 3.8 8.8 16.4M16.4 3.8 7.6 20.2" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 24 });
</script>

<style scoped>
svg {
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.45;
}
</style>
