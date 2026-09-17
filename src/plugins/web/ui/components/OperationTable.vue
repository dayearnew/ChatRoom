<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Operation } from "../api.js";
import { useOperationLabels } from "../composables/useOperationLabels.js";
import { clock, duration } from "../utils.js";
import StateChip from "./StateChip.vue";

defineProps<{
  events: Operation[];
  selected?: string | null;
}>();
defineEmits<{ select: [event: Operation] }>();
const locale = useLocale();

const { actionLabel, sourceLabel } = useOperationLabels();
</script>

<template>
  <div v-if="events.length" class="responsive-record-list">
    <button
      v-for="event in events"
      :key="event.operationId"
      type="button"
      class="responsive-record-row"
      :class="{ 'selected-row': selected === event.operationId }"
      @click="$emit('select', event)"
    >
      <div class="responsive-record-main">
        <div class="responsive-record-title">
          {{ actionLabel(event.action) }}
        </div>
        <div class="responsive-record-subtitle mono">{{ event.pluginId }}</div>
      </div>
      <div class="responsive-record-meta">
        <span>{{ clock(event.startedAt) }}</span>
        <span>{{ sourceLabel(event.source) }}</span>
        <span>{{
          event.durationMs === null
            ? locale.t("$vuetify.chatroom.statuses.running")
            : duration(event.durationMs)
        }}</span>
      </div>
      <div class="responsive-record-side">
        <StateChip :value="event.status" />
      </div>
    </button>
  </div>
  <div v-else class="empty-inline">
    {{ locale.t("$vuetify.chatroom.operations.empty") }}
  </div>
</template>
