import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError } from "zod";
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
  const normalized =
    error instanceof ZodError
      ? new ChatRoomError("INVALID_INPUT", "Invalid request", {
          issues: error.issues,
        })
      : asChatRoomError(error);
  res.status(statusForErrorCode(normalized.code)).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details ?? null,
    },
  });
}

function statusForErrorCode(code: ChatRoomError["code"]): number {
  switch (code) {
    case "INVALID_INPUT":
      return 400;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "UNSUPPORTED":
      return 501;
    case "PROCESS_FAILED":
      return 422;
    case "INTERNAL":
      return 500;
  }
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value)
    throw new ChatRoomError("INVALID_INPUT", `${name} is required`);
  return value;
}

export function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function requireStringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !item)
  )
    throw new ChatRoomError(
      "INVALID_INPUT",
      `${name} must be a non-empty array of strings`,
    );
  return value as string[];
}

export function parseCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null;
    }
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
