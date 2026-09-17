import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ApiError,
  api,
  type ComputerPermission,
  type ComputerPreviewView,
  type ComputerStatus,
  type Operation,
} from "../api.js";
import { errorMessage } from "../utils/errors.js";
import { createRequestGate } from "../utils/requests.js";

type ComputerSettingKey = "enabled" | "remoteAccess";

export function useComputer(revision: () => number) {
  const status = ref<ComputerStatus | null>(null);
  const preview = ref<ComputerPreviewView | null>(null);
  const operations = ref<Operation[]>([]);
  const error = ref("");
  const remotePreviewBlocked = ref(false);
  const snapshotBusy = ref(false);
  const settingsBusy = ref(false);
  const operationsBusy = ref(false);
  const permissionBusy = ref<ComputerPermission | null>(null);
  const statusRequests = createRequestGate();
  const previewRequests = createRequestGate();
  const operationRequests = createRequestGate();

  const permissionRequestsAllowed = computed(() =>
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      window.location.hostname,
    ),
  );

  watch(revision, () => void load());

  onMounted(() => {
    window.addEventListener("focus", refreshPermissionStatus);
    void load();
  });

  onBeforeUnmount(() => {
    window.removeEventListener("focus", refreshPermissionStatus);
  });

  async function load(): Promise<void> {
    error.value = "";
    await Promise.all([loadStatus(), loadOperations(), loadPreview()]);
  }

  async function loadStatus(): Promise<void> {
    const request = statusRequests.begin();
    try {
      const next = await api<ComputerStatus>("/computer/status", {
        signal: request.signal,
      });
      if (statusRequests.isCurrent(request)) status.value = next;
    } catch (cause) {
      if (statusRequests.isCurrent(request)) captureError(cause);
    }
  }

  async function loadOperations(): Promise<void> {
    const request = operationRequests.begin();
    try {
      const next = await api<Operation[]>(
        "/operations?pluginId=computer&limit=50",
        { signal: request.signal },
      );
      if (operationRequests.isCurrent(request)) operations.value = next;
    } catch (cause) {
      if (operationRequests.isCurrent(request)) captureError(cause);
    }
  }

  async function loadPreview(): Promise<void> {
    const request = previewRequests.begin();
    remotePreviewBlocked.value = false;
    try {
      const next = await api<ComputerPreviewView | null>("/computer/preview", {
        signal: request.signal,
      });
      if (previewRequests.isCurrent(request)) preview.value = next;
    } catch (cause) {
      if (!previewRequests.isCurrent(request)) return;
      if (isRemotePreviewBlocked(cause)) {
        preview.value = null;
        remotePreviewBlocked.value = true;
        return;
      }
      captureError(cause);
    }
  }

  async function refreshPermissionStatus(): Promise<void> {
    if (
      status.value?.platform !== "macos" ||
      (status.value.permissions.accessibility === "granted" &&
        status.value.permissions.screenRecording === "granted")
    )
      return;
    const request = statusRequests.begin();
    try {
      const next = await api<ComputerStatus>("/computer/status", {
        signal: request.signal,
      });
      if (statusRequests.isCurrent(request)) status.value = next;
    } catch {
      // Focus refresh is opportunistic; keep the last known permission state.
    }
  }

  async function updateSetting(
    key: ComputerSettingKey,
    value: boolean,
  ): Promise<void> {
    settingsBusy.value = true;
    error.value = "";
    statusRequests.invalidate();
    previewRequests.invalidate();
    operationRequests.invalidate();
    try {
      await api("/computer/settings", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value }),
      });
      await Promise.all([loadStatus(), loadPreview(), loadOperations()]);
    } catch (cause) {
      captureError(cause);
    } finally {
      settingsBusy.value = false;
    }
  }

  async function requestPermission(
    permission: ComputerPermission,
  ): Promise<void> {
    if (!permissionRequestsAllowed.value) return;
    permissionBusy.value = permission;
    error.value = "";
    const endpoint =
      permission === "accessibility"
        ? "/computer/permissions/accessibility/request"
        : "/computer/permissions/screen-recording/request";
    statusRequests.invalidate();
    try {
      const next = await api<ComputerStatus>(endpoint, { method: "POST" });
      status.value = next;
    } catch (cause) {
      captureError(cause);
    } finally {
      permissionBusy.value = null;
    }
  }

  async function refreshSnapshot(): Promise<void> {
    snapshotBusy.value = true;
    error.value = "";
    previewRequests.invalidate();
    try {
      const next = await api<ComputerPreviewView>("/computer/snapshot", {
        method: "POST",
      });
      preview.value = next;
      await loadOperations();
    } catch (cause) {
      captureError(cause);
    } finally {
      snapshotBusy.value = false;
    }
  }

  async function refreshOperations(): Promise<void> {
    operationsBusy.value = true;
    error.value = "";
    await loadOperations();
    operationsBusy.value = false;
  }

  function captureError(cause: unknown): void {
    if (!error.value) {
      error.value = errorMessage(cause);
    }
  }

  return {
    status,
    preview,
    operations,
    error,
    remotePreviewBlocked,
    snapshotBusy,
    settingsBusy,
    operationsBusy,
    permissionBusy,
    permissionRequestsAllowed,
    load,
    updateSetting,
    requestPermission,
    refreshSnapshot,
    refreshOperations,
  };
}

function isRemotePreviewBlocked(cause: unknown): boolean {
  if (!(cause instanceof ApiError) || cause.code !== "FORBIDDEN") return false;
  if (!cause.details || typeof cause.details !== "object") return false;
  return (
    "reason" in cause.details &&
    (cause.details as { reason?: unknown }).reason ===
      "remote_computer_disabled"
  );
}
