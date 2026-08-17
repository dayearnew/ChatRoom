/** Shared Express helpers for async error propagation and typed ChatRoom error responses. */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  asChatRoomError,
  ChatRoomError,
} from "../../core/errors/chatroom-error.js";

export function asyncRoute(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const normalized = asChatRoomError(error);
  const status =
    normalized.code === "INVALID_INPUT"
      ? 400
      : normalized.code === "FORBIDDEN"
        ? 403
        : normalized.code === "NOT_FOUND"
          ? 404
          : normalized.code === "CONFLICT"
            ? 409
            : normalized.code === "UNSUPPORTED"
              ? 501
              : normalized.code === "PROCESS_FAILED"
                ? 422
                : 500;
  res.status(status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details ?? null,
    },
  });
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value)
    throw new ChatRoomError("INVALID_INPUT", `${name} is required`);
  return value;
}
export function parseCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}
