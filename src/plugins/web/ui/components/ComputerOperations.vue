<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Operation } from "../api.js";
import { appIntlLocale, sourceMessageKey } from "../locales.js";

defineProps<{ operations: Operation[]; busy: boolean }>();
const emit = defineEmits<{ refresh: [] }>();
const locale = useLocale();

function sourceLabel(source: string): string {
  const key = sourceMessageKey(source);
  return key ? locale.t(key) : source;
}

function operationDescription(operation: Operation): string {
  if (operation.action === "snapshot")
    return locale.t("$vuetify.chatroom.computer.log.snapshot");
  if (operation.action === "settings.set")
    return locale.t("$vuetify.chatroom.computer.log.settings");
  if (operation.action !== "action") return operation.action;

  const input = asRecord(operation.input);
  const actions = Array.isArray(input.actions) ? input.actions : [];
  if (!actions.length) return locale.t("$vuetify.chatroom.computer.log.action");
  return actions.map(describeAction).join(" · ");
}

function describeAction(value: unknown): string {
  const action = asRecord(value);
  const type = String(action.type ?? "action");
  const element =
    typeof action.elementId === "number" ? ` #${action.elementId}` : "";
  switch (type) {
    case "activate_app":
      return locale.t(
        "$vuetify.chatroom.computer.log.activateApp",
        String(action.app ?? ""),
      );
    case "activate_window":
      return locale.t(
        "$vuetify.chatroom.computer.log.activateWindow",
        element.trim(),
      );
    case "click":
      return locale.t(
        "$vuetify.chatroom.computer.log.click",
        element.trim() || coordinate(action),
      );
    case "double_click":
      return locale.t(
        "$vuetify.chatroom.computer.log.doubleClick",
        element.trim() || coordinate(action),
      );
    case "right_click":
      return locale.t(
        "$vuetify.chatroom.computer.log.rightClick",
        element.trim() || coordinate(action),
      );
    case "move":
      return locale.t(
        "$vuetify.chatroom.computer.log.move",
        coordinate(action),
      );
    case "drag":
      return locale.t("$vuetify.chatroom.computer.log.drag");
    case "scroll":
      return locale.t(
        "$vuetify.chatroom.computer.log.scroll",
        String(action.deltaY ?? 0),
      );
    case "keypress":
      return locale.t(
        "$vuetify.chatroom.computer.log.keypress",
        Array.isArray(action.keys) ? action.keys.join("+") : "",
      );
    case "type_text":
    case "set_value":
      return locale.t(
        "$vuetify.chatroom.computer.log.typeText",
        String(action.characters ?? 0),
      );
    case "invoke":
      return locale.t("$vuetify.chatroom.computer.log.invoke", element.trim());
    case "select_text":
      return locale.t(
        "$vuetify.chatroom.computer.log.selectText",
        element.trim(),
      );
    case "move_window":
      return locale.t(
        "$vuetify.chatroom.computer.log.moveWindow",
        element.trim(),
      );
    case "resize_window":
      return locale.t(
        "$vuetify.chatroom.computer.log.resizeWindow",
        element.trim(),
      );
    case "wait":
      return locale.t(
        "$vuetify.chatroom.computer.log.wait",
        String(action.ms ?? 0),
      );
    default:
      return type;
  }
}

function coordinate(value: Record<string, unknown>): string {
  return `(${Math.round(Number(value.x ?? 0))}, ${Math.round(Number(value.y ?? 0))})`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(appIntlLocale(locale.current.value), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
</script>

<template>
  <v-card rounded="xl" variant="flat" border class="panel-card">
    <div class="panel-header compact-header">
      <div class="panel-title">
        {{ locale.t("$vuetify.chatroom.computer.recentOperations") }}
      </div>
      <v-btn
        size="small"
        variant="text"
        icon="mdi-refresh"
        :loading="busy"
        @click="emit('refresh')"
      />
    </div>
    <v-divider />
    <div class="computer-operation-scroll">
      <v-list
        v-if="operations.length"
        lines="two"
        density="compact"
        class="computer-operation-list"
      >
        <v-list-item
          v-for="operation in operations"
          :key="operation.operationId"
        >
          <v-list-item-title>{{
            operationDescription(operation)
          }}</v-list-item-title>
          <v-list-item-subtitle>
            {{ formatTime(operation.startedAt) }} ·
            {{ sourceLabel(operation.source) }}
          </v-list-item-subtitle>
          <template #append>
            <v-chip
              size="small"
              :color="operation.status === 'error' ? 'error' : undefined"
              variant="tonal"
            >
              {{ operation.status }}
            </v-chip>
          </template>
        </v-list-item>
      </v-list>
      <v-card-text v-else class="muted">
        {{ locale.t("$vuetify.chatroom.computer.noOperations") }}
      </v-card-text>
    </div>
  </v-card>
</template>

<style scoped>
.computer-operation-scroll {
  height: 280px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.computer-operation-list {
  padding-block: 4px;
}

.computer-operation-list :deep(.v-list-item) {
  min-height: 52px;
  padding-inline: 18px;
}

.computer-operation-list :deep(.v-list-item-title),
.computer-operation-list :deep(.v-list-item-subtitle) {
  font-size: 12px;
}
</style>
