export type {
  ComputerPermission,
  ComputerPreviewView,
  ComputerStatus,
  Operation,
  ProcessSnapshot,
  WorkspaceView as Workspace,
  WorktreeApplyPreview,
  WorktreeFileDiff,
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

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body =
    response.status === 204
      ? null
      : ((await response.json().catch(() => null)) as unknown);
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
}
