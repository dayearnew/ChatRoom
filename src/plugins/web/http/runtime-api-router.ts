import { Router } from "express";
import type { RuntimeEventBus } from "#app/event-bus";
import { ChatRoomError } from "#core/errors/chatroom-error";
import { bodyRecord, requireString } from "#presentation/http/http-utils";
import type { WebRuntime } from "#plugins/web/runtime";

interface RuntimeStatus {
  version: string;
  mcpRequests: number;
  uptimeMinutes: number;
}

export function createRuntimeApiRouter(
  application: WebRuntime,
  eventBus: RuntimeEventBus,
  runtimeStatus: () => RuntimeStatus,
): Router {
  const router = Router();

  router.get("/runtime", (_req, res) => res.json(runtimeStatus()));
  router.get("/mcp/tools", (_req, res) => {
    res.json(application.mcpTools.list());
  });
  router.patch("/mcp/tools/:toolName", (req, res) => {
    const body = bodyRecord(req.body);
    if (typeof body.enabled !== "boolean")
      throw new ChatRoomError("INVALID_INPUT", "enabled must be a boolean");
    res.json(
      application.mcpTools.setEnabled(
        requireString(req.params.toolName, "toolName"),
        body.enabled,
      ),
    );
  });

  router.get("/events", (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(
      `event: ready\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`,
    );
    const unsubscribe = eventBus.subscribe((event) => {
      res.write(`event: runtime\ndata: ${JSON.stringify(event)}\n\n`);
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
