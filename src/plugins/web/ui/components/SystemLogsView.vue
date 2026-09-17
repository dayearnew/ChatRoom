<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useDisplay, useLocale } from "vuetify";
import {
  api,
  type SystemLogLevel,
  type SystemLogPage,
  type SystemLogRecord,
} from "../api.js";
import { appIntlLocale } from "../locales.js";
import { clock, dateTime } from "../utils.js";
import { errorMessage } from "../utils/errors.js";
import { createRequestGate } from "../utils/requests.js";
import CodeViewer from "./CodeViewer.vue";

const PAGE_SIZE = 100;
const KNOWN_MODULES = [
  "app",
  "http",
  "auth",
  "cloud",
  "plugin",
  "mcp",
  "computer",
  "database",
] as const;

const locale = useLocale();
const { mdAndDown: compact } = useDisplay();
const records = ref<SystemLogRecord[]>([]);
const selected = ref<SystemLogRecord | null>(null);
const level = ref<SystemLogLevel | "all">("all");
const module = ref("all");
const nextBefore = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref("");
const requests = createRequestGate();
let stream: EventSource | null = null;
let ready = false;

const levelItems = computed(() => [
  { title: locale.t("$vuetify.chatroom.systemLogs.allLevels"), value: "all" },
  { title: "INFO", value: "info" },
  { title: "WARN", value: "warn" },
  { title: "ERROR", value: "error" },
  { title: "DEBUG", value: "debug" },
]);
const moduleItems = computed(() => {
  const values = new Set<string>(KNOWN_MODULES);
  for (const record of records.value) values.add(record.module);
  if (module.value !== "all") values.add(module.value);
  return [
    {
      title: locale.t("$vuetify.chatroom.systemLogs.allModules"),
      value: "all",
    },
    ...[...values]
      .sort((left, right) => left.localeCompare(right))
      .map((value) => ({ title: value, value })),
  ];
});
const detailData = computed(() =>
  selected.value?.data ? JSON.stringify(selected.value.data, null, 2) : "",
);

watch([level, module], () => {
  if (ready) void loadInitial();
});

onMounted(() => {
  ready = true;
  void loadInitial().finally(connectStream);
});

onBeforeUnmount(() => {
  ready = false;
  stream?.close();
  stream = null;
});

async function loadInitial() {
  const request = requests.begin();
  loading.value = true;
  error.value = "";
  try {
    const page = await api<SystemLogPage>(logsUrl());
    if (!requests.isCurrent(request)) return;
    records.value = page.items;
    nextBefore.value = page.nextBefore;
    if (selected.value) {
      selected.value =
        page.items.find((item) => item.id === selected.value?.id) ?? null;
    }
  } catch (cause) {
    if (requests.isCurrent(request)) error.value = errorMessage(cause);
  } finally {
    if (requests.isCurrent(request)) loading.value = false;
  }
}

async function loadMore() {
  if (!nextBefore.value || loadingMore.value) return;
  const request = requests.begin();
  loadingMore.value = true;
  error.value = "";
  try {
    const page = await api<SystemLogPage>(logsUrl(nextBefore.value));
    if (!requests.isCurrent(request)) return;
    const known = new Set(records.value.map((item) => item.id));
    records.value.push(...page.items.filter((item) => !known.has(item.id)));
    nextBefore.value = page.nextBefore;
  } catch (cause) {
    if (requests.isCurrent(request)) error.value = errorMessage(cause);
  } finally {
    if (requests.isCurrent(request)) loadingMore.value = false;
  }
}

function logsUrl(before?: string): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (level.value !== "all") params.set("level", level.value);
  if (module.value !== "all") params.set("module", module.value);
  if (before) params.set("before", before);
  return `/logs?${params}`;
}

function connectStream() {
  stream?.close();
  stream = new EventSource("/api/logs/stream");
  stream.addEventListener("log", (message) => {
    const record = parseLogEvent(message);
    if (!record || !matchesFilters(record)) return;
    if (records.value.some((item) => item.id === record.id)) return;
    records.value.unshift(record);
  });
}

