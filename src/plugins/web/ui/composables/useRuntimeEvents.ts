import { onBeforeUnmount, ref } from "vue";
import { api, type RuntimeStatus, type UpdateStatus } from "../api.js";

type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

type RefreshScope = "processes" | "operations" | "computer";
type RuntimeEvent =
  | { type: "operation"; operation?: { pluginId?: string } }
  | { type: "operations-cleared" }
  | { type: "process" }
  | { type: "process-output" }
  | { type: "computer-settings" };

const EVENT_COALESCE_MS = 100;
const RUNTIME_POLL_MS = 15_000;
const UPDATE_POLL_MS = 60 * 60 * 1000;

export function useRuntimeEvents() {
  const runtime = ref<RuntimeStatus | null>(null);
  const updateStatus = ref<UpdateStatus | null>(null);
  const processRevision = ref(0);
  const operationRevision = ref(0);
  const computerRevision = ref(0);
  const connectionState = ref<ConnectionState>("connecting");
  const latencyMs = ref<number | null>(null);

  let stream: EventSource | null = null;
  let runtimeTimer: ReturnType<typeof setInterval> | null = null;
  let updateTimer: ReturnType<typeof setInterval> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingScopes = new Set<RefreshScope>();

  onBeforeUnmount(stop);

  function start() {
    stop();
    connectionState.value = navigator.onLine ? "connecting" : "offline";
    latencyMs.value = null;
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    connectEvents();
    void loadRuntimeStatus().then(() => void loadUpdateStatus());
    runtimeTimer = setInterval(() => void loadRuntimeStatus(), RUNTIME_POLL_MS);
    updateTimer = setInterval(() => void loadUpdateStatus(), UPDATE_POLL_MS);
  }

  function stop() {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    stream?.close();
    stream = null;
    if (runtimeTimer) clearInterval(runtimeTimer);
    if (updateTimer) clearInterval(updateTimer);
    if (flushTimer) clearTimeout(flushTimer);
    runtimeTimer = null;
    updateTimer = null;
    flushTimer = null;
    pendingScopes.clear();
  }

  function clear() {
    stop();
    runtime.value = null;
    updateStatus.value = null;
    connectionState.value = "offline";
    latencyMs.value = null;
  }

  function connectEvents() {
    stream = new EventSource("/api/events");
    stream.addEventListener("open", () => {
      connectionState.value = "connected";
    });
    stream.addEventListener("error", () => {
      connectionState.value = navigator.onLine ? "reconnecting" : "offline";
      latencyMs.value = null;
    });
    stream.addEventListener("runtime", (message) => {
      const event = parseRuntimeEvent(message);
      if (!event) return;
      switch (event.type) {
        case "process":
        case "process-output":
          scheduleRefresh("processes");
          break;
        case "operation":
          scheduleRefresh("operations");
          if (event.operation?.pluginId === "computer")
            scheduleRefresh("computer");
          break;
        case "operations-cleared":
          scheduleRefresh("operations");
          break;
        case "computer-settings":
          scheduleRefresh("computer");
          break;
      }
    });
  }

  function scheduleRefresh(scope: RefreshScope) {
    pendingScopes.add(scope);
    if (flushTimer) return;
    flushTimer = setTimeout(flushRefreshes, EVENT_COALESCE_MS);
  }

  function flushRefreshes() {
    flushTimer = null;
    if (pendingScopes.delete("processes")) processRevision.value += 1;
    if (pendingScopes.delete("operations")) operationRevision.value += 1;
    if (pendingScopes.delete("computer")) computerRevision.value += 1;
  }

  async function loadRuntimeStatus() {
    const startedAt = performance.now();
    try {
      runtime.value = await api<RuntimeStatus>("/runtime");
      latencyMs.value = Math.max(0, Math.round(performance.now() - startedAt));
    } catch {
      latencyMs.value = null;
      // Polling is best-effort; EventSource owns connection state.
      if (!navigator.onLine) connectionState.value = "offline";
    }
  }

  function handleOnline() {
    connectionState.value = "reconnecting";
    latencyMs.value = null;
    stream?.close();
    stream = null;
    connectEvents();
    void loadRuntimeStatus();
  }

  function handleOffline() {
    connectionState.value = "offline";
    latencyMs.value = null;
  }

  async function loadUpdateStatus() {
    if (!runtime.value?.version) await loadRuntimeStatus();
    const currentVersion = runtime.value?.version;
    if (!currentVersion) return;
    try {
      const response = await fetch(
        "https://api.github.com/repos/dayearnew/ChatRoom/releases/latest",
        {
          headers: { accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) return;
      const release = (await response.json()) as {
        tag_name?: unknown;
        html_url?: unknown;
      };
      if (typeof release.tag_name !== "string") return;
      const latestVersion = normalizeVersion(release.tag_name);
      updateStatus.value = {
        latestVersion,
        updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
        releaseUrl:
          typeof release.html_url === "string" ? release.html_url : null,
      };
    } catch {
      // Update checks are best-effort; preserve the last successful result.
    }
  }

  return {
    runtime,
    updateStatus,
    processRevision,
    operationRevision,
    computerRevision,
    connectionState,
    latencyMs,
    start,
    clear,
  };
}

function parseRuntimeEvent(message: Event): RuntimeEvent | null {
  if (!(message instanceof MessageEvent) || typeof message.data !== "string")
    return null;
  try {
    const value = JSON.parse(message.data) as { type?: unknown };
    return typeof value?.type === "string" ? (value as RuntimeEvent) : null;
  } catch {
    return null;
  }
}

function normalizeVersion(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = a.core[index]! - b.core[index]!;
    if (difference) return Math.sign(difference);
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function parseVersion(
  value: string,
): { core: [number, number, number]; prerelease: string | null } | null {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value.trim(),
    );
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}
