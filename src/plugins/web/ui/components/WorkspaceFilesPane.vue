<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import { api, type WorkspaceFile } from "../api.js";
import { bytes } from "../utils.js";
import CodeViewer from "./CodeViewer.vue";

type FilePreview =
  | { kind: "text"; path: string; content: string }
  | { kind: "image"; path: string; url: string }
  | { kind: "unsupported"; path: string };

const props = defineProps<{ root: string }>();
const files = ref<WorkspaceFile[]>([]);
const currentPath = ref(".");
const file = ref<FilePreview | null>(null);
const loading = ref(false);
const error = ref("");
const locale = useLocale();

const entries = computed(() =>
  [...files.value].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return nameOf(a.path).localeCompare(nameOf(b.path));
  }),
);
const breadcrumbs = computed(() => {
  const parts = currentPath.value === "." ? [] : currentPath.value.split("/");
  return [
    { title: "/", path: "." },
    ...parts.map((part, index) => ({
      title: part,
      path: parts.slice(0, index + 1).join("/"),
    })),
  ];
});
const parentPath = computed(() => {
  if (currentPath.value === ".") return null;
  const parts = currentPath.value.split("/");
  parts.pop();
  return parts.join("/") || ".";
});

watch(
  () => props.root,
  () => {
    currentPath.value = ".";
    file.value = null;
    void loadDirectory();
  },
  { immediate: true },
);

async function loadDirectory() {
  loading.value = true;
  error.value = "";
  try {
    files.value = await api<WorkspaceFile[]>(
      `/workspace/files?root=${encodeURIComponent(props.root)}&path=${encodeURIComponent(currentPath.value)}`,
    );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

async function navigate(path: string) {
  currentPath.value = path || ".";
  file.value = null;
  await loadDirectory();
}

async function openEntry(entry: WorkspaceFile) {
  if (entry.type === "directory") {
    await navigate(entry.path);
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
      url: `/api/workspace/file/image?root=${encodeURIComponent(props.root)}&path=${encodeURIComponent(entry.path)}`,
    };
    return;
  }
  if (!isTextFile(entry.path)) {
    file.value = { kind: "unsupported", path: entry.path };
    return;
  }
  try {
    const result = await api<{ content: string }>(
      `/workspace/file?root=${encodeURIComponent(props.root)}&path=${encodeURIComponent(entry.path)}`,
    );
    file.value = { kind: "text", path: entry.path, content: result.content };
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function nameOf(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function typeLabel(type: string): string {
  if (type === "file") return locale.t("$vuetify.chatroom.files.file");
  if (type === "directory")
    return locale.t("$vuetify.chatroom.files.directory");
  if (type === "symlink") return locale.t("$vuetify.chatroom.files.symlink");
  return type;
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
</script>

<template>
  <div class="workspace-files-pane">
    <v-alert v-if="error" type="error" variant="tonal" density="compact">
      {{ error }}
    </v-alert>
    <div class="workspace-files-layout">
      <div class="workspace-file-browser">
        <div class="workspace-file-breadcrumbs">
          <v-btn
            icon="mdi-arrow-up"
            size="x-small"
            variant="text"
            :disabled="parentPath === null"
            @click="parentPath && navigate(parentPath)"
          />
          <div class="workspace-breadcrumb-items">
            <template v-for="(item, index) in breadcrumbs" :key="item.path">
              <span v-if="index" class="workspace-breadcrumb-separator">/</span>
              <button
                type="button"
                class="workspace-breadcrumb"
                :class="{ active: index === breadcrumbs.length - 1 }"
                @click="navigate(item.path)"
              >
                {{ item.title }}
              </button>
            </template>
          </div>
          <v-btn
            icon="mdi-refresh"
            size="x-small"
            variant="text"
            :loading="loading"
            @click="loadDirectory"
          />
        </div>

        <v-list
          density="compact"
          border
          rounded="lg"
          class="workspace-file-list"
        >
          <v-list-item
            v-for="entry in entries.slice(0, 500)"
            :key="entry.path"
            :active="file?.path === entry.path"
            :title="nameOf(entry.path)"
            :subtitle="
              entry.type === 'file'
                ? `${typeLabel(entry.type)} · ${bytes(entry.size)}`
                : typeLabel(entry.type)
            "
            :prepend-icon="
              entry.type === 'directory'
                ? 'mdi-folder-outline'
                : entry.type === 'symlink'
                  ? 'mdi-link-variant'
                  : 'mdi-file-outline'
            "
            :append-icon="
              entry.type === 'directory' ? 'mdi-chevron-right' : undefined
            "
            @click="openEntry(entry)"
          />
        </v-list>
      </div>

      <div class="workspace-file-preview">
        <CodeViewer
          v-if="file?.kind === 'text'"
          :text="file.content"
          :filename="file.path"
        />
        <v-sheet
          v-else-if="file?.kind === 'image'"
          border
          rounded="lg"
          class="workspace-image-preview"
        >
          <div class="workspace-image-header mono">{{ file.path }}</div>
          <v-divider />
          <div class="workspace-image-stage">
            <img :src="file.url" :alt="file.path" />
          </div>
        </v-sheet>
        <v-empty-state
          v-else-if="file?.kind === 'unsupported'"
          icon="mdi-file-question-outline"
          :title="locale.t('$vuetify.chatroom.files.previewUnavailable')"
          :text="file.path"
        />
        <v-empty-state
          v-else
          icon="mdi-file-eye-outline"
          :title="locale.t('$vuetify.chatroom.files.select')"
          :text="locale.t('$vuetify.chatroom.files.readOnly')"
        />
      </div>
    </div>
  </div>
</template>