function parseLogEvent(event: Event): SystemLogRecord | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string")
    return null;
  try {
    const value = JSON.parse(event.data) as SystemLogRecord;
    return typeof value?.id === "string" && typeof value?.message === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

function matchesFilters(record: SystemLogRecord): boolean {
  return (
    (level.value === "all" || record.level === level.value) &&
    (module.value === "all" || record.module === module.value)
  );
}

function levelColor(value: SystemLogLevel): string | undefined {
  if (value === "error") return "error";
  if (value === "warn") return "warning";
  if (value === "info") return "primary";
  return undefined;
}

function backToLogs() {
  selected.value = null;
}
</script>

<template>
  <div class="master-detail-layout system-logs-layout">
    <div v-if="!compact || !selected" class="master-pane">
      <v-card class="panel-card">
        <div class="panel-header system-logs-header">
          <div>
            <div class="panel-title">
              {{ locale.t("$vuetify.chatroom.systemLogs.title") }}
            </div>
            <div class="panel-subtitle">
              {{ locale.t("$vuetify.chatroom.systemLogs.subtitle") }}
            </div>
          </div>
          <v-btn
            icon="$mdiRefresh"
            size="small"
            variant="text"
            :loading="loading"
            :aria-label="locale.t('$vuetify.chatroom.systemLogs.refresh')"
            @click="loadInitial"
          />
        </div>
        <div class="system-log-controls">
          <v-btn-toggle
            v-model="level"
            mandatory
            variant="text"
            class="operation-filters"
          >
            <v-btn
              v-for="item in levelItems"
              :key="item.value"
              :value="item.value"
              size="small"
            >
              {{ item.title }}
            </v-btn>
          </v-btn-toggle>
          <v-select
            v-model="module"
            :items="moduleItems"
            item-title="title"
            item-value="value"
            density="compact"
            variant="outlined"
            hide-details
            class="system-log-module-filter"
          />
        </div>
        <v-divider />
        <div v-if="error" class="processes-error" role="alert">
          <v-icon icon="$mdiAlertCircleOutline" size="18" />
          <span>{{ error }}</span>
        </div>

        <div v-if="records.length" class="system-log-list" role="grid">
          <div class="system-log-header" role="row">
            <span role="columnheader">{{
              locale.t("$vuetify.chatroom.systemLogs.time")
            }}</span>
            <span role="columnheader">{{
              locale.t("$vuetify.chatroom.systemLogs.level")
            }}</span>
            <span role="columnheader">{{
              locale.t("$vuetify.chatroom.systemLogs.module")
            }}</span>
            <span role="columnheader">{{
              locale.t("$vuetify.chatroom.systemLogs.message")
            }}</span>
          </div>
          <button
            v-for="record in records"
            :key="record.id"
            type="button"
            class="system-log-row"
            :class="{ 'selected-row': selected?.id === record.id }"
            :aria-selected="selected?.id === record.id"
            @click="selected = record"
          >
            <span
              class="system-log-time mono"
              role="gridcell"
              :title="record.timestamp"
            >
              {{ clock(record.timestamp) }}
            </span>
            <span class="system-log-level" role="gridcell">
              <v-chip
                size="x-small"
                variant="tonal"
                :color="levelColor(record.level)"
              >
                {{ record.level.toUpperCase() }}
              </v-chip>
            </span>
            <span class="system-log-module mono" role="gridcell">
              {{ record.module }}
            </span>
            <span class="system-log-message" role="gridcell">
              <strong>{{ record.message }}</strong>
              <small class="mono">{{ record.event }}</small>
            </span>
          </button>
        </div>
        <div v-else-if="!loading" class="empty-inline">
          {{ locale.t("$vuetify.chatroom.systemLogs.empty") }}
        </div>
        <div v-if="nextBefore" class="system-log-load-more">
          <v-btn
            variant="text"
            size="small"
            :loading="loadingMore"
            @click="loadMore"
          >
            {{ locale.t("$vuetify.chatroom.systemLogs.loadMore") }}
          </v-btn>
        </div>
      </v-card>
    </div>

    <div v-if="!compact || selected" class="detail-pane">
      <v-card v-if="selected" class="panel-card">
        <div class="panel-header compact-header">
          <v-btn
            v-if="compact"
            icon="$mdiArrowLeft"
            size="small"
            variant="text"
            :aria-label="locale.t('$vuetify.chatroom.systemLogs.back')"
            @click="backToLogs"
          />
          <div class="min-w-0 detail-header-title">
            <div class="panel-title text-truncate">{{ selected.message }}</div>
            <div class="panel-subtitle mono text-truncate">
              {{ selected.event }}
            </div>
          </div>
        </div>
        <v-divider />
        <div class="detail-facts system-log-facts">
          <div>
            <span>{{ locale.t("$vuetify.chatroom.systemLogs.time") }}</span>
            <strong>{{
              dateTime(selected.timestamp, appIntlLocale(locale.current.value))
            }}</strong>
          </div>
          <div>
            <span>{{ locale.t("$vuetify.chatroom.systemLogs.level") }}</span>
            <strong>{{ selected.level.toUpperCase() }}</strong>
          </div>
          <div>
            <span>{{ locale.t("$vuetify.chatroom.systemLogs.module") }}</span>
            <strong>{{ selected.module }}</strong>
          </div>
          <div>
            <span>{{ locale.t("$vuetify.chatroom.systemLogs.event") }}</span>
            <strong>{{ selected.event }}</strong>
          </div>
        </div>
        <template v-if="detailData">
          <v-divider />
          <div class="system-log-detail-data">
            <div class="process-full-command-label">
              {{ locale.t("$vuetify.chatroom.systemLogs.data") }}
            </div>
            <CodeViewer
              :text="detailData"
              filename="log.json"
              language="json"
              :toolbar="false"
            />
          </div>
        </template>
      </v-card>
      <v-card v-else class="panel-card">
        <div class="empty-panel">
          {{ locale.t("$vuetify.chatroom.systemLogs.select") }}
        </div>
      </v-card>
    </div>
  </div>
</template>
