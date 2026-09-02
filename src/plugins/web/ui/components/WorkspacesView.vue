<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useLocale } from "vuetify";
import { api, type WorkspaceEntry } from "../api.js";
import { basename } from "../utils.js";
import WorkspaceFilesPane from "./WorkspaceFilesPane.vue";
import WorkspaceGitPane from "./WorkspaceGitPane.vue";
import WorkspaceSkillsPane from "./WorkspaceSkillsPane.vue";

defineProps<{ revision: number }>();

const items = ref<WorkspaceEntry[]>([]);
const selectedRoot = ref<string | null>(
  window.localStorage.getItem("chatroom.workspace.root"),
);
const tab = ref("git");
const loading = ref(false);
const error = ref("");
const locale = useLocale();

onMounted(() => void load());
watch(selectedRoot, (root) => {
  if (root) window.localStorage.setItem("chatroom.workspace.root", root);
  else window.localStorage.removeItem("chatroom.workspace.root");
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    items.value = await api<WorkspaceEntry[]>("/workspaces");
    if (!items.value.some((item) => item.root === selectedRoot.value))
      selectedRoot.value = items.value[0]?.root ?? null;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="workspace-layout">
    <v-card class="workspace-detail panel-card">
      <div class="workspace-header">
        <div class="workspace-identity min-w-0">
          <div class="workspace-selector-row">
            <v-select
              v-model="selectedRoot"
              :items="
                items.map((item) => ({
                  title: basename(item.root),
                  value: item.root,
                }))
              "
              :loading="loading"
              density="compact"
              variant="outlined"
              hide-details
              prepend-inner-icon="mdi-folder-outline"
              class="workspace-switcher"
            />
            <v-btn
              icon="mdi-refresh"
              size="small"
              variant="text"
              :loading="loading"
              @click="load"
            />
          </div>
          <div v-if="selectedRoot" class="workspace-path">
            {{ selectedRoot }}
          </div>
        </div>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" density="compact">
        {{ error }}
      </v-alert>

      <template v-if="selectedRoot">
        <v-tabs v-model="tab" density="compact" class="workspace-tabs">
          <v-tab value="git">Git</v-tab>
          <v-tab value="files">{{
            locale.t("$vuetify.chatroom.workspaces.files")
          }}</v-tab>
          <v-tab value="skills">{{
            locale.t("$vuetify.chatroom.workspaces.skills")
          }}</v-tab>
        </v-tabs>
        <v-divider />

        <v-window v-model="tab">
          <v-window-item value="git">
            <WorkspaceGitPane :root="selectedRoot" />
          </v-window-item>
          <v-window-item value="files">
            <WorkspaceFilesPane :root="selectedRoot" />
          </v-window-item>
          <v-window-item value="skills">
            <WorkspaceSkillsPane :root="selectedRoot" />
          </v-window-item>
        </v-window>
      </template>

      <v-empty-state
        v-else-if="!loading"
        icon="mdi-folder-outline"
        :title="locale.t('$vuetify.chatroom.workspaces.empty')"
      />
    </v-card>
  </div>
</template>
