<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";

const props = defineProps<{
  roots: string[];
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ create: [parent: string, name: string] }>();
const open = defineModel<boolean>({ required: true });
const name = ref("");
const parent = ref("");
const locale = useLocale();

watch(
  () => [open.value, props.roots] as const,
  () => {
    if (!open.value) return;
    if (!props.roots.includes(parent.value))
      parent.value = props.roots[0] ?? "";
  },
  { immediate: true, deep: true },
);
watch(open, (value) => {
  if (value) name.value = "";
});

const targetPath = computed(() => {
  const base = parent.value.replace(/[\\/]+$/, "");
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return name.value.trim() ? `${base}${separator}${name.value.trim()}` : base;
});

function submit() {
  if (!parent.value || !name.value.trim()) return;
  emit("create", parent.value, name.value.trim());
}
</script>

<template>
  <v-dialog v-model="open" max-width="560">
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ locale.t("$vuetify.chatroom.workspaces.createTitle") }}</span>
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          @click="open = false"
        />
      </v-card-title>
      <v-divider />
      <v-card-text class="workspace-create-form">
        <v-text-field
          v-model="name"
          :label="locale.t('$vuetify.chatroom.workspaces.projectName')"
          autofocus
          hide-details="auto"
          @keyup.enter="submit"
        />
        <v-select
          v-if="roots.length > 1"
          v-model="parent"
          :items="roots"
          :label="locale.t('$vuetify.chatroom.workspaces.createLocation')"
          hide-details="auto"
        />
        <div v-else-if="parent" class="workspace-create-location">
          <span>{{
            locale.t("$vuetify.chatroom.workspaces.createLocation")
          }}</span>
          <code>{{ parent }}</code>
        </div>
        <div v-if="parent" class="workspace-create-location">
          <span>{{
            locale.t("$vuetify.chatroom.workspaces.projectPath")
          }}</span>
          <code>{{ targetPath }}</code>
        </div>
        <v-alert v-if="error" type="error" variant="tonal" density="compact">
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-divider />
      <v-card-actions class="justify-end">
        <v-btn variant="text" @click="open = false">
          {{ locale.t("$vuetify.chatroom.workspaces.cancel") }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="busy"
          :disabled="!parent || !name.trim()"
          @click="submit"
        >
          {{ locale.t("$vuetify.chatroom.workspaces.create") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
