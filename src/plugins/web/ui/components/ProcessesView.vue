<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useDisplay, useLocale } from "vuetify";
import { ApiError, api, type ProcessSnapshot } from "../api.js";
import { appIntlLocale } from "../locales.js";
import { dateTime, duration } from "../utils.js";
import { errorMessage } from "../utils/errors.js";
import { createRequestGate } from "../utils/requests.js";
import CodeViewer from "./CodeViewer.vue";
import StateChip from "./StateChip.vue";

const props = defineProps<{ revision: number }>();
const items = ref<ProcessSnapshot[]>([]);
const selected = ref<string | null>(null);
const detail = ref<ProcessSnapshot | null>(null);
const error = ref("");
const locale = useLocale();
const { mdAndDown: compact } = useDisplay();
const layout = ref<HTMLElement | null>(null);
const listRequests = createRequestGate();
const detailRequests = createRequestGate();
const processOutput = computed(() => {
  if (!detail.value) return "";
  const stderr = detail.value.stderr
    ? `\n\n[stderr]\n${detail.value.stderr}`
    : "";
  return `${detail.value.stdout}${stderr}`;
});
const fullCommand = computed(() =>
  detail.value
    ? [detail.value.command, ...detail.value.args]
        .map(formatCommandPart)
        .join(" ")
    : "",
);

