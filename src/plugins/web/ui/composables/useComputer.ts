import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ApiError,
  api,
  type ComputerPermission,
  type ComputerPreviewView,
  type ComputerStatus,
  type Operation,
} from "../api.js";

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
    try {
      status.value = await api<ComputerStatus>("/computer/status");
    } catch (cause) {
      captureError(cause);
    }
  }

  async function loadOperations(): Promise<void> {
    try {
      operations.value = await api<Operation[]>(
        "/operations?pluginId=computer&limit=50",
      );
    } catch (cause) {
      captureError(cause);
    }
  }

  async function loadPreview(): Promise<void> {
    remotePreviewBlocked.value = false;
    try {
      preview.value = await api<ComputerPreviewView | null>(
        "/computer/preview",
      );
    } catch (cause) {
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
    try {
      status.value = await api<ComputerStatus>("/computer/status");
    } catch {}
  }

  async function updateSetting(
    key: ComputerSettingKey,
    value: boolean,
  ): Promise<void> {
    settingsBusy.value = true;
    error.value = "";
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
    try {
      status.value = await api<ComputerStatus>(endpoint, { method: "POST" });
    } catch (cause) {
      captureError(cause);
    } finally {
      permissionBusy.value = null;
    }
  }

  async function refreshSnapshot(): Promise<void> {
    snapshotBusy.value = true;
    error.value = "";
    try {
      preview.value = await api<ComputerPreviewView>("/computer/snapshot", {
        method: "POST",
      });
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
      error.value = cause instanceof Error ? cause.message : String(cause);
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
