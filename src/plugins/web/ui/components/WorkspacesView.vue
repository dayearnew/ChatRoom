<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import { api, type Workspace } from "../api.js";
import { appIntlLocale } from "../locales.js";
import { basename } from "../utils.js";
import WorkspaceDiffPane from "./WorkspaceDiffPane.vue";
import WorkspaceFilesPane from "./WorkspaceFilesPane.vue";
import WorkspaceSkillsPane from "./WorkspaceSkillsPane.vue";

interface FileView {
  path: string;
  type: string;
  size: number;
  modifiedAt: string;
}

interface WorkspaceProject {
  root: string;
  checkout: Workspace | null;
  worktrees: Workspace[];
}

const props = defineProps<{ revision: number }>();
const items = ref<Workspace[]>([]);
const selectedProjectRoot = ref<string | null>(null);
const selectedWorktreeId = ref<string | null>(null);
const detail = ref<Workspace | null>(null);
const tab = ref("files");
const files = ref<FileView[]>([]);
const currentPath = ref(".");
const file = ref<
  | { kind: "text"; path: string; content: string }
  | { kind: "image"; path: string; url: string }
  | { kind: "unsupported"; path: string }
  | null
>(null);
const locale = useLocale();

const projects = computed<WorkspaceProject[]>(() => {
  const grouped = new Map<string, WorkspaceProject>();
  for (const workspace of items.value) {
    let project = grouped.get(workspace.sourceRoot);
    if (!project) {
      project = { root: workspace.sourceRoot, checkout: null, worktrees: [] };
      grouped.set(workspace.sourceRoot, project);
    }
    if (workspace.mode === "checkout") project.checkout = workspace;
    else project.worktrees.push(workspace);
  }
  return [...grouped.values()]
    .map((project) => ({
      ...project,
      worktrees: [...project.worktrees].sort((a, b) =>
        b.lastUsedAt.localeCompare(a.lastUsedAt),
      ),
    }))
    .sort((a, b) => projectLastUsedAt(b).localeCompare(projectLastUsedAt(a)));
});

const selectedProject = computed(
  () =>
    projects.value.find(
      (project) => project.root === selectedProjectRoot.value,
    ) ?? null,
);

const selected = computed<string | null>(() => {
  const project = selectedProject.value;
  if (!project) return null;
  if (
    selectedWorktreeId.value &&
    project.worktrees.some(
      (worktree) => worktree.id === selectedWorktreeId.value,
    )
  ) {
    return selectedWorktreeId.value;
  }
  return project.checkout?.id ?? project.worktrees[0]?.id ?? null;
});

const worktreeOptions = computed(() => [
  { title: locale.t("$vuetify.chatroom.workspaces.checkout"), value: null },
  ...(selectedProject.value?.worktrees ?? []).map((worktree) => ({
    title: worktreeTitle(worktree),
    value: worktree.id,
  })),
]);

watch(
  () => props.revision,
  () => void load(),
  { immediate: true },
);
watch(selectedProjectRoot, () => {
  if (
    selectedWorktreeId.value &&
    !selectedProject.value?.worktrees.some(
      (worktree) => worktree.id === selectedWorktreeId.value,
    )
  ) {
    selectedWorktreeId.value = null;
  }
});
watch(selected, () => {
  currentPath.value = ".";
  void loadWorkspace();
});
watch(tab, () => void loadActiveTab());

async function load() {
  const activeId = selected.value;
  items.value = await api<Workspace[]>("/workspaces");
  const active = activeId
    ? items.value.find((workspace) => workspace.id === activeId)
    : null;
  if (active) {
    selectedProjectRoot.value = active.sourceRoot;
    selectedWorktreeId.value = active.mode === "worktree" ? active.id : null;
  } else if (!selectedProject.value) {
    selectedProjectRoot.value = projects.value[0]?.root ?? null;
    selectedWorktreeId.value = null;
  } else if (
    selectedWorktreeId.value &&
    !selectedProject.value.worktrees.some(
      (worktree) => worktree.id === selectedWorktreeId.value,
    )
  ) {
    selectedWorktreeId.value = null;
  }

  if (selected.value && selected.value === activeId) await loadWorkspace();
}

async function loadWorkspace() {
  if (!selected.value) return;
  const id = selected.value;
  file.value = null;
  detail.value = await api<Workspace>(`/workspaces/${id}`);

  if (tab.value === "skills" && !detail.value.skills.length)
    tab.value = "files";
  if (tab.value === "diff" && detail.value.mode !== "worktree")
    tab.value = "files";
  await loadActiveTab();
}

async function loadActiveTab() {
  if (!selected.value || !detail.value) return;
  const id = selected.value;

  if (tab.value === "files") {
    files.value = await api<FileView[]>(
      `/workspaces/${id}/files?path=${encodeURIComponent(currentPath.value)}`,
    );
  }
}

async function browseWorkspaceDirectory(path: string) {
  currentPath.value = path || ".";
  file.value = null;
  await loadActiveTab();
}

async function openWorkspaceEntry(entry: FileView) {
  if (!selected.value) return;
  if (entry.type === "directory") {
    await browseWorkspaceDirectory(entry.path);
    return;
  }
  if (entry.type !== "file") {
    file.value = { kind: "unsupported", path: entry.path };
    return;
  }
  if (isImageFile(entry.path)) {
    file.value = {
      kind: "image",
      path: entry.path,
      url: `/api/workspaces/${selected.value}/file/image?path=${encodeURIComponent(entry.path)}`,
    };
    return;
  }
  if (!isTextFile(entry.path)) {
    file.value = { kind: "unsupported", path: entry.path };
    return;
  }
  const result = await api<{ content: string }>(
    `/workspaces/${selected.value}/file?path=${encodeURIComponent(entry.path)}`,
  );
  file.value = { kind: "text", path: entry.path, content: result.content };
}

