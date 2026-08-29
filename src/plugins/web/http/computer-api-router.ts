import { Router } from "express";
import { z } from "zod";
import type { ComputerService } from "../../computer/computer-service.js";
import type { OperationLog } from "../../../operations/operation-log.js";
import type { IngressPolicy } from "../../../auth/ingress-policy.js";
import { asyncRoute } from "../../../presentation/http/http-utils.js";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";

const settingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    remoteAccess: z.boolean().optional(),
  })
  .strict();

export function createComputerApiRouter(
  computer: ComputerService,
  operations: OperationLog,
  ingress: IngressPolicy,
): Router {
  const router = Router();
  router.get(
    "/computer/status",
    asyncRoute(async (_req, res) => res.json(await computer.status())),
  );
  router.post(
    "/computer/permissions/accessibility/request",
    asyncRoute(async (req, res) => {
      assertLocalPermissionRequest(req);
      res.json(await computer.requestPermission("accessibility"));
    }),
  );
  router.post(
    "/computer/permissions/screen-recording/request",
    asyncRoute(async (req, res) => {
      assertLocalPermissionRequest(req);
      res.json(await computer.requestPermission("screenRecording"));
    }),
  );

  function assertLocalPermissionRequest(
    req: Parameters<IngressPolicy["isExternalWeb"]>[0],
  ) {
    if (ingress.isExternalWeb(req))
      throw new ChatRoomError(
        "FORBIDDEN",
        "Computer permissions can be requested only from the local WebUI",
      );
  }
  router.patch(
    "/computer/settings",
    asyncRoute(async (req, res) => {
      const parsed = settingsPatchSchema.parse(req.body);
      const patch = {
        ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
        ...(parsed.remoteAccess === undefined
          ? {}
          : { remoteAccess: parsed.remoteAccess }),
      };
      res.json(
        await operations.run(
          {
            pluginId: "computer",
            source: "gui",
            action: "settings.set",
            input: patch,
          },
          async () => computer.setSettings(patch),
        ),
      );
    }),
  );
  router.get("/computer/preview", (req, res) => {
    const scope = ingress.isExternalWeb(req) ? "remote" : "local";
    res.json(presentPreview(computer.latestSnapshot(scope)));
  });
  router.post(
    "/computer/snapshot",
    asyncRoute(async (req, res) => {
      const scope = ingress.isExternalWeb(req) ? "remote" : "local";
      const value = await computer.snapshot(scope, {
        includeScreenshot: true,
        includeElements: true,
      });
      res.json(presentPreview(value));
    }),
  );
  return router;
}

function presentPreview(value: ReturnType<ComputerService["latestSnapshot"]>) {
  if (!value) return null;
  return {
    snapshotId: value.snapshotId,
    revision: value.revision,
    display: value.display,
    activeApp: value.activeApp,
    activeWindow: value.activeWindow,
    cursor: value.cursor,
    elementCount: value.elements.length,
    screenshot: value.screenshot ?? null,
  };
}
