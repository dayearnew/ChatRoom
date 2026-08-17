<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import {
  api,
  type WorktreeApplyPreview,
  type WorktreeFileDiff,
} from "../api.js";
import GitDiffViewer from "./GitDiffViewer.vue";

const props = defineProps<{ workspaceId: string; revision: number }>();
const emit = defineEmits<{ applied: [] }>();
const locale = useLocale();
const preview = ref<WorktreeApplyPreview | null>(null);
const selectedPath = ref<string | null>(null);
const fileDiff = ref<WorktreeFileDiff | null>(null);
const loading = ref(false);
const fileLoading = ref(false);
const applyDialog = ref(false);
const applyPaths = ref<string[] | null>(null);
const applying = ref(false);
const applyError = ref("");
const appliedNotice = ref(false);
const skippedConflictCount = ref(0);
let loadGeneration = 0;

const selectedFile = computed(
  () =>
    preview.value?.files.find((file) => file.path === selectedPath.value) ??
    null,
);

watch(
  () => [props.workspaceId, props.revision] as const,
  () => void loadReview(),
  { immediate: true },
);

async function loadReview() {
  const generation = ++loadGeneration;
  loading.value = true;
  try {
    const next = await api<WorktreeApplyPreview>(
      `/workspaces/${props.workspaceId}/worktree/diff`,
    );
    if (generation !== loadGeneration) return;
    preview.value = next;
    const current = selectedPath.value
      ? next.files.find((item) => item.path === selectedPath.value)
      : null;
    selectedPath.value =
      current?.path ??
      next.files.find((item) => !item.applied)?.path ??
      next.files[0]?.path ??
      null;
    if (selectedPath.value) await loadFileDiff(selectedPath.value, generation);
    else fileDiff.value = null;
  } catch (error) {
    if (generation === loadGeneration)
      applyError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

async function loadFileDiff(filePath: string, generation = loadGeneration) {
  fileLoading.value = true;
  try {
    const next = await api<WorktreeFileDiff>(
      `/workspaces/${props.workspaceId}/worktree/diff/file?path=${encodeURIComponent(filePath)}`,
    );
    if (generation === loadGeneration && selectedPath.value === filePath)
      fileDiff.value = next;
  } catch (error) {
    if (generation === loadGeneration)
      applyError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (generation === loadGeneration) fileLoading.value = false;
  }
}

function selectFile(filePath: string) {
  if (selectedPath.value === filePath) return;
  selectedPath.value = filePath;
  fileDiff.value = null;
  void loadFileDiff(filePath);
}

function openApply(paths: string[] | null) {
  applyPaths.value = paths;
  applyDialog.value = true;
}

async function approveApply() {
  applying.value = true;
  applyError.value = "";
  try {
    const result = await api<{ conflicts: string[] }>(
      `/workspaces/${props.workspaceId}/worktree/apply`,
      {
        method: "POST",
        body: JSON.stringify(
          applyPaths.value ? { paths: applyPaths.value } : {},
        ),
      },
    );
    applyDialog.value = false;
    appliedNotice.value = true;
    skippedConflictCount.value = result.conflicts.length;
    await loadReview();
    emit("applied");
  } catch (error) {
    applyError.value = error instanceof Error ? error.message : String(error);
  } finally {
    applying.value = false;
    applyPaths.value = null;
  }
}

function applyBlockReason(reason: WorktreeApplyPreview["reason"]): string {
  if (reason === "merge-conflicts")
    return locale.t("$vuetify.chatroom.workspaces.applyMergeConflicts");
  if (reason === "head-mismatch")
    return locale.t("$vuetify.chatroom.workspaces.applyHeadMismatch");
  if (reason === "no-changes")
    return locale.t("$vuetify.chatroom.workspaces.noWorktreeChanges");
  return "";
}

function statusLetter(
  status: WorktreeApplyPreview["files"][number]["status"],
): string {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "type-changed") return "T";
  return "M";
}

function fileName(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

function fileDirectory(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : "";
}
</script>

<template>
  <div class="worktree-diff-pane">
    <div class="worktree-diff-header">
      <div class="min-w-0">
        <div class="font-weight-medium">
          {{ locale.t("$vuetify.chatroom.workspaces.worktreeChanges") }}
        </div>
        <div class="text-caption muted">
          <template v-if="preview">
            {{ preview.pendingFiles }}
            {{ locale.t("$vuetify.chatroom.workspaces.pendingFiles") }} ·
            {{ preview.appliedFiles }}
            {{ locale.t("$vuetify.chatroom.workspaces.appliedFiles") }} ·
            {{ preview.conflictFiles }}
            {{ locale.t("$vuetify.chatroom.workspaces.conflictFiles") }}
          </template>
          <template v-else>{{
            locale.t("$vuetify.chatroom.workspaces.worktreeChangesDescription")
          }}</template>
        </div>
      </div>
      <v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-check-all"
        :disabled="!preview?.canApply || loading"
        @click="openApply(null)"
      >
        {{ locale.t("$vuetify.chatroom.workspaces.approveAll") }}
      </v-btn>
    </div>

    <v-progress-linear v-if="loading" indeterminate />
    <v-alert
      v-if="appliedNotice"
      :type="skippedConflictCount ? 'warning' : 'success'"
      variant="tonal"
      density="compact"
    >
      {{
        skippedConflictCount
          ? locale.t(
              "$vuetify.chatroom.workspaces.applyPartialSuccess",
              skippedConflictCount,
            )
          : locale.t("$vuetify.chatroom.workspaces.applySuccess")
      }}
    </v-alert>
    <v-alert v-if="applyError" type="error" variant="tonal" density="compact">{{
      applyError
    }}</v-alert>
    <v-alert
      v-if="preview && !preview.canApply && preview.reason !== 'no-changes'"
      type="warning"
      variant="tonal"
      density="compact"
    >
      {{ applyBlockReason(preview.reason) }}
    </v-alert>
    <v-alert
      v-if="preview?.canApply && preview.conflictFiles > 0"
      type="warning"
      variant="tonal"
      density="compact"
    >
      {{
        locale.t(
          "$vuetify.chatroom.workspaces.mergeConflictsWarning",
          preview.conflictFiles,
        )
      }}
    </v-alert>

    <div v-if="preview?.files.length" class="worktree-review">
      <aside class="worktree-file-list">
        <button
          v-for="changedFile in preview.files"
          :key="changedFile.path"
          type="button"
          class="worktree-file-row"
          :class="{
            active: changedFile.path === selectedPath,
            applied: changedFile.applied,
            conflict: changedFile.conflict,
          }"
          @click="selectFile(changedFile.path)"
        >
          <span
            class="worktree-file-status"
            :class="`status-${changedFile.status}`"
          >
            {{ statusLetter(changedFile.status) }}
          </span>
          <span class="worktree-file-main min-w-0">
            <span class="worktree-file-name">{{
              fileName(changedFile.path)
            }}</span>
            <span
              v-if="fileDirectory(changedFile.path)"
              class="worktree-file-directory"
            >
              {{ fileDirectory(changedFile.path) }}
            </span>
          </span>
          <span class="worktree-file-stats">
            <template v-if="changedFile.binary">{{
              locale.t("$vuetify.chatroom.workspaces.binaryShort")
            }}</template>
            <template v-else>
              <span class="diff-addition"
                >+{{ changedFile.additions ?? 0 }}</span
              >
              <span class="diff-deletion"
                >-{{ changedFile.deletions ?? 0 }}</span
              >
            </template>
          </span>
          <v-icon
            v-if="changedFile.applied"
            icon="mdi-check-circle"
            size="16"
            class="worktree-file-applied"
          />
          <v-icon
            v-else-if="changedFile.conflict"
            icon="mdi-alert-circle"
            size="16"
            class="worktree-file-conflict"
          />
        </button>
      </aside>

      <section class="worktree-file-diff min-w-0">
        <div v-if="selectedFile" class="worktree-file-diff-header">
          <div class="min-w-0">
            <div class="worktree-file-diff-path text-truncate">
              {{ selectedFile.path }}
            </div>
            <div class="text-caption muted">
              <span v-if="selectedFile.binary">{{
                locale.t("$vuetify.chatroom.workspaces.binary")
              }}</span>
              <template v-else>
                <span class="diff-addition"
                  >+{{ selectedFile.additions ?? 0 }}</span
                >
                <span class="diff-deletion ml-2"
                  >-{{ selectedFile.deletions ?? 0 }}</span
                >
              </template>
            </div>
          </div>
          <v-chip
            v-if="selectedFile.applied"
            prepend-icon="mdi-check"
            size="small"
          >
            {{ locale.t("$vuetify.chatroom.workspaces.applied") }}
          </v-chip>
          <v-chip
            v-else-if="selectedFile.conflict"
            prepend-icon="mdi-alert-circle"
            color="warning"
            size="small"
          >
            {{ locale.t("$vuetify.chatroom.workspaces.mergeConflict") }}
          </v-chip>
          <v-btn
            v-else
            color="primary"
            variant="tonal"
            size="small"
            prepend-icon="mdi-check-circle-outline"
            :disabled="!preview?.canApply || selectedFile.conflict"
            @click="openApply([selectedFile.path])"
          >
            {{ locale.t("$vuetify.chatroom.workspaces.approveFile") }}
          </v-btn>
        </div>
        <v-progress-linear v-if="fileLoading" indeterminate />
        <v-alert
          v-if="selectedFile?.conflict"
          type="warning"
          variant="tonal"
          density="compact"
          class="ma-3"
        >
          {{
            locale.t("$vuetify.chatroom.workspaces.mergeConflictDescription")
          }}
        </v-alert>
        <v-alert
          v-if="fileDiff?.truncated"
          type="info"
          variant="tonal"
          density="compact"
          class="ma-3"
        >
          {{ locale.t("$vuetify.chatroom.workspaces.diffTruncated") }}
        </v-alert>
        <GitDiffViewer v-if="fileDiff" :text="fileDiff.diff" />
      </section>
    </div>
    <div v-else-if="!loading" class="empty-inline">
      {{ locale.t("$vuetify.chatroom.workspaces.noWorktreeChanges") }}
    </div>
  </div>

  <v-dialog v-model="applyDialog" max-width="520">
    <v-card>
      <v-card-title>
        {{
          applyPaths
            ? locale.t("$vuetify.chatroom.workspaces.applyFileTitle")
            : locale.t("$vuetify.chatroom.workspaces.applyTitle")
        }}
      </v-card-title>
      <v-card-text>
        {{
          applyPaths
            ? locale.t("$vuetify.chatroom.workspaces.applyFileDescription")
            : locale.t("$vuetify.chatroom.workspaces.applyDescription")
        }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="applyDialog = false">{{
          locale.t("$vuetify.chatroom.common.cancel")
        }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="applying"
          @click="approveApply"
        >
          {{
            applyPaths
              ? locale.t("$vuetify.chatroom.workspaces.approveFile")
              : locale.t("$vuetify.chatroom.workspaces.approveAll")
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
