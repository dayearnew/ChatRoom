<script setup lang="ts">
import { ref, watch } from "vue";
import { useLocale } from "vuetify";
import { api, type Operation } from "../api.js";
import OperationTable from "./OperationTable.vue";
import OperationDetail from "./OperationDetail.vue";

const props = defineProps<{ revision: number }>();
const events = ref<Operation[]>([]);
const selected = ref<string | null>(null);
const detail = ref<Operation | null>(null);
const filter = ref("all");
const clearDialog = ref(false);
const clearing = ref(false);
const locale = useLocale();

watch([() => props.revision, filter], () => void load(), { immediate: true });
watch(selected, () => void loadDetail());

async function load() {
  events.value = await api<Operation[]>(
    `/operations?limit=250${filter.value === "all" ? "" : `&status=${filter.value}`}`,
  );
  if (selected.value) await loadDetail();
}

async function loadDetail() {
  detail.value = selected.value
    ? await api<Operation>(`/operations/${selected.value}`)
    : null;
}

function select(event: Operation) {
  selected.value = event.operationId;
}

async function clearHistory() {
  clearing.value = true;
  try {
    await api<{ deleted: number; preserved: number }>("/operations", {
      method: "DELETE",
    });
    selected.value = null;
    detail.value = null;
    clearDialog.value = false;
    await load();
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div class="master-detail-layout operations-layout">
    <div class="master-pane">
      <v-card class="panel-card">
        <div class="panel-header panel-header-wrap">
          <div>
            <div class="panel-title">
              {{ locale.t("$vuetify.chatroom.operations.title") }}
            </div>
            <div class="panel-subtitle">
              {{ locale.t("$vuetify.chatroom.operations.subtitle") }}
            </div>
          </div>
          <v-btn-toggle
            v-model="filter"
            mandatory
            density="compact"
            variant="outlined"
            class="operation-filters"
          >
            <v-btn value="all">{{
              locale.t("$vuetify.chatroom.operations.all")
            }}</v-btn>
            <v-btn value="running">{{
              locale.t("$vuetify.chatroom.operations.running")
            }}</v-btn>
            <v-btn value="error">{{
              locale.t("$vuetify.chatroom.operations.errors")
            }}</v-btn>
            <v-btn value="success">{{
              locale.t("$vuetify.chatroom.operations.success")
            }}</v-btn>
          </v-btn-toggle>
          <v-btn
            prepend-icon="mdi-delete-sweep-outline"
            variant="text"
            size="small"
            :disabled="!events.length"
            @click="clearDialog = true"
          >
            {{ locale.t("$vuetify.chatroom.operations.clear") }}
          </v-btn>
        </div>
        <v-divider />
        <OperationTable
          :events="events"
          :selected="selected"
          @select="select"
        />
      </v-card>
    </div>
    <div class="detail-pane">
      <OperationDetail :event="detail" />
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
