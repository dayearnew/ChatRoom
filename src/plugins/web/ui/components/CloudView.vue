<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useLocale } from "vuetify";
import { api } from "../api.js";
import { appIntlLocale } from "../locales.js";

interface CloudStatus {
  installationId: string;
  customerId: string | null;
  publicPrefix: string | null;
  desiredServices: { remote_mcp: boolean; remote_web: boolean };
  entitlements: Array<{
    service: "remote_mcp" | "remote_web";
    status: "active";
    sourceProvider: string;
    sourceId: string;
    validUntil: string | null;
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
const refreshing = ref(false);
const prefix = ref("");
const prefixSaving = ref(false);

const subscribed = computed(() => {
  const services = new Set(
    status.value?.entitlements.map((item) => item.service) ?? [],
  );
  return services.has("remote_mcp") && services.has("remote_web");
});

const subscriptionExpiry = computed(() => {
  const values = (status.value?.entitlements ?? [])
    .map((item) => item.validUntil)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
});

const normalizedPrefix = computed(() => prefix.value.trim().toLowerCase());
const canSavePrefix = computed(
  () =>
    Boolean(normalizedPrefix.value) &&
    normalizedPrefix.value !== status.value?.publicPrefix &&
    !prefixSaving.value,
);

const subscriptionDescription = computed(() => {
  if (!subscribed.value)
    return locale.t("$vuetify.chatroom.cloud.inactiveDescription");
  if (subscriptionExpiry.value === null)
    return locale.t("$vuetify.chatroom.cloud.active");
  return `${locale.t("$vuetify.chatroom.cloud.expires")} ${new Intl.DateTimeFormat(
    appIntlLocale(locale.current.value),
    { dateStyle: "medium", timeStyle: "short" },
  ).format(new Date(subscriptionExpiry.value))}`;
});

onMounted(load);

function applyStatus(next: CloudStatus, preservePrefixInput = false) {
  const previousPrefix = status.value?.publicPrefix ?? null;
  const inputMatchesPrevious =
    normalizedPrefix.value === (previousPrefix ?? "");
  status.value = next;
  if (!preservePrefixInput || inputMatchesPrevious)
    prefix.value = next.publicPrefix ?? "";
}

async function load() {
  error.value = "";
  try {
    applyStatus(await api<CloudStatus>("/cloud/status"));
  } catch (value) {
    error.value = (value as Error).message;
  }
}

async function refresh() {
  refreshing.value = true;
  error.value = "";
  try {
    applyStatus(
      await api<CloudStatus>("/cloud/sync", { method: "POST" }),
      true,
    );
  } catch (value) {
    error.value = (value as Error).message;
  } finally {
    refreshing.value = false;
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

async function savePrefix() {
  if (!canSavePrefix.value) return;
  prefixSaving.value = true;
  error.value = "";
  try {
    applyStatus(
      await api<CloudStatus>("/cloud/prefix", {
        method: "POST",
        body: JSON.stringify({ prefix: normalizedPrefix.value }),
      }),
    );
  } catch (value) {
    error.value = (value as Error).message;
  } finally {
    prefixSaving.value = false;
  }
}

async function setService(
  service: "remote_mcp" | "remote_web",
  enabled: boolean,
) {
  if (!status.value) return;
  const previous = status.value.desiredServices[service];
  status.value.desiredServices[service] = enabled;
  error.value = "";
  try {
    applyStatus(
      await api<CloudStatus>(`/cloud/services/${service}`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }),
      true,
    );
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
    applyStatus(result.status);
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
              {{ locale.t("$vuetify.chatroom.cloud.subscription") }}
            </div>
            <div class="cloud-row-value">{{ subscriptionDescription }}</div>
          </div>
          <div class="cloud-row-actions">
            <v-chip color="success" size="small" variant="tonal">
              {{ locale.t("$vuetify.chatroom.cloud.active") }}
            </v-chip>
            <v-btn
              icon="mdi-refresh"
              size="small"
              variant="text"
              :loading="refreshing"
              :aria-label="locale.t('$vuetify.chatroom.cloud.refresh')"
              @click="refresh"
            />
            <v-btn variant="text" size="small" @click="manage">
              {{ locale.t("$vuetify.chatroom.cloud.manage") }}
            </v-btn>
          </div>
        </div>
        <v-divider />

        <div class="cloud-prefix-row">
          <div class="cloud-prefix-copy">
            <div class="cloud-row-title">
              {{ locale.t("$vuetify.chatroom.cloud.publicPrefix") }}
            </div>
            <div class="cloud-row-value">
              {{ locale.t("$vuetify.chatroom.cloud.prefixHint") }}
            </div>
          </div>
          <v-text-field
            v-model="prefix"
            placeholder="my-chatroom"
            density="compact"
            variant="outlined"
            hide-details
            autocomplete="off"
            @keyup.enter="savePrefix"
          />
          <v-btn
            variant="tonal"
            size="small"
            :loading="prefixSaving"
            :disabled="!canSavePrefix"
            @click="savePrefix"
          >
            {{ locale.t("$vuetify.chatroom.cloud.savePrefix") }}
          </v-btn>
        </div>
        <v-divider />

        <div class="cloud-row">
          <div class="cloud-row-main">
            <div class="cloud-row-title">
              {{ locale.t("$vuetify.chatroom.cloud.remoteMcp") }}
            </div>
            <div v-if="status.mcpUrl" class="cloud-row-value mono">
              {{ status.mcpUrl }}
            </div>
            <div v-else class="cloud-row-value">
              {{ locale.t("$vuetify.chatroom.cloud.remoteMcpDescription") }}
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
            <div v-else class="cloud-row-value">
              {{ locale.t("$vuetify.chatroom.cloud.remoteWebDescription") }}
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
              {{ locale.t("$vuetify.chatroom.cloud.subscription") }}
            </div>
            <div class="cloud-row-value">{{ subscriptionDescription }}</div>
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
