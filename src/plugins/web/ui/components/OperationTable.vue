<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Operation } from "../api.js";
import {
  actionMessageKey,
  humanizeAction,
  sourceMessageKey,
} from "../locales.js";
import { clock, duration } from "../utils.js";
import StateChip from "./StateChip.vue";

defineProps<{ events: Operation[]; selected?: string | null }>();
defineEmits<{ select: [event: Operation] }>();
const locale = useLocale();

function actionLabel(action: string): string {
  const key = actionMessageKey(action);
  return key ? locale.t(key) : humanizeAction(action);
}

function sourceLabel(source: string): string {
  const key = sourceMessageKey(source);
  return key ? locale.t(key) : source;
}
</script>

<template>
  <div v-if="events.length" class="table-shell">
    <v-table density="comfortable" hover class="operation-table">
      <thead>
        <tr>
          <th class="operation-col-time">
            {{ locale.t("$vuetify.chatroom.table.time") }}
          </th>
          <th>{{ locale.t("$vuetify.chatroom.table.action") }}</th>
          <th>{{ locale.t("$vuetify.chatroom.table.plugin") }}</th>
          <th class="operation-col-source">
            {{ locale.t("$vuetify.chatroom.table.source") }}
          </th>
          <th class="operation-col-status">
            {{ locale.t("$vuetify.chatroom.table.status") }}
          </th>
          <th class="operation-col-duration text-right">
            {{ locale.t("$vuetify.chatroom.table.duration") }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="event in events"
          :key="event.operationId"
          class="clickable"
          :class="{ 'selected-row': selected === event.operationId }"
          @click="$emit('select', event)"
        >
          <td class="operation-col-time mono text-caption">
            {{ clock(event.startedAt) }}
          </td>
          <td class="font-weight-medium">{{ actionLabel(event.action) }}</td>
          <td class="text-body-2 mono">{{ event.pluginId }}</td>
          <td class="operation-col-source text-body-2 muted">
            {{ sourceLabel(event.source) }}
          </td>
          <td class="operation-col-status">
            <StateChip :value="event.status" />
          </td>
          <td class="operation-col-duration text-right text-body-2">
            {{
              event.durationMs === null
                ? locale.t("$vuetify.chatroom.statuses.running")
                : duration(event.durationMs)
            }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </div>
  <div v-else class="empty-inline">
    {{ locale.t("$vuetify.chatroom.operations.empty") }}
  </div>
</template>
