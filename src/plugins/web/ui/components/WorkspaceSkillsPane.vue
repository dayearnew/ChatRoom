<script setup lang="ts">
// Presents the skills discovered from the workspace's explicit skill capability roots.
import { useLocale } from "vuetify";
defineProps<{ skills: string[] }>();
const locale = useLocale();
</script>
<template>
  <div class="pa-4 d-flex flex-wrap ga-2">
    <v-chip
      v-for="skill in skills"
      :key="skill"
      prepend-icon="mdi-puzzle-outline"
      >{{ skill }}</v-chip
    ><span v-if="!skills.length" class="text-body-2 muted">{{
      locale.t("$vuetify.chatroom.skills.empty")
    }}</span>
  </div>
</template>
