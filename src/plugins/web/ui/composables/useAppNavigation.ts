import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  type Component,
} from "vue";

export type View =
  | "workspaces"
  | "processes"
  | "computer"
  | "tools"
  | "cloud"
  | "operations"
  | "systemLogs";

interface ViewDefinition {
  id: View;
  path: string;
  titleKey: string;
  icon: string;
  component: Component;
}

const definitions: readonly ViewDefinition[] = [
  {
    id: "workspaces",
    path: "/",
    titleKey: "nav.workspaces",
    icon: "$mdiFolderOutline",
    component: defineAsyncComponent(
      () => import("../components/WorkspacesView.vue"),
    ),
  },
  {
    id: "processes",
    path: "/processes",
    titleKey: "nav.processes",
    icon: "$mdiConsoleLine",
    component: defineAsyncComponent(
      () => import("../components/ProcessesView.vue"),
    ),
  },
  {
    id: "computer",
    path: "/computer",
    titleKey: "nav.computer",
    icon: "$mdiMonitor",
    component: defineAsyncComponent(
      () => import("../components/ComputerView.vue"),
    ),
  },
  {
    id: "tools",
    path: "/tools",
    titleKey: "nav.mcpTools",
    icon: "$mdiTuneVariant",
    component: defineAsyncComponent(
      () => import("../components/McpToolsView.vue"),
    ),
  },
  {
    id: "cloud",
    path: "/cloud",
    titleKey: "nav.cloud",
    icon: "$mdiCloudOutline",
    component: defineAsyncComponent(
      () => import("../components/CloudView.vue"),
    ),
  },
  {
    id: "operations",
    path: "/operations",
    titleKey: "nav.operations",
    icon: "$mdiTextBoxOutline",
    component: defineAsyncComponent(
      () => import("../components/OperationsView.vue"),
    ),
  },
  {
    id: "systemLogs",
    path: "/system-logs",
    titleKey: "nav.systemLogs",
    icon: "$mdiTextSearch",
    component: defineAsyncComponent(
      () => import("../components/SystemLogsView.vue"),
    ),
  },
] as const;

const byId = new Map(definitions.map((item) => [item.id, item]));
const byPath = new Map(definitions.map((item) => [item.path, item.id]));

export function useAppNavigation() {
  const view = ref<View>(viewFromPath());
  const current = computed(() => byId.get(view.value)!);

  onMounted(() => {
    syncFromPath();
    window.addEventListener("popstate", syncFromPath);
  });
  onBeforeUnmount(() => window.removeEventListener("popstate", syncFromPath));

  function navigate(next: View) {
    view.value = next;
    const path = byId.get(next)!.path;
    if (window.location.pathname !== path)
      window.history.pushState(null, "", path);
  }

  function reset() {
    view.value = "workspaces";
    window.history.replaceState(null, "", "/");
  }

  function syncFromPath() {
    const resolved = byPath.get(window.location.pathname);
    if (!resolved) {
      view.value = "workspaces";
      window.history.replaceState(null, "", "/");
      return;
    }
    view.value = resolved;
  }

  return { view, current, definitions, navigate, reset };
}

function viewFromPath(): View {
  return byPath.get(window.location.pathname) ?? "workspaces";
}
