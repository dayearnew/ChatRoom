<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useDisplay, useLocale } from "vuetify";
import { api, type Operation } from "../api.js";
import { errorMessage } from "../utils/errors.js";
import { createRequestGate } from "../utils/requests.js";
import OperationTable from "./OperationTable.vue";
import OperationDetail from "./OperationDetail.vue";

const props = defineProps<{ revision: number }>();
const events = ref<Operation[]>([]);
const selected = ref<string | null>(null);
const detail = ref<Operation | null>(null);
const filter = ref("all");
const clearDialog = ref(false);
const clearing = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const error = ref("");
const loadSentinel = ref<HTMLElement | null>(null);
const locale = useLocale();
const { mdAndDown: compact } = useDisplay();
const layout = ref<HTMLElement | null>(null);
const PAGE_SIZE = 50;
const listRequests = createRequestGate();
const detailRequests = createRequestGate();
let loadObserver: IntersectionObserver | null = null;

watch(filter, () => void loadInitial(), { immediate: true });
watch(
  () => props.revision,
  () => void refreshLoaded(),
);
watch(selected, () => void loadDetail());
watch(
  loadSentinel,
  (element) => {
    loadObserver?.disconnect();
    loadObserver = null;
    if (!element) return;
    loadObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "240px 0px" },
    );
    loadObserver.observe(element);
  },
  { flush: "post" },
);

onBeforeUnmount(() => loadObserver?.disconnect());

function operationsUrl(limit: number, offset = 0): string {
  const status =
    filter.value === "all" ? "" : `&status=${encodeURIComponent(filter.value)}`;
  return `/operations?limit=${limit}&offset=${offset}${status}`;
}

async function loadInitial() {
  const request = listRequests.begin();
  loadingMore.value = true;
  error.value = "";
  try {
    const page = await api<Operation[]>(operationsUrl(PAGE_SIZE), {
      signal: request.signal,
    });
    if (!listRequests.isCurrent(request)) return;
    events.value = page;
    hasMore.value = page.length === PAGE_SIZE;
    if (selected.value) await loadDetail();
  } catch (cause) {
    if (listRequests.isCurrent(request)) error.value = errorMessage(cause);
  } finally {
    if (listRequests.isCurrent(request)) loadingMore.value = false;
  }
  await continueLoadingIfVisible();
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return;
  const request = listRequests.begin();
  const offset = events.value.length;
  loadingMore.value = true;
  try {
    const page = await api<Operation[]>(operationsUrl(PAGE_SIZE, offset), {
      signal: request.signal,
    });
    if (!listRequests.isCurrent(request)) return;
    events.value.push(...page);
    hasMore.value = page.length === PAGE_SIZE;
  } catch (cause) {
    if (listRequests.isCurrent(request)) error.value = errorMessage(cause);
  } finally {
    if (listRequests.isCurrent(request)) loadingMore.value = false;
  }
  await continueLoadingIfVisible();
}

async function refreshLoaded() {
  const request = listRequests.begin();
  loadingMore.value = true;
  error.value = "";
  const target = Math.max(events.value.length, PAGE_SIZE);
  const refreshed: Operation[] = [];
  let offset = 0;
  try {
    while (refreshed.length < target) {
      const limit = Math.min(500, target - refreshed.length);
      const page = await api<Operation[]>(operationsUrl(limit, offset), {
        signal: request.signal,
      });
      if (!listRequests.isCurrent(request)) return;
      refreshed.push(...page);
      if (page.length < limit) break;
      offset += page.length;
    }
    events.value = refreshed;
    hasMore.value = refreshed.length >= target;
    if (selected.value) await loadDetail();
  } catch (cause) {
    if (listRequests.isCurrent(request)) error.value = errorMessage(cause);
  } finally {
    if (listRequests.isCurrent(request)) loadingMore.value = false;
  }
  if (listRequests.isCurrent(request)) await continueLoadingIfVisible();
}

async function continueLoadingIfVisible() {
  await nextTick();
  const element = loadSentinel.value;
  if (!element || loadingMore.value || !hasMore.value) return;
  if (element.getBoundingClientRect().top <= window.innerHeight + 240) {
    void loadMore();
  }
}

