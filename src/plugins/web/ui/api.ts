export type {
  UpdateStatus,
  RuntimeStatus,
  PasskeySummary,
  McpToolSummary,
  CloudStatus,
  CloudService,
  CloudManagementSession,
  CloudRestoreResult,
  AuthStatus,
  ComputerPermission,
  ComputerPreviewView,
  ComputerStatus,
  GitBranch,
  GitChange,
  GitCommit,
  GitDiff,
  GitStatus,
  Operation,
  ProcessSnapshot,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceFileContent,
  WorkspaceInfo,
  WorkspaceSkill,
} from "../api-types.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiRequestInit extends RequestInit {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function api<T>(
  path: string,
  options: ApiRequestInit = {},
): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
    ...init
  } = options;
  const controller = new AbortController();
  const timeout =
    timeoutMs > 0
      ? window.setTimeout(
          () =>
            controller.abort(
              new DOMException("Request timed out", "TimeoutError"),
            ),
          timeoutMs,
        )
      : null;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) abortFromExternal();
  else
    externalSignal?.addEventListener("abort", abortFromExternal, {
      once: true,
    });

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (typeof init.body === "string" && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    let body: unknown = null;
    if (response.status !== 204) {
      try {
        body = await response.json();
      } catch {
        if (response.ok) {
          throw new ApiError(
            response.status,
            "INVALID_RESPONSE",
            "Server returned an invalid JSON response",
            null,
          );
        }
      }
    }
    if (!response.ok) {
      const error =
        body && typeof body === "object" && "error" in body
          ? (
              body as {
                error?: { code?: string; message?: string; details?: unknown };
              }
            ).error
          : undefined;
      throw new ApiError(
        response.status,
        error?.code ?? "HTTP_ERROR",
        error?.message ?? `HTTP ${response.status}`,
        error?.details ?? null,
      );
    }
    return body as T;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}
