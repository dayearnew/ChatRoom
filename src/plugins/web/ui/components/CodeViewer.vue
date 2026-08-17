<script setup lang="ts">
import { computed, ref } from "vue";
import { useLocale } from "vuetify";
import { highlightSource } from "../syntax-highlight.js";

const props = withDefaults(
  defineProps<{
    value?: unknown;
    text?: string;
    filename?: string;
    language?: string;
    toolbar?: boolean;
  }>(),
  {
    filename: "chatroom-output.txt",
    toolbar: true,
  },
);
const query = ref("");
const wrap = ref(true);
const locale = useLocale();
const source = computed(
  () => props.text ?? JSON.stringify(props.value ?? null, null, 2),
);
const display = computed(() => {
  if (!query.value) return source.value;
  return source.value
    .split("\n")
    .filter((line) =>
      line.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()),
    )
    .join("\n");
});
const highlighted = computed(() =>
  highlightSource(display.value, {
    filename: props.filename,
    language: props.language ?? (props.value !== undefined ? "json" : null),
  }),
);

async function copy() {
  await navigator.clipboard.writeText(source.value);
}
function download() {
  const url = URL.createObjectURL(
    new Blob([source.value], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = props.filename;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <v-sheet
    :border="toolbar"
    :rounded="toolbar ? 'lg' : 0"
    overflow-hidden
    class="code-viewer"
    :class="{ 'code-viewer-plain': !toolbar }"
  >
    <template v-if="toolbar">
      <div class="code-toolbar">
        <v-text-field
          v-model="query"
          :placeholder="locale.t('$vuetify.chatroom.code.search')"
          prepend-inner-icon="mdi-magnify"
          density="compact"
          hide-details
          class="code-search"
          max-width="220"
        />
        <v-spacer />
        <div class="code-actions">
          <v-btn
            icon="mdi-content-copy"
            size="small"
            variant="text"
            @click="copy"
          />
          <v-btn
            :icon="wrap ? 'mdi-wrap' : 'mdi-format-align-left'"
            size="small"
            variant="text"
            @click="wrap = !wrap"
          />
          <v-btn
            icon="mdi-download-outline"
            size="small"
            variant="text"
            @click="download"
          />
        </div>
      </div>
      <v-divider />
    </template>
    <pre class="code-block" :class="{ wrap }"><code
      v-if="highlighted"
      class="hljs"
      v-html="highlighted"
    /><code v-else>{{ display || locale.t("$vuetify.chatroom.code.noOutput") }}</code></pre>
  </v-sheet>
</template>
