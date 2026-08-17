export type {
  Operation,
  ProcessSnapshot,
  WorkspaceView as Workspace,
  WorktreeApplyPreview,
  WorktreeFileDiff,
} from "../api-types.js";

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
    const message =
      body && typeof body === "object" && "error" in body
        ? String(
            (body as { error?: { message?: string } }).error?.message ??
              `HTTP ${response.status}`,
          )
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}
