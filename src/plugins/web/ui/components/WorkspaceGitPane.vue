<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import {
  api,
  type GitBranch,
  type GitChange,
  type GitCommit,
  type GitDiff,
  type GitStatus,
} from "../api.js";
import { appIntlLocale } from "../locales.js";
import GitDiffViewer from "./GitDiffViewer.vue";

const props = defineProps<{ root: string }>();
const locale = useLocale();
const status = ref<GitStatus | null>(null);
const branches = ref<GitBranch[]>([]);
const commits = ref<GitCommit[]>([]);
const selectedPath = ref<string | null>(null);
const diff = ref<GitDiff | null>(null);
const loading = ref(false);
const diffLoading = ref(false);
const busy = ref<string | null>(null);
const error = ref("");
const commitMessage = ref("");
const branchDialog = ref(false);
const newBranch = ref("");
const restoreTarget = ref<GitChange | null>(null);
const deleteBranchTarget = ref<GitBranch | null>(null);
let generation = 0;
let diffGeneration = 0;

const changes = computed(() => status.value?.changes ?? []);
const selectedChange = computed(
  () =>
    changes.value.find((change) => change.path === selectedPath.value) ?? null,
);
const stagedPaths = computed(() =>
  changes.value.filter(isStaged).map((change) => change.path),
);
const unstagedPaths = computed(() =>
  changes.value.filter(isUnstaged).map((change) => change.path),
);

watch(
  () => props.root,
  () => {
    selectedPath.value = null;
    diff.value = null;
    void load();
  },
  { immediate: true },
);
watch(selectedPath, () => void loadDiff());

async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const next = await api<GitStatus | null>(
      `/git/status?root=${encodeURIComponent(props.root)}`,
    );
    if (current !== generation) return;
    status.value = next;
    if (!next) {
      branches.value = [];
      commits.value = [];
      selectedPath.value = null;
      diff.value = null;
      return;
    }
    await loadAncillary(current);
    normalizeSelection();
    await loadDiff();
  } catch (cause) {
    if (current === generation)
      error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (current === generation) loading.value = false;
  }
}

async function loadAncillary(current = generation) {
  const encoded = encodeURIComponent(props.root);
  const [nextBranches, nextCommits] = await Promise.all([
    api<GitBranch[]>(`/git/branches?root=${encoded}`),
    api<GitCommit[]>(`/git/log?root=${encoded}&limit=20`),
  ]);
  if (current !== generation) return;
  branches.value = nextBranches;
  commits.value = nextCommits;
}

