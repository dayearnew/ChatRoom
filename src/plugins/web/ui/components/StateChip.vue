<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import { statusMessageKey } from "../locales.js";
const props = defineProps<{ value: string }>();
const locale = useLocale();
const color = computed(
  () =>
    ({
      running: "warning",
      success: "success",
      exited: "success",
      error: "error",
      failed: "error",
      cancelled: "default",
      killed: "default",
    })[props.value] ?? "default",
);
const icon = computed(() =>
  props.value === "running"
    ? "$mdiProgressClock"
    : props.value === "success" || props.value === "exited"
      ? "$mdiCheckCircleOutline"
      : props.value === "error" || props.value === "failed"
        ? "$mdiAlertCircleOutline"
        : "$mdiCircleOutline",
);
const label = computed(() => {
  const key = statusMessageKey(props.value);
  return key ? locale.t(key) : props.value;
});
</script>
<template>
  <v-chip
    class="state-chip"
    :color="color"
    :prepend-icon="icon"
    size="small"
    variant="tonal"
    >{{ label }}</v-chip
  >
</template>
