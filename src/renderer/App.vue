<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useStateStore } from "./stores/stateStore";
import IslandApp from "./apps/island/IslandApp.vue";
import PopupApp from "./apps/popup/PopupApp.vue";
import CenterApp from "./apps/center/CenterApp.vue";
import SettingsApp from "./apps/settings/SettingsApp.vue";
import type { CodePulseWindowKind } from "../shared/types/window";

const stateStore = useStateStore();
const params = new URLSearchParams(window.location.search);
const windowKind = (params.get("window") ?? "center") as CodePulseWindowKind;

const appComponent = computed(() => {
  if (windowKind === "island") {
    return IslandApp;
  }

  if (windowKind === "popup") {
    return PopupApp;
  }

  if (windowKind === "settings") {
    return SettingsApp;
  }

  return CenterApp;
});

onMounted(() => {
  void stateStore.initialize();
});

onBeforeUnmount(() => {
  stateStore.dispose();
});
</script>

<template>
  <component :is="appComponent" />
</template>