function formatCommandPart(value: string): string {
  if (!value) return "''";
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

watch(
  () => props.revision,
  () => void load(),
  { immediate: true },
);
watch(selected, () => void loadDetail());

async function load() {
  const request = listRequests.begin();
  error.value = "";
  try {
    const next = await api<ProcessSnapshot[]>("/processes", {
      signal: request.signal,
    });
    if (!listRequests.isCurrent(request)) return;
    items.value = next;
    if (
      selected.value &&
      !next.some((item) => item.processId === selected.value)
    ) {
      clearSelection();
      return;
    }
    if (selected.value) await loadDetail();
  } catch (cause) {
    if (listRequests.isCurrent(request)) error.value = errorMessage(cause);
  }
}

async function loadDetail() {
  const request = detailRequests.begin();
  const processId = selected.value;
  if (!processId) {
    detail.value = null;
    return;
  }
  try {
    const next = await api<ProcessSnapshot>(`/processes/${processId}`, {
      signal: request.signal,
    });
    if (detailRequests.isCurrent(request) && selected.value === processId)
      detail.value = next;
  } catch (cause) {
    if (!detailRequests.isCurrent(request)) return;
    if (isStaleProcessError(cause)) {
      clearSelection();
      void load();
      return;
    }
    error.value = errorMessage(cause);
  }
}

function selectProcess(processId: string) {
  selected.value = processId;
  if (compact.value) {
    void nextTick(() =>
      layout.value?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
}

function clearSelection() {
  selected.value = null;
  detail.value = null;
}

function backToProcesses() {
  clearSelection();
}

async function stop(id: string, force: boolean) {
  listRequests.invalidate();
  detailRequests.invalidate();
  error.value = "";
  try {
    await api(`/processes/${id}/${force ? "kill" : "terminate"}`, {
      method: "POST",
    });
    await load();
  } catch (cause) {
    if (isStaleProcessError(cause)) {
      await load();
      return;
    }
    error.value = errorMessage(cause);
  }
}

function isStaleProcessError(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    (cause.code === "NOT_FOUND" || cause.code === "CONFLICT")
  );
}
</script>

<template>
  <div ref="layout" class="master-detail-layout processes-layout">
    <div v-if="!compact || !selected" class="master-pane">
      <v-card class="panel-card">
        <div class="panel-header">
          <div>
            <div class="panel-title">
              {{ locale.t("$vuetify.chatroom.processes.title") }}
            </div>
            <div class="panel-subtitle">
              {{ locale.t("$vuetify.chatroom.processes.subtitle") }}
            </div>
          </div>
        </div>
        <v-divider />
        <div v-if="error" class="processes-error" role="alert">
          <v-icon icon="$mdiAlertCircleOutline" size="18" />
          <span>{{ error }}</span>
        </div>

        <div v-if="items.length" class="process-record-list" role="grid">
          <div class="process-record-header" role="row">
            <span role="columnheader">{{
              locale.t("$vuetify.chatroom.processes.command")
            }}</span>
            <span role="columnheader">{{
              locale.t("$vuetify.chatroom.processes.arguments")
            }}</span>
            <span role="columnheader">{{
              locale.t("$vuetify.chatroom.processes.started")
            }}</span>
            <span class="process-record-duration" role="columnheader">{{
              locale.t("$vuetify.chatroom.processes.duration")
            }}</span>
            <span role="columnheader">{{
              locale.t("$vuetify.chatroom.processes.state")
            }}</span>
          </div>
          <div
            v-for="item in items"
            :key="item.processId"
            role="row"
            tabindex="0"
            class="process-record-row"
            :class="{ 'selected-row': selected === item.processId }"
            :aria-selected="selected === item.processId"
            @click="selectProcess(item.processId)"
            @keydown.enter="selectProcess(item.processId)"
            @keydown.space.prevent="selectProcess(item.processId)"
          >
            <div class="process-record-main">
              <div
                class="process-record-command mono"
                role="gridcell"
                :title="item.command"
              >
                {{ item.command }}
              </div>
              <div
                class="process-record-args mono"
                role="gridcell"
                :class="{ muted: !item.args.length }"
                :title="item.args.join(' ')"
              >
                {{ item.args.length ? item.args.join(" ") : "—" }}
              </div>
            </div>
            <div class="process-record-meta">
              <div class="process-record-started" role="gridcell">
                {{
                  dateTime(item.startedAt, appIntlLocale(locale.current.value))
                }}
              </div>
              <div class="process-record-duration" role="gridcell">
                {{ duration(item.durationMs) }}
              </div>
            </div>
            <div class="process-record-side" role="gridcell">
              <StateChip v-if="item.state !== 'running'" :value="item.state" />
              <div v-else class="process-actions" @click.stop>
                <v-btn
                  size="x-small"
                  variant="text"
                  class="table-action-btn"
                  :aria-label="
                    locale.t('$vuetify.chatroom.processes.terminate')
                  "
                  @click="stop(item.processId, false)"
                >
                  <v-progress-circular
                    indeterminate
                    color="warning"
                    :size="22"
                    :width="2"
                  >
                    <v-icon icon="$mdiStop" size="12" />
                  </v-progress-circular>
                </v-btn>
                <v-menu>
                  <template #activator="{ props: menuProps }">
                    <v-btn
                      v-bind="menuProps"
                      icon="$mdiDotsHorizontal"
                      size="x-small"
                      variant="text"
                      class="table-action-btn"
                      :aria-label="
                        locale.t('$vuetify.chatroom.processes.moreActions')
                      "
                    />
                  </template>
                  <v-list density="compact">
                    <v-list-item
                      :title="locale.t('$vuetify.chatroom.processes.kill')"
                      prepend-icon="$mdiCloseOctagonOutline"
                      @click="stop(item.processId, true)"
                    />
                  </v-list>
                </v-menu>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="empty-inline">
          {{ locale.t("$vuetify.chatroom.processes.empty") }}
        </div>
      </v-card>
    </div>

    <div v-if="!compact || selected" class="detail-pane">
      <v-card v-if="detail" class="panel-card process-detail-card">
        <div class="panel-header process-detail-header">
          <v-btn
            v-if="compact"
            icon="$mdiArrowLeft"
            size="small"
            variant="text"
            :aria-label="locale.t('$vuetify.chatroom.processes.back')"
            @click="backToProcesses"
          />
          <div class="min-w-0 detail-header-title">
            <div class="panel-title text-truncate">{{ detail.command }}</div>
            <div class="panel-subtitle mono text-truncate">
              {{ detail.processId }}
            </div>
          </div>
          <div class="process-detail-actions">
            <StateChip
              v-if="detail.state !== 'running'"
              :value="detail.state"
            />
            <v-btn
              v-if="detail.state === 'running'"
              prepend-icon="$mdiStopCircleOutline"
              size="x-small"
              variant="tonal"
              color="warning"
              class="detail-action-btn"
              @click="stop(detail.processId, false)"
            >
              {{ locale.t("$vuetify.chatroom.processes.terminate") }}
            </v-btn>
            <v-menu v-if="detail.state === 'running'">
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  icon="$mdiDotsHorizontal"
                  size="x-small"
                  variant="text"
                  class="detail-icon-btn"
                  :aria-label="
                    locale.t('$vuetify.chatroom.processes.moreActions')
                  "
                />
              </template>
              <v-list density="compact">
                <v-list-item
                  :title="locale.t('$vuetify.chatroom.processes.kill')"
                  prepend-icon="$mdiCloseOctagonOutline"
                  @click="stop(detail.processId, true)"
                />
              </v-list>
            </v-menu>
          </div>
        </div>
        <v-divider />
        <div class="process-output">
          <CodeViewer :text="processOutput" filename="output.txt" />
        </div>
        <v-divider />
        <div class="process-full-command">
          <div class="process-full-command-label">
            {{ locale.t("$vuetify.chatroom.processes.fullCommand") }}
          </div>
          <CodeViewer
            :text="fullCommand"
            filename="command.sh"
            language="bash"
            :toolbar="false"
          />
        </div>
        <v-divider />
        <div class="detail-facts">
          <div>
            <span>PID</span><strong>{{ detail.pid ?? "—" }}</strong>
          </div>
          <div>
            <span>{{ locale.t("$vuetify.chatroom.processes.exit") }}</span
            ><strong>{{ detail.exitCode ?? "—" }}</strong>
          </div>
          <div>
            <span>{{ locale.t("$vuetify.chatroom.processes.timeout") }}</span
            ><strong>{{
              detail.timedOut
                ? locale.t("$vuetify.chatroom.processes.yes")
                : locale.t("$vuetify.chatroom.processes.no")
            }}</strong>
          </div>
        </div>
      </v-card>
      <v-card v-else class="panel-card">
        <div class="empty-panel">
          {{ locale.t("$vuetify.chatroom.processes.select") }}
        </div>
      </v-card>
    </div>
  </div>
</template>
