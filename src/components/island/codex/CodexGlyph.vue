<template>
  <svg
    class="codex-glyph"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <g stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
      <path
        v-for="rotation in rotations"
        :key="rotation"
        d="M12 3.15c2.28 0 4.13 1.67 4.13 3.74 0 1.42-.87 2.72-2.22 3.38L12 11.2l-1.91-.93c-1.35-.66-2.22-1.96-2.22-3.38 0-2.07 1.85-3.74 4.13-3.74Z"
        :transform="`rotate(${rotation} 12 12)`"
      />
    </g>
    <circle cx="12" cy="12" r="1.45" fill="currentColor" opacity="0.92" />
  </svg>
</template>

<script setup lang="ts">
interface Props {
  size?: number;
}

withDefaults(defineProps<Props>(), {
  size: 24,
});

const rotations = [0, 60, 120, 180, 240, 300];
</script>

<style scoped>
.codex-glyph {
  display: block;
  flex: 0 0 auto;
  overflow: visible;
}
</style>
