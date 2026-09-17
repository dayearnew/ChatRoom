<script setup lang="ts">
import { ref } from "vue";
import { useLocale } from "vuetify";
import type { GitBranch, GitChange } from "../api.js";
import { useWorkspaceGit } from "../composables/useWorkspaceGit.js";
import { appIntlLocale } from "../locales.js";
import GitDiffViewer from "./GitDiffViewer.vue";

const props = defineProps<{ root: string }>();
const locale = useLocale();
const git = useWorkspaceGit(() => props.root);
const {
  status,
  branches,
  commits,
  selectedPath,
  diff,
  loading,
  diffLoading,
  busy,
  error,
  changes,
  selectedChange,
  stagedPaths,
  unstagedPaths,
  load,
  stage,
  unstage,
  restore,
  commit: commitGit,
  createBranch: createGitBranch,
  switchBranch: switchGitBranch,
  deleteBranch,
  remote,
  isStaged,
  isUnstaged,
  statusCode,
} = git;

const commitMessage = ref("");
const branchDialog = ref(false);
const newBranch = ref("");
const restoreTarget = ref<GitChange | null>(null);
const deleteBranchTarget = ref<GitBranch | null>(null);

async function confirmRestore() {
  const target = restoreTarget.value;
  if (target && (await restore(target.path))) restoreTarget.value = null;
}

async function commit() {
  const message = commitMessage.value.trim();
  if (message && (await commitGit(message))) commitMessage.value = "";
}

async function createBranch() {
  const name = newBranch.value.trim();
  if (!name) return;
  if (await createGitBranch(name)) {
    newBranch.value = "";
    branchDialog.value = false;
  }
}

async function switchBranch(branch: GitBranch) {
  if (branch.current) return;
  if (await switchGitBranch(branch.name)) branchDialog.value = false;
}

async function confirmDeleteBranch() {
  const branch = deleteBranchTarget.value;
  if (branch && (await deleteBranch(branch.name)))
    deleteBranchTarget.value = null;
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
      icon="$mdiSourceBranch"
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
            icon="$mdiRefresh"
            size="small"
            variant="text"
            :loading="loading"
            :aria-label="locale.t('$vuetify.chatroom.git.refresh')"
            @click="load"
          />
          <v-btn
            prepend-icon="$mdiSourceBranch"
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
            >{{ locale.t("$vuetify.chatroom.git.fetch") }}</v-btn
          >
          <v-btn
            size="small"
            variant="text"
            :disabled="!status.upstream"
            :loading="busy === 'pull'"
            @click="remote('pull')"
            >{{ locale.t("$vuetify.chatroom.git.pull") }}</v-btn
          >
          <v-btn
            size="small"
            variant="text"
            :loading="busy === 'push'"
            @click="remote('push')"
            >{{ locale.t("$vuetify.chatroom.git.push") }}</v-btn
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
              icon="$mdiFileCompare"
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
        icon="$mdiCheckCircleOutline"
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
                    icon="$mdiDeleteOutline"
                    size="x-small"
                    color="error"
                    variant="text"
                    :aria-label="locale.t('$vuetify.chatroom.git.deleteBranch')"
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
