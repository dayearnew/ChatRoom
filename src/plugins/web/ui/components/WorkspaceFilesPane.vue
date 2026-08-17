<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import { bytes } from "../utils.js";
import CodeViewer from "./CodeViewer.vue";

interface FileView {
  path: string;
  type: string;
  size: number;
  modifiedAt: string;
}

type FilePreview =
  | { kind: "text"; path: string; content: string }
  | { kind: "image"; path: string; url: string }
  | { kind: "unsupported"; path: string };

const props = defineProps<{
  files: FileView[];
  file: FilePreview | null;
  currentPath: string;
}>();
const emit = defineEmits<{
  open: [entry: FileView];
  navigate: [path: string];
}>();
const locale = useLocale();

const entries = computed(() =>
  [...props.files].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return nameOf(a.path).localeCompare(nameOf(b.path));
  }),
);

const breadcrumbs = computed(() => {
  const parts = props.currentPath === "." ? [] : props.currentPath.split("/");
  return [
    { title: "/", path: "." },
    ...parts.map((part, index) => ({
      title: part,
      path: parts.slice(0, index + 1).join("/"),
    })),
  ];
});

const parentPath = computed(() => {
  if (props.currentPath === ".") return null;
  const parts = props.currentPath.split("/");
  parts.pop();
  return parts.join("/") || ".";
});

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
</script>

<template>
  <div class="workspace-files-layout">
    <div class="workspace-file-browser">
      <div class="workspace-file-breadcrumbs">
        <v-btn
          icon="mdi-arrow-up"
          size="x-small"
          variant="text"
          :disabled="parentPath === null"
          @click="parentPath && emit('navigate', parentPath)"
        />
        <div class="workspace-breadcrumb-items">
          <template v-for="(item, index) in breadcrumbs" :key="item.path">
            <span v-if="index" class="workspace-breadcrumb-separator">/</span>
            <button
              type="button"
              class="workspace-breadcrumb"
              :class="{ active: index === breadcrumbs.length - 1 }"
              @click="emit('navigate', item.path)"
            >
              {{ item.title }}
            </button>
          </template>
        </div>
      </div>

      <v-list density="compact" border rounded="lg" class="workspace-file-list">
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
          @click="emit('open', entry)"
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
</template>
