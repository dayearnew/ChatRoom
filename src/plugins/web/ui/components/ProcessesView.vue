<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import { api, type ProcessSnapshot } from "../api.js";
import { appIntlLocale } from "../locales.js";
import { duration } from "../utils.js";
import CodeViewer from "./CodeViewer.vue";
import StateChip from "./StateChip.vue";

const props = defineProps<{ revision: number }>();
const items = ref<ProcessSnapshot[]>([]);
const selected = ref<string | null>(null);
const detail = ref<ProcessSnapshot | null>(null);
const locale = useLocale();
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
  items.value = await api<ProcessSnapshot[]>("/processes");
  if (selected.value) await loadDetail();
}

async function loadDetail() {
  detail.value = selected.value
    ? await api<ProcessSnapshot>(`/processes/${selected.value}`)
    : null;
}

async function stop(id: string, force: boolean) {
  await api(`/processes/${id}/${force ? "kill" : "terminate"}`, {
    method: "POST",
  });
  await load();
}
</script>

<template>
  <div class="master-detail-layout processes-layout">
    <div class="master-pane">
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

        <div v-if="items.length" class="table-shell">
          <v-table density="comfortable" hover class="process-table">
            <thead>
              <tr>
                <th class="process-col-command">
                  {{ locale.t("$vuetify.chatroom.processes.command") }}
                </th>
                <th class="process-col-state">
                  {{ locale.t("$vuetify.chatroom.processes.state") }}
                </th>
                <th class="process-col-started">
                  {{ locale.t("$vuetify.chatroom.processes.started") }}
                </th>
                <th class="process-col-duration text-right">
                  {{ locale.t("$vuetify.chatroom.processes.duration") }}
                </th>
                <th class="process-col-actions" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in items"
                :key="item.processId"
                class="clickable"
                :class="{ 'selected-row': selected === item.processId }"
                @click="selected = item.processId"
              >
                <td class="process-command-cell">
                  <div
                    class="font-weight-medium process-command"
                    :title="item.command"
                  >
                    {{ item.command }}
                  </div>
                  <div
                    v-if="item.args.length"
                    class="text-caption muted command-args"
                    :title="item.args.join(' ')"
                  >
                    {{ item.args.join(" ") }}
                  </div>
                </td>
                <td><StateChip :value="item.state" /></td>
                <td class="process-col-started text-body-2">
                  {{
                    new Date(item.startedAt).toLocaleString(
                      appIntlLocale(locale.current.value),
                    )
                  }}
                </td>
                <td class="process-col-duration text-right text-body-2">
                  {{ duration(item.durationMs) }}
                </td>
                <td class="text-right process-actions-cell">
                  <div
                    v-if="item.state === 'running'"
                    class="process-actions"
                    @click.stop
                  >
                    <v-btn
                      icon="mdi-stop-circle-outline"
                      size="x-small"
                      variant="text"
                      class="table-action-btn"
                      :aria-label="
                        locale.t('$vuetify.chatroom.processes.terminate')
                      "
                      @click="stop(item.processId, false)"
                    />
                    <v-menu>
                      <template #activator="{ props: menuProps }">
                        <v-btn
                          v-bind="menuProps"
                          icon="mdi-dots-horizontal"
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
                          prepend-icon="mdi-close-octagon-outline"
                          @click="stop(item.processId, true)"
                        />
                      </v-list>
                    </v-menu>
                  </div>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
        <div v-else class="empty-inline">
          {{ locale.t("$vuetify.chatroom.processes.empty") }}
        </div>
      </v-card>
    </div>

    <div class="detail-pane">
      <v-card v-if="detail" class="panel-card">
        <div class="panel-header process-detail-header">
          <div class="min-w-0">
            <div class="panel-title text-truncate">{{ detail.command }}</div>
            <div class="panel-subtitle mono text-truncate">
              {{ detail.processId }}
            </div>
          </div>
          <div class="process-detail-actions">
            <StateChip :value="detail.state" />
            <v-btn
              v-if="detail.state === 'running'"
              prepend-icon="mdi-stop-circle-outline"
              size="x-small"
              variant="tonal"
              class="detail-action-btn"
              @click="stop(detail.processId, false)"
            >
              {{ locale.t("$vuetify.chatroom.processes.terminate") }}
            </v-btn>
            <v-menu v-if="detail.state === 'running'">
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  icon="mdi-dots-horizontal"
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
                  prepend-icon="mdi-close-octagon-outline"
                  @click="stop(detail.processId, true)"
                />
              </v-list>
            </v-menu>
          </div>
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
        <v-divider />
        <div class="pa-3">
          <CodeViewer :text="detail.stdout" filename="stdout.txt" />
        </div>
        <div v-if="detail.stderr" class="pa-3 pt-0">
          <CodeViewer :text="detail.stderr" filename="stderr.txt" />
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
