<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import { api, type WorkspaceInfo } from "../api.js";
import { errorMessage } from "../utils/errors.js";
import { createRequestGate } from "../utils/requests.js";

const SUMMARY_PATH = ".chatroom/summary.md";
const PROMPT_PATH = ".chatroom/prompt.md";

const props = defineProps<{ root: string }>();
const summary = ref("");
const prompt = ref("");
const originalSummary = ref("");
const originalPrompt = ref("");
const loading = ref(false);
const saving = ref(false);
const saved = ref(false);
const error = ref("");
const locale = useLocale();
const loadRequests = createRequestGate();

const dirty = computed(
  () =>
    summary.value !== originalSummary.value ||
    prompt.value !== originalPrompt.value,
);

watch(
  () => props.root,
  () => void load(),
  { immediate: true },
);

async function load() {
  const request = loadRequests.begin();
  const root = props.root;
  loading.value = true;
  error.value = "";
  saved.value = false;
  try {
    const info = await api<WorkspaceInfo>(
      `/workspace?root=${encodeURIComponent(root)}`,
      { signal: request.signal },
    );
    if (!loadRequests.isCurrent(request) || props.root !== root) return;
    summary.value = info.summary ?? "";
    prompt.value = info.presetPrompt ?? "";
    originalSummary.value = summary.value;
    originalPrompt.value = prompt.value;
  } catch (cause) {
    if (loadRequests.isCurrent(request)) error.value = errorMessage(cause);
  } finally {
    if (loadRequests.isCurrent(request)) loading.value = false;
  }
}

async function writeFile(root: string, path: string, content: string) {
  await api("/workspace/file", {
    method: "PUT",
    body: JSON.stringify({ root, path, content }),
  });
}

async function save() {
  if (!dirty.value) return;
  const root = props.root;
  const nextSummary = summary.value;
  const nextPrompt = prompt.value;
  saving.value = true;
  error.value = "";
  saved.value = false;
  try {
    const writes: Promise<void>[] = [];
    if (nextSummary !== originalSummary.value)
      writes.push(writeFile(root, SUMMARY_PATH, nextSummary));
    if (nextPrompt !== originalPrompt.value)
      writes.push(writeFile(root, PROMPT_PATH, nextPrompt));
    await Promise.all(writes);
    if (props.root !== root) return;
    originalSummary.value = nextSummary;
    originalPrompt.value = nextPrompt;
    saved.value = true;
  } catch (cause) {
    if (props.root === root) error.value = errorMessage(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="workspace-prompt-pane">
    <v-progress-linear v-if="loading" indeterminate />
    <div class="workspace-prompt-form">
      <v-textarea
        v-model="summary"
        :label="locale.t('$vuetify.chatroom.workspaces.summary')"
        rows="3"
        auto-grow
        maxlength="2048"
        counter
        :disabled="loading"
      />
      <v-textarea
        v-model="prompt"
        :label="locale.t('$vuetify.chatroom.workspaces.presetPrompt')"
        rows="10"
        auto-grow
        maxlength="16384"
        counter
        :disabled="loading"
      />
      <v-alert v-if="error" type="error" variant="tonal" density="compact">
        {{ error }}
      </v-alert>
      <v-alert
        v-else-if="saved"
        type="success"
        variant="tonal"
        density="compact"
      >
        {{ locale.t("$vuetify.chatroom.workspaces.saved") }}
      </v-alert>
      <div class="workspace-prompt-actions">
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="loading || !dirty"
          @click="save"
        >
          {{ locale.t("$vuetify.chatroom.workspaces.save") }}
        </v-btn>
      </div>
    </div>
  </div>
</template>
