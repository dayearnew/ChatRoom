import { Router } from "express";
import type { LogLevel, LogService } from "#core/logging/types";
import { asyncRoute, boundedIntegerQuery } from "#presentation/http/http-utils";

const LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

export function createLogsApiRouter(logs: LogService): Router {
  const router = Router();

  router.get(
    "/logs",
    asyncRoute(async (req, res) => {
      const limit = boundedIntegerQuery(req.query.limit, 100, 1, 500);
      const levels = stringSet(req.query.level)?.filter(
        (value): value is LogLevel => LEVELS.has(value as LogLevel),
      );
      const modules = stringSet(req.query.module);
      res.json(
        await logs.list({
          limit,
          ...(typeof req.query.cursor === "string" && req.query.cursor
            ? { cursor: req.query.cursor }
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
    const unsubscribe = logs.subscribe((record) => {
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
