<script setup lang="ts">
import { ref } from "vue";
import { useLocale } from "vuetify";
import type { Operation } from "../api.js";
import {
  actionMessageKey,
  appIntlLocale,
  humanizeAction,
  sourceMessageKey,
} from "../locales.js";
import CodeViewer from "./CodeViewer.vue";
import StateChip from "./StateChip.vue";

defineProps<{ event: Operation | null }>();
const tab = ref("input");
const locale = useLocale();

function actionLabel(action: string): string {
  const key = actionMessageKey(action);
  return key ? locale.t(key) : humanizeAction(action);
}

function sourceLabel(source: string): string {
  const key = sourceMessageKey(source);
  return key ? locale.t(key) : source;
}

function terminalText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.stdout !== "string" && typeof item.stderr !== "string")
    return null;
  const stdout = typeof item.stdout === "string" ? item.stdout : "";
  const stderr =
    typeof item.stderr === "string" && item.stderr
      ? `\n\n[stderr]\n${item.stderr}`
      : "";
  return `${stdout}${stderr}`;
}
</script>

<template>
  <v-card v-if="event" class="panel-card">
    <div class="panel-header">
      <div class="min-w-0">
        <div class="panel-title text-truncate">
          {{ actionLabel(event.action) }}
        </div>
        <div class="panel-subtitle">
          {{ sourceLabel(event.source) }} ·
          {{
            new Date(event.startedAt).toLocaleString(
              appIntlLocale(locale.current.value),
            )
          }}
        </div>
      </div>
      <StateChip :value="event.status" />
    </div>
    <v-divider />

    <div class="detail-facts">
      <div>
        <span>{{ locale.t("$vuetify.chatroom.detail.plugin") }}</span
        ><strong class="mono">{{ event.pluginId }}</strong>
      </div>
      <div>
        <span>{{ locale.t("$vuetify.chatroom.detail.duration") }}</span
        ><strong>{{
          event.durationMs === null
            ? locale.t("$vuetify.chatroom.statuses.running")
            : `${event.durationMs} ms`
        }}</strong>
      </div>
      <div v-if="event.workspaceId">
        <span>{{ locale.t("$vuetify.chatroom.detail.workspace") }}</span
        ><strong class="mono">{{ event.workspaceId.slice(0, 16) }}</strong>
      </div>
      <div v-if="event.processId">
        <span>{{ locale.t("$vuetify.chatroom.detail.process") }}</span
        ><strong class="mono">{{ event.processId.slice(0, 16) }}</strong>
      </div>
    </div>

    <v-tabs v-model="tab" density="compact" class="detail-tabs">
      <v-tab value="input">{{
        locale.t("$vuetify.chatroom.detail.input")
      }}</v-tab>
      <v-tab value="output">{{
        locale.t("$vuetify.chatroom.detail.output")
      }}</v-tab>
      <v-tab v-if="event.error" value="failure">{{
        locale.t("$vuetify.chatroom.detail.error")
      }}</v-tab>
    </v-tabs>
    <v-divider />

    <v-window v-model="tab">
      <v-window-item value="input" class="pa-3"
        ><CodeViewer :value="event.input"
      /></v-window-item>
      <v-window-item value="output" class="pa-3">
        <CodeViewer
          v-if="terminalText(event.output) !== null"
          :text="terminalText(event.output) ?? ''"
          filename="operation-terminal.txt"
        />
        <CodeViewer v-else :value="event.output" />
      </v-window-item>
      <v-window-item v-if="event.error" value="failure" class="pa-3">
        <CodeViewer :value="event.error" />
      </v-window-item>
    </v-window>
  </v-card>
  <v-card v-else class="panel-card">
    <div class="empty-panel">
      {{ locale.t("$vuetify.chatroom.operations.select") }}
    </div>
  </v-card>
</template>
