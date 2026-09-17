<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useLocale } from "vuetify";
import {
  api,
  type CloudManagementSession,
  type CloudRestoreResult,
  type CloudService,
  type CloudStatus,
} from "../api.js";
import { errorMessage } from "../utils/errors.js";
import { createRequestGate } from "../utils/requests.js";
import { appIntlLocale } from "../locales.js";

const locale = useLocale();
const status = ref<CloudStatus | null>(null);
const error = ref("");
const errorVisible = ref(false);
const recoveryKey = ref("");
const restoring = ref(false);
const refreshing = ref(false);
const confirmationService = ref<CloudService | null>(null);
const serviceUpdating = ref<CloudService | null>(null);
const loadRequests = createRequestGate();

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

const confirmationTitle = computed(() =>
  confirmationService.value === "remote_web"
    ? locale.t("$vuetify.chatroom.cloud.disableWebTitle")
    : locale.t("$vuetify.chatroom.cloud.disableMcpTitle"),
);

const confirmationDescription = computed(() =>
  confirmationService.value === "remote_web"
    ? locale.t("$vuetify.chatroom.cloud.disableWebDescription")
    : locale.t("$vuetify.chatroom.cloud.disableMcpDescription"),
);

onMounted(load);

function applyStatus(next: CloudStatus) {
  status.value = next;
}

function showError(value: unknown) {
  error.value = errorMessage(value);
  errorVisible.value = true;
}

async function load() {
  const request = loadRequests.begin();
  try {
    const next = await api<CloudStatus>("/cloud/status", {
      signal: request.signal,
    });
    if (loadRequests.isCurrent(request)) applyStatus(next);
  } catch (value) {
    if (loadRequests.isCurrent(request)) showError(value);
  }
}

async function refresh() {
  refreshing.value = true;
  try {
    applyStatus(await api<CloudStatus>("/cloud/sync", { method: "POST" }));
  } catch (value) {
    showError(value);
  } finally {
    refreshing.value = false;
  }
}

async function manage() {
  try {
    const result = await api<CloudManagementSession>("/cloud/management", {
      method: "POST",
    });
    window.open(result.url, "_blank", "noopener,noreferrer");
  } catch (value) {
    showError(value);
  }
}

function requestServiceChange(service: CloudService, enabled: boolean) {
  if (enabled) {
    void setService(service, true);
    return;
  }
  confirmationService.value = service;
}

async function confirmDisableService() {
  const service = confirmationService.value;
  if (!service) return;
  await setService(service, false);
  if (serviceUpdating.value === null) confirmationService.value = null;
}

async function setService(service: CloudService, enabled: boolean) {
  if (!status.value || serviceUpdating.value) return;
  serviceUpdating.value = service;
  try {
    applyStatus(
      await api<CloudStatus>(`/cloud/services/${service}`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }),
    );
  } catch (value) {
    showError(value);
  } finally {
    serviceUpdating.value = null;
  }
}

async function restore() {
  if (!recoveryKey.value.trim()) return;
  restoring.value = true;
  try {
    const result = await api<CloudRestoreResult>("/cloud/restore", {
      method: "POST",
      body: JSON.stringify({ recoveryKey: recoveryKey.value.trim() }),
      timeoutMs: 120_000,
    });
    applyStatus(result.status);
    recoveryKey.value = "";
  } catch (value) {
    showError(value);
  } finally {
    restoring.value = false;
  }
}
</script>

<template>
  <div class="cloud-view">
    <v-card class="panel-card cloud-panel">
      <v-alert
        v-if="status?.lastError"
        type="error"
        variant="tonal"
        density="compact"
        class="ma-3"
      >
        {{ status.lastError }}
      </v-alert>
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
              icon="$mdiRefresh"
              size="small"
              variant="text"
              :loading="refreshing"
              :aria-label="locale.t('$vuetify.chatroom.cloud.refresh')"
              @click="refresh"
            />
            <v-btn
              variant="text"
              size="small"
              :disabled="!status.installationId"
              @click="manage"
            >
              {{ locale.t("$vuetify.chatroom.cloud.manage") }}
            </v-btn>
          </div>
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
            :loading="serviceUpdating === 'remote_mcp'"
            :disabled="serviceUpdating !== null"
            @update:model-value="
              requestServiceChange('remote_mcp', Boolean($event))
            "
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
            :loading="serviceUpdating === 'remote_web'"
            :disabled="serviceUpdating !== null"
            @update:model-value="
              requestServiceChange('remote_web', Boolean($event))
            "
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
          <v-btn
            color="primary"
            variant="flat"
            size="small"
            :disabled="!status.installationId"
            @click="manage"
          >
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
            :disabled="!status.installationId || !recoveryKey.trim()"
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

      <template v-if="status">
        <v-divider />
        <div class="cloud-row cloud-installation-row">
          <div class="cloud-row-main">
            <div class="cloud-row-title">
              {{ locale.t("$vuetify.chatroom.cloud.installationId") }}
            </div>
            <div class="cloud-row-value mono installation-id">
              {{ status.installationId || "—" }}
            </div>
          </div>
        </div>
      </template>
    </v-card>
  </div>

  <v-dialog
    :model-value="confirmationService !== null"
    max-width="480"
    @update:model-value="!$event && (confirmationService = null)"
  >
    <v-card>
      <v-card-title>{{ confirmationTitle }}</v-card-title>
      <v-card-text>{{ confirmationDescription }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="serviceUpdating !== null"
          @click="confirmationService = null"
        >
          {{ locale.t("$vuetify.chatroom.common.cancel") }}
        </v-btn>
        <v-btn
          color="error"
          variant="flat"
          :loading="serviceUpdating === confirmationService"
          @click="confirmDisableService"
        >
          {{ locale.t("$vuetify.chatroom.cloud.disableConfirm") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-snackbar
    v-model="errorVisible"
    color="error"
    location="top"
    :timeout="6000"
  >
    {{ error }}
    <template #actions>
      <v-btn variant="text" @click="errorVisible = false">
        {{ locale.t("$vuetify.chatroom.common.close") }}
      </v-btn>
    </template>
  </v-snackbar>
</template>
