<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useLocale } from "vuetify";
import { api } from "../api.js";

interface CloudStatus {
  installationId: string;
  customerId: string | null;
  publicPrefix: string | null;
  desiredServices: { remote_mcp: boolean; remote_web: boolean };
  entitlements: Array<{
    service: "remote_mcp" | "remote_web";
    status: "active";
  }>;
  managementSessionActive: boolean;
  connection:
    "inactive" | "connecting" | "connected" | "disconnected" | "error";
  mcpUrl: string | null;
  webUrl: string | null;
  lastError: string | null;
}

const locale = useLocale();
const status = ref<CloudStatus | null>(null);
const error = ref("");
const recoveryKey = ref("");
const restoring = ref(false);

const subscribed = computed(() => {
  const services = new Set(
    status.value?.entitlements.map((item) => item.service) ?? [],
  );
  return services.has("remote_mcp") && services.has("remote_web");
});

onMounted(load);

async function load() {
  error.value = "";
  try {
    status.value = await api<CloudStatus>("/cloud/status");
  } catch (value) {
    error.value = (value as Error).message;
  }
}

async function manage() {
  error.value = "";
  try {
    const result = await api<{ url: string }>("/cloud/management", {
      method: "POST",
    });
    window.open(result.url, "_blank", "noopener,noreferrer");
  } catch (value) {
    error.value = (value as Error).message;
  }
}

async function setService(
  service: "remote_mcp" | "remote_web",
  enabled: boolean,
) {
  if (!status.value) return;
  const previous = status.value.desiredServices[service];
  status.value.desiredServices[service] = enabled;
  try {
    status.value = await api<CloudStatus>(`/cloud/services/${service}`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  } catch (value) {
    status.value.desiredServices[service] = previous;
    error.value = (value as Error).message;
  }
}

async function restore() {
  if (!recoveryKey.value.trim()) return;
  restoring.value = true;
  error.value = "";
  try {
    const result = await api<{ status: CloudStatus }>("/cloud/restore", {
      method: "POST",
      body: JSON.stringify({ recoveryKey: recoveryKey.value.trim() }),
    });
    status.value = result.status;
    recoveryKey.value = "";
  } catch (value) {
    error.value = (value as Error).message;
  } finally {
    restoring.value = false;
  }
}
</script>

<template>
  <div class="cloud-view">
    <v-card class="panel-card cloud-panel">
      <div v-if="error" class="cloud-error-text">{{ error }}</div>

      <template v-if="status && subscribed">
        <div class="cloud-row">
          <div class="cloud-row-main">
            <div class="cloud-row-title">
              {{ locale.t("$vuetify.chatroom.cloud.remoteMcp") }}
            </div>
            <div v-if="status.mcpUrl" class="cloud-row-value mono">
              {{ status.mcpUrl }}
            </div>
          </div>
          <v-switch
            :model-value="status.desiredServices.remote_mcp"
            hide-details
            density="compact"
            @update:model-value="setService('remote_mcp', Boolean($event))"
          />
        </div>
        <v-divider />
        <div class="cloud-row">
          <div class="cloud-row-main">
            <div class="cloud-row-title">
              {{ locale.t("$vuetify.chatroom.cloud.remoteWeb") }}
            </div>
            <div v-if="status.webUrl" class="cloud-row-value mono">
              {{ status.webUrl }}
            </div>
          </div>
          <v-switch
            :model-value="status.desiredServices.remote_web"
            hide-details
            density="compact"
            @update:model-value="setService('remote_web', Boolean($event))"
          />
        </div>
      </template>

      <template v-else-if="status">
        <div class="cloud-row">
          <div class="cloud-row-main">
            <div class="cloud-row-title">
              {{ locale.t("$vuetify.chatroom.cloud.purchase") }}
            </div>
            <div class="cloud-row-value">
              {{ locale.t("$vuetify.chatroom.cloud.inactiveDescription") }}
            </div>
          </div>
          <v-btn color="primary" variant="flat" size="small" @click="manage">
            {{ locale.t("$vuetify.chatroom.cloud.purchase") }}
          </v-btn>
        </div>
        <v-divider />
        <div class="cloud-restore-row">
          <v-text-field
            v-model="recoveryKey"
            :placeholder="locale.t('$vuetify.chatroom.cloud.recoveryKey')"
            type="password"
            density="compact"
            variant="outlined"
            hide-details
            autocomplete="off"
            @keyup.enter="restore"
          />
          <v-btn
            :loading="restoring"
            :disabled="!recoveryKey.trim()"
            variant="tonal"
            size="small"
            @click="restore"
          >
            {{ locale.t("$vuetify.chatroom.cloud.restoreAction") }}
          </v-btn>
        </div>
      </template>

      <div v-else class="cloud-loading">
        <v-progress-circular indeterminate size="20" width="2" />
      </div>
    </v-card>
  </div>
</template>