async function loadDetail() {
  const request = detailRequests.begin();
  const operationId = selected.value;
  if (!operationId) {
    detail.value = null;
    return;
  }
  try {
    const next = await api<Operation>(`/operations/${operationId}`, {
      signal: request.signal,
    });
    if (detailRequests.isCurrent(request) && selected.value === operationId)
      detail.value = next;
  } catch (cause) {
    if (detailRequests.isCurrent(request)) error.value = errorMessage(cause);
  }
}

function select(event: Operation) {
  selected.value = event.operationId;
  if (compact.value) {
    void nextTick(() =>
      layout.value?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
}

function backToOperations() {
  selected.value = null;
  detail.value = null;
}

async function clearHistory() {
  clearing.value = true;
  error.value = "";
  listRequests.invalidate();
  detailRequests.invalidate();
  loadingMore.value = false;
  try {
    await api("/operations", { method: "DELETE" });
    selected.value = null;
    detail.value = null;
    clearDialog.value = false;
    await loadInitial();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div ref="layout" class="master-detail-layout operations-layout">
    <div v-if="!compact || !selected" class="master-pane">
      <v-card class="panel-card">
        <div class="panel-header operations-header">
          <div>
            <div class="panel-title">
              {{ locale.t("$vuetify.chatroom.operations.title") }}
            </div>
            <div class="panel-subtitle">
              {{ locale.t("$vuetify.chatroom.operations.subtitle") }}
            </div>
          </div>
          <div class="operations-controls">
            <v-btn-toggle
              v-model="filter"
              mandatory
              variant="text"
              class="operation-filters"
            >
              <v-btn value="all" size="small">{{
                locale.t("$vuetify.chatroom.operations.all")
              }}</v-btn>
              <v-btn value="running" size="small">{{
                locale.t("$vuetify.chatroom.operations.running")
              }}</v-btn>
              <v-btn value="error" size="small">{{
                locale.t("$vuetify.chatroom.operations.errors")
              }}</v-btn>
              <v-btn value="success" size="small">{{
                locale.t("$vuetify.chatroom.operations.success")
              }}</v-btn>
            </v-btn-toggle>
            <v-btn
              prepend-icon="$mdiDeleteSweepOutline"
              variant="text"
              size="small"
              class="operations-clear"
              :disabled="!events.length"
              @click="clearDialog = true"
            >
              {{ locale.t("$vuetify.chatroom.operations.clear") }}
            </v-btn>
          </div>
        </div>
        <v-divider />
        <v-alert v-if="error" type="error" variant="tonal" density="compact">
          {{ error }}
        </v-alert>
        <OperationTable
          :events="events"
          :selected="selected"
          @select="select"
        />
        <div
          v-if="hasMore || loadingMore"
          ref="loadSentinel"
          class="operation-load-sentinel"
          aria-hidden="true"
        >
          <v-progress-circular
            v-if="loadingMore"
            indeterminate
            size="20"
            width="2"
          />
        </div>
      </v-card>
    </div>
    <div v-if="!compact || selected" class="detail-pane">
      <v-alert
        v-if="compact && selected && error"
        type="error"
        variant="tonal"
        density="compact"
      >
        {{ error }}
      </v-alert>
      <OperationDetail
        :event="detail"
        :show-back="compact"
        @back="backToOperations"
      />
    </div>
  </div>

  <v-dialog v-model="clearDialog" max-width="430">
    <v-card>
      <v-card-title>{{
        locale.t("$vuetify.chatroom.operations.clearTitle")
      }}</v-card-title>
      <v-card-text>{{
        locale.t("$vuetify.chatroom.operations.clearDescription")
      }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="clearDialog = false">
          {{ locale.t("$vuetify.chatroom.common.cancel") }}
        </v-btn>
        <v-btn
          color="error"
          variant="flat"
          :loading="clearing"
          @click="clearHistory"
        >
          {{ locale.t("$vuetify.chatroom.operations.clearConfirm") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
