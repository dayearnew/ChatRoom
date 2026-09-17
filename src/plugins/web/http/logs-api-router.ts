import { Router } from "express";
import type { SystemLogReader } from "../../../infrastructure/logging/log-reader.js";
import type {
  SystemLogLevel,
  SystemLogSink,
} from "../../../core/logging/types.js";
import { asyncRoute } from "../../../presentation/http/http-utils.js";

const LEVELS = new Set<SystemLogLevel>(["debug", "info", "warn", "error"]);

export function createLogsApiRouter(
  reader: SystemLogReader,
  logger: SystemLogSink,
): Router {
  const router = Router();

  router.get(
    "/logs",
    asyncRoute(async (req, res) => {
      const limit = numberQuery(req.query.limit, 100, 500);
      const levels = stringSet(req.query.level)?.filter(
        (value): value is SystemLogLevel => LEVELS.has(value as SystemLogLevel),
      );
      const modules = stringSet(req.query.module);
      res.json(
        await reader.list({
          limit,
          ...(typeof req.query.before === "string" && req.query.before
            ? { before: req.query.before }
            : {}),
          ...(levels?.length ? { levels: new Set(levels) } : {}),
          ...(modules?.length ? { modules: new Set(modules) } : {}),
        }),
      );
    }),
  );

  router.get("/logs/stream", (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(
      `event: ready\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`,
    );
    const unsubscribe = logger.subscribe((record) => {
      res.write(`event: log\ndata: ${JSON.stringify(record)}\n\n`);
    });
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15000);
    keepalive.unref();
    req.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });

  return router;
}

function numberQuery(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
}

function stringSet(value: unknown): string[] | null {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const values = raw
    .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? [...new Set(values)] : null;
}
