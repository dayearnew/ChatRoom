<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ text: string }>();

interface DiffRow {
  text: string;
  kind: "meta" | "hunk" | "add" | "delete" | "context";
  oldLine: number | null;
  newLine: number | null;
}

const rows = computed<DiffRow[]>(() => {
  const result: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of props.text.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      result.push({ text: line, kind: "hunk", oldLine: null, newLine: null });
      continue;
    }

    if (
      !inHunk ||
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch") ||
      line.startsWith("\\ No newline")
    ) {
      result.push({ text: line, kind: "meta", oldLine: null, newLine: null });
      continue;
    }

    if (line.startsWith("+")) {
      result.push({ text: line, kind: "add", oldLine: null, newLine });
      newLine += 1;
    } else if (line.startsWith("-")) {
      result.push({ text: line, kind: "delete", oldLine, newLine: null });
      oldLine += 1;
    } else {
      result.push({ text: line, kind: "context", oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return result;
});
</script>

<template>
  <div class="git-diff-viewer">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="git-diff-row"
      :class="`git-diff-row-${row.kind}`"
    >
      <span class="git-diff-line-number">{{ row.oldLine ?? "" }}</span>
      <span class="git-diff-line-number">{{ row.newLine ?? "" }}</span>
      <code class="git-diff-line">{{ row.text }}</code>
    </div>
  </div>
</template>