async function loadDiff() {
  const path = selectedPath.value;
  if (!path || !status.value?.head) {
    diff.value = null;
    return;
  }
  const current = ++diffGeneration;
  diffLoading.value = true;
  try {
    const next = await api<GitDiff>(
      `/git/diff?root=${encodeURIComponent(props.root)}&path=${encodeURIComponent(path)}`,
    );
    if (current === diffGeneration) diff.value = next;
  } catch (cause) {
    if (current === diffGeneration) {
      diff.value = null;
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    if (current === diffGeneration) diffLoading.value = false;
  }
}

function normalizeSelection() {
  if (!changes.value.some((change) => change.path === selectedPath.value))
    selectedPath.value = changes.value[0]?.path ?? null;
}

function isStaged(change: GitChange): boolean {
  return change.indexStatus !== " " && change.indexStatus !== "?";
}

function isUnstaged(change: GitChange): boolean {
  return (
    change.indexStatus === "?" ||
    (change.workingTreeStatus !== " " && change.workingTreeStatus !== "?")
  );
}

function statusCode(change: GitChange): string {
  return `${change.indexStatus}${change.workingTreeStatus}`.replaceAll(
    " ",
    "·",
  );
}

async function mutate(
  key: string,
  endpoint: string,
  method: "POST" | "DELETE",
  body: Record<string, unknown>,
) {
  busy.value = key;
  error.value = "";
  try {
    status.value = await api<GitStatus>(endpoint, {
      method,
      body: JSON.stringify({ root: props.root, ...body }),
    });
    normalizeSelection();
    await loadAncillary();
    await loadDiff();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    throw cause;
  } finally {
    busy.value = null;
  }
}

async function stage(paths: string[]) {
  if (!paths.length) return;
  try {
    await mutate("stage", "/git/stage", "POST", { paths });
  } catch {}
}

async function unstage(paths: string[]) {
  if (!paths.length) return;
  try {
    await mutate("unstage", "/git/unstage", "POST", { paths });
  } catch {}
}

async function confirmRestore() {
  const target = restoreTarget.value;
  if (!target) return;
  try {
    await mutate("restore", "/git/restore", "POST", { path: target.path });
    restoreTarget.value = null;
  } catch {}
}

async function commit() {
  const message = commitMessage.value.trim();
  if (!message) return;
  try {
    await mutate("commit", "/git/commit", "POST", { message });
    commitMessage.value = "";
  } catch {}
}

async function createBranch() {
  const name = newBranch.value.trim();
  if (!name) return;
  try {
    await mutate("branch", "/git/branches", "POST", { name });
    newBranch.value = "";
    branchDialog.value = false;
  } catch {}
}

async function switchBranch(branch: GitBranch) {
  if (branch.current) return;
  try {
    await mutate("branch", "/git/switch", "POST", { name: branch.name });
    branchDialog.value = false;
  } catch {}
}

async function confirmDeleteBranch() {
  const branch = deleteBranchTarget.value;
  if (!branch) return;
  try {
    await mutate("branch", "/git/branches", "DELETE", { name: branch.name });
    deleteBranchTarget.value = null;
  } catch {}
}

async function remote(action: "fetch" | "pull" | "push") {
  try {
    await mutate(action, `/git/${action}`, "POST", {});
  } catch {}
}
</script>

<template>
  <div class="workspace-git-pane">
    <v-progress-linear v-if="loading" indeterminate />
    <v-alert v-if="error" type="error" variant="tonal" density="compact">
      {{ error }}
    </v-alert>

    <v-empty-state
      v-if="!loading && !status"
      icon="mdi-source-branch"
      :title="locale.t('$vuetify.chatroom.git.notRepository')"
    />

    <template v-else-if="status">
      <div class="git-toolbar">
        <div class="git-facts">
          <div>
            <span>{{ locale.t("$vuetify.chatroom.git.branch") }}</span>
            <strong class="mono">{{ status.branch ?? "—" }}</strong>
          </div>
          <div>
            <span>HEAD</span>
            <strong class="mono">{{ status.head?.slice(0, 12) ?? "—" }}</strong>
          </div>
          <div>
            <span>{{ locale.t("$vuetify.chatroom.git.upstream") }}</span>
            <strong class="mono">{{ status.upstream ?? "—" }}</strong>
          </div>
          <div v-if="status.upstream">
            <span>{{ locale.t("$vuetify.chatroom.git.sync") }}</span>
            <strong>↑ {{ status.ahead }} · ↓ {{ status.behind }}</strong>
          </div>
        </div>
        <div class="git-toolbar-actions">
          <v-btn
            icon="mdi-refresh"
            size="small"
            variant="text"
            :loading="loading"
            @click="load"
          />
          <v-btn
            prepend-icon="mdi-source-branch"
            size="small"
            variant="tonal"
            @click="branchDialog = true"
          >
            {{ locale.t("$vuetify.chatroom.git.branches") }}
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            :loading="busy === 'fetch'"
            @click="remote('fetch')"
            >Fetch</v-btn
          >
          <v-btn
            size="small"
            variant="text"
            :disabled="!status.upstream"
            :loading="busy === 'pull'"
            @click="remote('pull')"
            >Pull</v-btn
          >
          <v-btn
            size="small"
            variant="text"
            :loading="busy === 'push'"
            @click="remote('push')"
            >Push</v-btn
          >
        </div>
      </div>

      <div class="git-section-header">
        <div>
          <strong>{{ locale.t("$vuetify.chatroom.git.changes") }}</strong>
          <span>{{ changes.length }}</span>
        </div>
        <div class="git-section-actions">
          <v-btn
            size="small"
            variant="text"
            :disabled="!unstagedPaths.length"
            :loading="busy === 'stage'"
            @click="stage(unstagedPaths)"
          >
            {{ locale.t("$vuetify.chatroom.git.stageAll") }}
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            :disabled="!stagedPaths.length"
            :loading="busy === 'unstage'"
            @click="unstage(stagedPaths)"
          >
            {{ locale.t("$vuetify.chatroom.git.unstageAll") }}
          </v-btn>
        </div>
      </div>

      <div v-if="changes.length" class="git-workbench">
        <v-list density="compact" class="git-change-list">
          <v-list-item
            v-for="change in changes"
            :key="change.path"
            :active="selectedPath === change.path"
            @click="selectedPath = change.path"
          >
            <template #prepend>
              <span class="git-change-code mono">{{ statusCode(change) }}</span>
            </template>
            <v-list-item-title class="mono">{{
              change.path
            }}</v-list-item-title>
            <v-list-item-subtitle v-if="change.originalPath" class="mono">
              {{ change.originalPath }} → {{ change.path }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>

        <div class="git-diff-pane">
          <template v-if="selectedChange">
            <div class="git-file-toolbar">
              <div class="mono git-selected-path">
                {{ selectedChange.path }}
              </div>
              <div class="git-file-actions">
                <v-btn
                  v-if="isUnstaged(selectedChange)"
                  size="small"
                  variant="text"
                  :loading="busy === 'stage'"
                  @click="stage([selectedChange.path])"
                >
                  {{ locale.t("$vuetify.chatroom.git.stage") }}
                </v-btn>
                <v-btn
                  v-if="isStaged(selectedChange)"
                  size="small"
                  variant="text"
                  :loading="busy === 'unstage'"
                  @click="unstage([selectedChange.path])"
                >
                  {{ locale.t("$vuetify.chatroom.git.unstage") }}
                </v-btn>
                <v-btn
                  color="error"
                  size="small"
                  variant="text"
                  :disabled="
                    !status.head && selectedChange.kind !== 'untracked'
                  "
                  @click="restoreTarget = selectedChange"
                >
                  {{
                    selectedChange.kind === "untracked"
                      ? locale.t("$vuetify.chatroom.git.deleteFile")
                      : locale.t("$vuetify.chatroom.git.restore")
                  }}
                </v-btn>
              </div>
            </div>
            <v-progress-linear v-if="diffLoading" indeterminate />
            <v-alert
              v-if="diff?.truncated"
              type="info"
              variant="tonal"
              density="compact"
            >
              {{ locale.t("$vuetify.chatroom.git.diffTruncated") }}
            </v-alert>
            <GitDiffViewer v-if="diff?.diff" :text="diff.diff" />
            <v-empty-state
              v-else-if="!diffLoading"
              icon="mdi-file-compare"
              :title="
                status.head
                  ? locale.t('$vuetify.chatroom.git.noDiff')
                  : locale.t('$vuetify.chatroom.git.noHead')
              "
            />
          </template>
        </div>
      </div>
      <v-empty-state
        v-else
        icon="mdi-check-circle-outline"
        :title="locale.t('$vuetify.chatroom.git.clean')"
      />

      <div class="git-commit-bar">
        <v-text-field
          v-model="commitMessage"
          :label="locale.t('$vuetify.chatroom.git.commitMessage')"
          density="compact"
          variant="outlined"
          hide-details
          :disabled="!stagedPaths.length"
          @keyup.enter="commit"
        />
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!stagedPaths.length || !commitMessage.trim()"
          :loading="busy === 'commit'"
          @click="commit"
        >
          {{ locale.t("$vuetify.chatroom.git.commit") }}
        </v-btn>
      </div>

      <div class="git-history">
        <div class="git-section-header">
          <strong>{{ locale.t("$vuetify.chatroom.git.recentCommits") }}</strong>
        </div>
        <v-list v-if="commits.length" density="compact">
          <v-list-item v-for="item in commits" :key="item.hash">
            <template #prepend>
              <span class="git-commit-hash mono">{{ item.shortHash }}</span>
            </template>
            <v-list-item-title>{{ item.subject }}</v-list-item-title>
            <v-list-item-subtitle>
              {{ item.author }} ·
              {{
                new Date(item.date).toLocaleString(
                  appIntlLocale(locale.current.value),
                )
              }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
      </div>
    </template>

    <v-dialog v-model="branchDialog" max-width="560">
      <v-card>
        <v-card-title>{{
          locale.t("$vuetify.chatroom.git.branches")
        }}</v-card-title>
        <v-card-text>
          <div class="git-new-branch">
            <v-text-field
              v-model="newBranch"
              :label="locale.t('$vuetify.chatroom.git.newBranch')"
              density="compact"
              variant="outlined"
              hide-details
              @keyup.enter="createBranch"
            />
            <v-btn
              color="primary"
              variant="flat"
              :disabled="!newBranch.trim()"
              :loading="busy === 'branch'"
              @click="createBranch"
            >
              {{ locale.t("$vuetify.chatroom.git.create") }}
            </v-btn>
          </div>
          <v-list class="mt-3" density="compact" border rounded="lg">
            <v-list-item v-for="branch in branches" :key="branch.name">
              <v-list-item-title class="mono">{{
                branch.name
              }}</v-list-item-title>
              <v-list-item-subtitle v-if="branch.upstream" class="mono">
                {{ branch.upstream }}
              </v-list-item-subtitle>
              <template #append>
                <v-chip v-if="branch.current" size="x-small" variant="tonal">
                  {{ locale.t("$vuetify.chatroom.git.current") }}
                </v-chip>
                <template v-else>
                  <v-btn
                    size="x-small"
                    variant="text"
                    @click="switchBranch(branch)"
                  >
                    {{ locale.t("$vuetify.chatroom.git.switch") }}
                  </v-btn>
                  <v-btn
                    icon="mdi-delete-outline"
                    size="x-small"
                    color="error"
                    variant="text"
                    @click="deleteBranchTarget = branch"
                  />
                </template>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="branchDialog = false">
            {{ locale.t("$vuetify.chatroom.common.close") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="restoreTarget !== null" max-width="500">
      <v-card>
        <v-card-title>
          {{
            restoreTarget?.kind === "untracked"
              ? locale.t("$vuetify.chatroom.git.deleteTitle")
              : locale.t("$vuetify.chatroom.git.restoreTitle")
          }}
        </v-card-title>
        <v-card-text>
          {{
            restoreTarget?.kind === "untracked"
              ? locale.t("$vuetify.chatroom.git.deleteDescription")
              : locale.t("$vuetify.chatroom.git.restoreDescription")
          }}
          <div class="mono mt-2">{{ restoreTarget?.path }}</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="restoreTarget = null">
            {{ locale.t("$vuetify.chatroom.common.cancel") }}
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="busy === 'restore'"
            @click="confirmRestore"
          >
            {{ locale.t("$vuetify.chatroom.git.confirm") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="deleteBranchTarget !== null" max-width="460">
      <v-card>
        <v-card-title>{{
          locale.t("$vuetify.chatroom.git.deleteBranchTitle")
        }}</v-card-title>
        <v-card-text>
          {{ locale.t("$vuetify.chatroom.git.deleteBranchDescription") }}
          <div class="mono mt-2">{{ deleteBranchTarget?.name }}</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteBranchTarget = null">
            {{ locale.t("$vuetify.chatroom.common.cancel") }}
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="busy === 'branch'"
            @click="confirmDeleteBranch"
          >
            {{ locale.t("$vuetify.chatroom.git.confirm") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