function isImageFile(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(filePath);
}

function isTextFile(filePath: string): boolean {
  const base = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (
    [
      "dockerfile",
      "makefile",
      "license",
      "readme",
      ".gitignore",
      ".gitattributes",
      ".editorconfig",
      ".env",
    ].includes(base)
  )
    return true;
  return /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|conf|config|xml|html?|css|scss|less|vue|[cm]?[jt]sx?|py|rs|go|java|kt|kts|c|cc|cpp|cxx|h|hpp|sh|bash|zsh|fish|ps1|sql|graphql|gql|proto|diff|patch|csv|tsv|log)$/i.test(
    filePath,
  );
}

function displayPath(workspace: Workspace): string {
  return workspace.mode === "worktree" ? workspace.sourceRoot : workspace.root;
}

function worktreeTitle(workspace: Workspace): string {
  const shortId = workspace.id.replace(/^ws_/, "").slice(0, 8);
  return `${locale.t("$vuetify.chatroom.workspaces.worktree")} ${shortId}`;
}

function projectLastUsedAt(project: WorkspaceProject): string {
  return [project.checkout, ...project.worktrees]
    .filter((workspace): workspace is Workspace => Boolean(workspace))
    .reduce(
      (latest, workspace) =>
        workspace.lastUsedAt > latest ? workspace.lastUsedAt : latest,
      "",
    );
}
</script>

<template>
  <div class="workspace-layout">
    <v-card v-if="detail" class="workspace-detail panel-card">
      <div class="workspace-header">
        <div class="workspace-identity min-w-0">
          <div class="workspace-selector-row">
            <v-select
              v-if="projects.length > 1"
              v-model="selectedProjectRoot"
              :items="
                projects.map((project) => ({
                  title: basename(project.root),
                  value: project.root,
                }))
              "
              density="compact"
              variant="outlined"
              hide-details
              prepend-inner-icon="mdi-folder-outline"
              class="workspace-switcher"
            />
            <div v-else class="workspace-name">
              <v-icon icon="mdi-folder-outline" size="18" class="mr-2" />
              {{ basename(selectedProject?.root ?? displayPath(detail)) }}
            </div>
            <v-select
              v-if="selectedProject?.worktrees.length"
              v-model="selectedWorktreeId"
              :items="worktreeOptions"
              density="compact"
              variant="outlined"
              hide-details
              prepend-inner-icon="mdi-source-fork"
              class="workspace-context-switcher"
            />
          </div>
          <div class="workspace-path">
            {{ selectedProject?.root ?? displayPath(detail) }}
          </div>
        </div>
        <div class="workspace-header-chips d-flex ga-2 align-center">
          <v-chip
            v-if="detail.capabilities.git && detail.git?.branch"
            prepend-icon="mdi-source-branch"
          >
            {{ detail.git.branch }}
          </v-chip>
          <v-chip
            v-if="detail.mode === 'worktree'"
            prepend-icon="mdi-source-fork"
          >
            {{ locale.t("$vuetify.chatroom.workspaces.isolatedWorktree") }}
          </v-chip>
        </div>
      </div>

      <div class="workspace-summary">
        <div class="summary-item">
          <span>{{
            locale.t("$vuetify.chatroom.workspaces.lastActivity")
          }}</span>
          <strong>{{
            new Date(detail.lastUsedAt).toLocaleString(
              appIntlLocale(locale.current.value),
            )
          }}</strong>
        </div>
        <div v-if="detail.capabilities.git" class="summary-item">
          <span>{{ locale.t("$vuetify.chatroom.workspaces.git") }}</span>
          <strong>{{
            detail.git?.dirty
              ? locale.t("$vuetify.chatroom.workspaces.dirty")
              : locale.t("$vuetify.chatroom.workspaces.clean")
          }}</strong>
        </div>
      </div>

      <v-tabs v-model="tab" density="compact" class="workspace-tabs">
        <v-tab
          v-if="detail.mode === 'worktree' && detail.capabilities.git"
          value="diff"
        >
          {{ locale.t("$vuetify.chatroom.workspaces.diff") }}
        </v-tab>
        <v-tab value="files">{{
          locale.t("$vuetify.chatroom.workspaces.files")
        }}</v-tab>
        <v-tab v-if="detail.skills.length" value="skills">{{
          locale.t("$vuetify.chatroom.workspaces.skills")
        }}</v-tab>
      </v-tabs>
      <v-divider />

      <v-window v-model="tab">
        <v-window-item
          v-if="detail.mode === 'worktree' && detail.capabilities.git"
          value="diff"
        >
          <WorkspaceDiffPane
            :workspace-id="detail.id"
            :revision="revision"
            @applied="loadWorkspace"
          />
        </v-window-item>

        <v-window-item value="files">
          <WorkspaceFilesPane
            :files="files"
            :file="file"
            :current-path="currentPath"
            @open="openWorkspaceEntry"
            @navigate="browseWorkspaceDirectory"
          />
        </v-window-item>

        <v-window-item v-if="detail.skills.length" value="skills">
          <WorkspaceSkillsPane :skills="detail.skills" />
        </v-window-item>
      </v-window>
    </v-card>

    <v-card v-else class="workspace-detail panel-card">
      <div class="empty-panel">
        {{ locale.t("$vuetify.chatroom.workspaces.select") }}
      </div>
    </v-card>
  </div>
</template>
