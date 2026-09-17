<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import type { ComputerPreviewView } from "../api.js";
import { appIntlLocale } from "../locales.js";
import { dateTime } from "../utils.js";

const props = defineProps<{
  preview: ComputerPreviewView | null;
  enabled: boolean;
  busy: boolean;
  remotePreviewBlocked: boolean;
}>();
const emit = defineEmits<{ refresh: [] }>();
const locale = useLocale();

const screenshotUrl = computed(() => {
  const screenshot = props.preview?.screenshot;
  return screenshot
    ? `data:${screenshot.mimeType};base64,${screenshot.data}`
    : "";
});

const capturedAt = computed(() => {
  const value = props.preview?.capturedAt;
  if (!value) return "";
  return dateTime(value, appIntlLocale(locale.current.value));
});
</script>

<template>
  <v-card rounded="xl" variant="flat" border class="panel-card">
    <div class="panel-header compact-header">
      <div class="computer-preview-heading">
        <div class="panel-title">
          {{ locale.t("$vuetify.chatroom.computer.latestScreen") }}
        </div>
        <div v-if="capturedAt" class="computer-preview-time">
          {{ locale.t("$vuetify.chatroom.computer.capturedAt", capturedAt) }}
        </div>
      </div>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="$mdiRefresh"
        :loading="busy"
        :disabled="!enabled"
        @click="emit('refresh')"
      >
        {{ locale.t("$vuetify.chatroom.computer.refreshScreen") }}
      </v-btn>
    </div>
    <v-divider />
    <v-card-text class="computer-preview-content">
      <v-alert
        v-if="remotePreviewBlocked"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        {{ locale.t("$vuetify.chatroom.computer.remoteDisabled") }}
      </v-alert>
      <div v-if="screenshotUrl" class="computer-screen-shell">
        <img
          :src="screenshotUrl"
          :alt="locale.t('$vuetify.chatroom.computer.latestScreen')"
        />
      </div>
      <div v-else class="computer-screen-empty">
        <v-icon icon="$mdiMonitorScreenshot" size="42" />
        <span>{{ locale.t("$vuetify.chatroom.computer.noSnapshot") }}</span>
      </div>
      <div v-if="preview" class="computer-preview-meta">
        <div>
          <span>{{ locale.t("$vuetify.chatroom.computer.activeApp") }}</span>
          <strong>{{ preview.activeApp || "—" }}</strong>
        </div>
        <div>
          <span>{{ locale.t("$vuetify.chatroom.computer.activeWindow") }}</span>
          <strong class="text-truncate">{{
            preview.activeWindow || "—"
          }}</strong>
        </div>
        <div>
          <span>{{ locale.t("$vuetify.chatroom.computer.elements") }}</span>
          <strong>{{ preview.elementCount }}</strong>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.computer-preview-heading {
  min-width: 0;
}

.computer-preview-time {
  margin-top: 2px;
  color: rgb(var(--v-theme-on-surface), 0.52);
  font-size: 11px;
}

.computer-preview-content {
  padding: 14px;
}

.computer-screen-shell {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  line-height: 0;
}

.computer-screen-shell img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 62vh;
  object-fit: contain;
}

.computer-screen-empty {
  display: flex;
  min-height: 250px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  border: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface), 0.68);
  text-align: center;
}

.computer-preview-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
  gap: 10px;
  margin-top: 10px;
}

.computer-preview-meta > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgb(var(--v-theme-on-surface), 0.04);
}

.computer-preview-meta span {
  color: rgb(var(--v-theme-on-surface), 0.7);
  font-size: 11px;
}

.computer-preview-meta strong {
  color: rgb(var(--v-theme-on-surface), 0.92);
  font-size: 12px;
  font-weight: 650;
}

@media (max-width: 900px) {
  .computer-preview-meta {
    grid-template-columns: 1fr;
  }

  .computer-screen-empty {
    min-height: 190px;
  }
}
</style>
