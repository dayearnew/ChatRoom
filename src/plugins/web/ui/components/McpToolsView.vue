<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useLocale } from "vuetify";
import { api, type McpToolSummary } from "../api.js";
import { errorMessage } from "../utils/errors.js";
import { createRequestGate } from "../utils/requests.js";

interface ToolGroup {
  pluginId: string;
  tools: McpToolSummary[];
}

const locale = useLocale();
const tools = ref<McpToolSummary[]>([]);
const loading = ref(false);
const error = ref("");
const busy = reactive(new Set<string>());
const loadRequests = createRequestGate();

const groups = computed<ToolGroup[]>(() => {
  const grouped = new Map<string, McpToolSummary[]>();
  for (const tool of tools.value) {
    const items = grouped.get(tool.pluginId) ?? [];
    items.push(tool);
    grouped.set(tool.pluginId, items);
  }
  return [...grouped.entries()].map(([pluginId, items]) => ({
    pluginId,
    tools: items,
  }));
});

onMounted(() => void load());

async function load() {
  const request = loadRequests.begin();
  loading.value = true;
  error.value = "";
  try {
    const next = await api<McpToolSummary[]>("/mcp/tools", {
      signal: request.signal,
    });
    if (loadRequests.isCurrent(request)) tools.value = next;
  } catch (cause) {
    if (loadRequests.isCurrent(request)) error.value = errorMessage(cause);
  } finally {
    if (loadRequests.isCurrent(request)) loading.value = false;
  }
}

async function setEnabled(tool: McpToolSummary, enabled: boolean) {
  if (busy.has(tool.name) || tool.enabled === enabled) return;
  busy.add(tool.name);
  error.value = "";
  try {
    const updated = await api<McpToolSummary>(
      `/mcp/tools/${encodeURIComponent(tool.name)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      },
    );
    const index = tools.value.findIndex((item) => item.name === updated.name);
    if (index >= 0) tools.value[index] = updated;
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.delete(tool.name);
  }
}

async function setGroupEnabled(group: ToolGroup, enabled: boolean) {
  const pending = group.tools.filter(
    (tool) => tool.enabled !== enabled && !busy.has(tool.name),
  );
  await Promise.all(pending.map((tool) => setEnabled(tool, enabled)));
}

function pluginLabel(pluginId: string): string {
  const known = ["workspace", "process", "computer"] as const;
  if ((known as readonly string[]).includes(pluginId))
    return locale.t(`$vuetify.chatroom.mcpTools.plugins.${pluginId}`);
  return pluginId;
}

function someEnabled(group: ToolGroup): boolean {
  return group.tools.some((tool) => tool.enabled);
}

function allEnabled(group: ToolGroup): boolean {
  return group.tools.every((tool) => tool.enabled);
}
</script>

<template>
  <div class="mcp-tools-view">
    <v-alert v-if="error" type="error" variant="tonal" density="compact">
      {{ error }}
    </v-alert>

    <v-card class="panel-card">
      <div class="panel-header">
        <div>
          <div class="panel-title">
            {{ locale.t("$vuetify.chatroom.mcpTools.title") }}
          </div>
        </div>
        <v-btn
          class="mcp-tools-refresh"
          icon="$mdiRefresh"
          size="small"
          variant="text"
          :loading="loading"
          :aria-label="locale.t('$vuetify.chatroom.mcpTools.refresh')"
          @click="load"
        />
      </div>
    </v-card>

    <v-progress-linear v-if="loading && !tools.length" indeterminate rounded />

    <v-card
      v-for="group in groups"
      :key="group.pluginId"
      class="panel-card mcp-tool-group"
    >
      <div class="mcp-tool-group-header">
        <div class="min-w-0">
          <div class="panel-title">{{ pluginLabel(group.pluginId) }}</div>
        </div>
        <v-switch
          class="mcp-tool-switch"
          :model-value="allEnabled(group)"
          :indeterminate="someEnabled(group) && !allEnabled(group)"
          color="primary"
          density="compact"
          hide-details
          inset
          :disabled="group.tools.some((tool) => busy.has(tool.name))"
          :aria-label="
            locale.t(
              '$vuetify.chatroom.mcpTools.togglePlugin',
              pluginLabel(group.pluginId),
            )
          "
          @update:model-value="setGroupEnabled(group, Boolean($event))"
        />
      </div>
      <v-divider />

      <div class="mcp-tool-list">
        <div v-for="tool in group.tools" :key="tool.name" class="mcp-tool-row">
          <div class="mcp-tool-copy" :title="tool.description">
            <div class="mcp-tool-heading">
              <strong>{{ tool.title }}</strong>
              <code>{{ tool.name }}</code>
            </div>
          </div>
          <v-switch
            class="mcp-tool-switch"
            :model-value="tool.enabled"
            color="primary"
            density="compact"
            hide-details
            inset
            :loading="busy.has(tool.name)"
            :aria-label="tool.name"
            @update:model-value="setEnabled(tool, Boolean($event))"
          />
        </div>
      </div>
    </v-card>

    <v-card v-if="!loading && !tools.length" class="panel-card">
      <div class="empty-inline">
        {{ locale.t("$vuetify.chatroom.mcpTools.empty") }}
      </div>
    </v-card>
  </div>
</template>

<style scoped>
.mcp-tools-view {
  display: grid;
  gap: 14px;
}

.mcp-tools-refresh {
  flex: 0 0 auto;
}

.mcp-tool-group-header,
.mcp-tool-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px;
  align-items: center;
  column-gap: 18px;
}

.mcp-tool-group-header {
  min-height: 56px;
  padding: 10px 18px;
}

.mcp-tool-list {
  display: grid;
}

.mcp-tool-row {
  min-width: 0;
  min-height: 54px;
  padding: 8px 18px;
  border-bottom: 1px solid rgb(var(--v-theme-outline), 0.08);
}

.mcp-tool-row:last-child {
  border-bottom: 0;
}

.mcp-tool-copy {
  width: 100%;
  min-width: 0;
}

.mcp-tool-heading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 12px;
}

.mcp-tool-heading strong,
.mcp-tool-heading code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-tool-heading strong {
  flex: 0 1 auto;
  font-size: 13px;
  font-weight: 650;
}

.mcp-tool-heading code {
  flex: 1 1 0;
  color: rgb(var(--v-theme-on-surface), 0.52);
  font-size: 11px;
}

.mcp-tool-switch {
  width: 52px;
  min-width: 52px;
  max-width: 52px;
  justify-self: end;
}

.mcp-tool-switch :deep(.v-input__control),
.mcp-tool-switch :deep(.v-selection-control) {
  width: 52px;
  min-width: 52px;
  max-width: 52px;
}

.mcp-tool-switch :deep(.v-selection-control) {
  flex: 0 0 52px;
}

@media (max-width: 640px) {
  .mcp-tools-view {
    gap: 12px;
  }

  .mcp-tool-group-header,
  .mcp-tool-row {
    column-gap: 10px;
    padding-inline: 14px;
  }

  .mcp-tool-group-header {
    min-height: 54px;
  }

  .mcp-tool-row {
    min-height: 52px;
    padding-block: 7px;
  }

  .mcp-tool-heading {
    gap: 8px;
  }
}

@media (max-width: 380px) {
  .mcp-tool-group-header,
  .mcp-tool-row {
    column-gap: 8px;
    padding-inline: 12px;
  }

  .mcp-tool-heading {
    gap: 6px;
  }
}
</style>
