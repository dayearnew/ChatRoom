<script setup lang="ts">
import { useLocale } from "vuetify";
import type { ComputerPermission, ComputerStatus } from "../api.js";

defineProps<{
  status: ComputerStatus | null;
  settingsBusy: boolean;
  permissionBusy: ComputerPermission | null;
  permissionRequestsAllowed: boolean;
}>();
const emit = defineEmits<{
  updateSetting: [key: "enabled" | "remoteAccess", value: boolean];
  requestPermission: [permission: ComputerPermission];
}>();
const locale = useLocale();

function platformLabel(value: ComputerStatus["platform"]): string {
  return locale.t(`$vuetify.chatroom.computer.platformStates.${value}`);
}

function helperLabel(value: ComputerStatus["helper"]): string {
  return locale.t(`$vuetify.chatroom.computer.helperStates.${value}`);
}

function permissionLabel(
  value: ComputerStatus["permissions"]["accessibility"],
): string {
  return locale.t(`$vuetify.chatroom.computer.permissionStates.${value}`);
}

function permissionStateClass(
  value: ComputerStatus["permissions"]["accessibility"],
): string {
  if (value === "granted") return "is-granted";
  if (value === "denied") return "is-denied";
  return "is-muted";
}

function displaySubtitle(display: ComputerStatus["displays"][number]): string {
  const primary = display.primary
    ? ` · ${locale.t("$vuetify.chatroom.computer.primaryDisplay")}`
    : "";
  return `${display.width}×${display.height} · ${display.scale}x${primary}`;
}
</script>

<template>
  <template v-if="status">
    <v-card rounded="xl" variant="flat" border class="panel-card">
      <div class="panel-header compact-header">
        <div class="panel-title">
          {{ locale.t("$vuetify.chatroom.computer.title") }}
        </div>
      </div>
      <v-divider />
      <v-card-text class="computer-status-list">
        <div class="computer-status-row">
          <span class="computer-status-label">
            {{ locale.t("$vuetify.chatroom.computer.platform") }}
          </span>
          <strong class="computer-status-value">
            {{ platformLabel(status.platform) }}
          </strong>
        </div>
        <div class="computer-status-row">
          <span class="computer-status-label">
            {{ locale.t("$vuetify.chatroom.computer.helper") }}
          </span>
          <strong class="computer-status-value">
            {{ helperLabel(status.helper) }}
          </strong>
        </div>
        <div class="computer-status-row">
          <span class="computer-status-label">
            {{ locale.t("$vuetify.chatroom.computer.accessibility") }}
          </span>
          <div class="computer-permission-value">
            <strong
              class="computer-permission-state"
              :class="permissionStateClass(status.permissions.accessibility)"
            >
              {{ permissionLabel(status.permissions.accessibility) }}
            </strong>
            <v-btn
              v-if="status.permissions.accessibility !== 'granted'"
              class="computer-permission-btn"
              color="primary"
              size="small"
              variant="tonal"
              :loading="permissionBusy === 'accessibility'"
              :disabled="!permissionRequestsAllowed || permissionBusy !== null"
              @click="emit('requestPermission', 'accessibility')"
            >
              {{ locale.t("$vuetify.chatroom.computer.requestPermission") }}
            </v-btn>
          </div>
        </div>
        <div class="computer-status-row">
          <span class="computer-status-label">
            {{ locale.t("$vuetify.chatroom.computer.screenRecording") }}
          </span>
          <div class="computer-permission-value">
            <strong
              class="computer-permission-state"
              :class="permissionStateClass(status.permissions.screenRecording)"
            >
              {{ permissionLabel(status.permissions.screenRecording) }}
            </strong>
            <v-btn
              v-if="status.permissions.screenRecording !== 'granted'"
              class="computer-permission-btn"
              color="primary"
              size="small"
              variant="tonal"
              :loading="permissionBusy === 'screenRecording'"
              :disabled="!permissionRequestsAllowed || permissionBusy !== null"
              @click="emit('requestPermission', 'screenRecording')"
            >
              {{ locale.t("$vuetify.chatroom.computer.requestPermission") }}
            </v-btn>
          </div>
        </div>
        <v-alert
          v-if="
            status.platform === 'macos' &&
            !permissionRequestsAllowed &&
            (status.permissions.accessibility !== 'granted' ||
              status.permissions.screenRecording !== 'granted')
          "
          type="info"
          variant="tonal"
          density="compact"
          class="computer-permission-alert"
        >
          {{ locale.t("$vuetify.chatroom.computer.permissionLocalOnly") }}
        </v-alert>
      </v-card-text>
      <v-divider />
      <v-list density="compact" class="computer-settings-list">
        <v-list-item :title="locale.t('$vuetify.chatroom.computer.enabled')">
          <template #append>
            <v-switch
              :model-value="status.settings.enabled"
              :disabled="settingsBusy"
              @update:model-value="emit('updateSetting', 'enabled', !!$event)"
            />
          </template>
        </v-list-item>
        <v-list-item
          :title="locale.t('$vuetify.chatroom.computer.remoteAccess')"
        >
          <template #append>
            <v-switch
              :model-value="status.settings.remoteAccess"
              :disabled="settingsBusy"
              @update:model-value="
                emit('updateSetting', 'remoteAccess', !!$event)
              "
            />
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <v-card
      v-if="status.displays.length"
      rounded="xl"
      variant="flat"
      border
      class="panel-card"
    >
      <div class="panel-header compact-header">
        <div class="panel-title">
          {{ locale.t("$vuetify.chatroom.computer.displays") }}
        </div>
      </div>
      <v-divider />
      <v-list density="compact" class="computer-display-list">
        <v-list-item
          v-for="display in status.displays"
          :key="display.id"
          :title="display.name"
          :subtitle="displaySubtitle(display)"
        />
      </v-list>
    </v-card>
  </template>
</template>

<style scoped>
.computer-status-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 18px;
}

.computer-status-row {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.computer-status-label {
  color: rgb(var(--v-theme-on-surface), 0.76);
  font-size: 13px;
  font-weight: 500;
}

.computer-status-value {
  color: rgb(var(--v-theme-on-surface), 0.94);
  font-size: 13px;
  font-weight: 600;
}

.computer-permission-value {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.computer-permission-state {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.computer-permission-state.is-granted {
  color: rgb(var(--v-theme-success));
}

.computer-permission-state.is-denied {
  color: rgb(var(--v-theme-warning));
}

.computer-permission-state.is-muted {
  color: rgb(var(--v-theme-on-surface), 0.72);
}

.computer-permission-btn {
  min-width: 64px;
  height: 30px;
  font-size: 12px;
  font-weight: 650;
}

.computer-permission-alert {
  margin-top: 8px;
}

.computer-settings-list,
.computer-display-list {
  padding-block: 4px;
}

.computer-settings-list :deep(.v-list-item),
.computer-display-list :deep(.v-list-item) {
  min-height: 48px;
  padding-inline: 18px;
}

.computer-settings-list :deep(.v-list-item-title),
.computer-display-list :deep(.v-list-item-title),
.computer-display-list :deep(.v-list-item-subtitle) {
  font-size: 12px;
}

@media (max-width: 900px) {
  .computer-status-row {
    min-height: 40px;
  }
}
</style>
