<script setup lang="ts">
import { ref, watch } from "vue";
import { useLocale } from "vuetify";
import { api, type WorkspaceInfo, type WorkspaceSkill } from "../api.js";

const props = defineProps<{ root: string }>();
const info = ref<WorkspaceInfo | null>(null);
const loading = ref(false);
const error = ref("");
const locale = useLocale();

watch(
  () => props.root,
  () => void load(),
  { immediate: true },
);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    info.value = await api<WorkspaceInfo>(
      `/workspace?root=${encodeURIComponent(props.root)}`,
    );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

function sourceLabel(skill: WorkspaceSkill): string {
  if (skill.path.startsWith(".claude/skills/")) return "Claude";
  if (skill.path.startsWith(".chatroom/skills/")) return "ChatRoom";
  return "Agent";
}
</script>

<template>
  <div class="workspace-skills-pane">
    <v-progress-linear v-if="loading" indeterminate />
    <v-alert v-if="error" type="error" variant="tonal" density="compact">
      {{ error }}
    </v-alert>
    <div v-if="info?.skills.length" class="workspace-skill-grid">
      <div
        v-for="skill in info.skills"
        :key="skill.path"
        class="workspace-skill-card"
      >
        <div class="workspace-skill-header">
          <div class="workspace-skill-title">
            <v-icon icon="mdi-puzzle-outline" size="18" />
            <strong>{{ skill.name }}</strong>
          </div>
          <v-chip size="x-small" variant="tonal">
            {{ sourceLabel(skill) }}
          </v-chip>
        </div>
        <div class="workspace-skill-description">
          {{
            skill.description ||
            locale.t("$vuetify.chatroom.skills.noDescription")
          }}
        </div>
        <div class="workspace-skill-path">{{ skill.path }}</div>
      </div>
    </div>
    <v-empty-state
      v-else-if="!loading && !error"
      icon="mdi-puzzle-outline"
      :title="locale.t('$vuetify.chatroom.skills.empty')"
    />
  </div>
</template>
