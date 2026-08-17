import { Router } from "express";
import { z } from "zod";
import type { OperationLog } from "../../../operations/operation-log.js";
import type { CloudController } from "../../cloud/controller.js";
import { CLOUD_SERVICE_SCHEMA } from "../../cloud/types.js";
import { asyncRoute } from "../../../presentation/http/http-utils.js";

export function createCloudApiRouter(
  controller: CloudController,
  operations: OperationLog,
): Router {
  const router = Router();
  router.get("/cloud/status", (_req, res) => res.json(controller.status()));

  router.post(
    "/cloud/sync",
    asyncRoute(async (_req, res) =>
      res.json(
        await operations.run(
          { pluginId: "cloud", source: "gui", action: "sync" },
          () => controller.syncStatus(),
        ),
      ),
    ),
  );
  router.post(
    "/cloud/management",
    asyncRoute(async (_req, res) =>
      res.json(
        await operations.run(
          { pluginId: "cloud", source: "gui", action: "management" },
          () => controller.managementUrl(),
        ),
      ),
    ),
  );
  router.post(
    "/cloud/restore",
    asyncRoute(async (req, res) => {
      const body = z
        .object({ recoveryKey: z.string().min(20) })
        .strict()
        .parse(req.body);
      res.json(
        await operations.run(
          { pluginId: "cloud", source: "gui", action: "restore", input: body },
          () => controller.restore(body.recoveryKey),
        ),
      );
    }),
  );
  router.post(
    "/cloud/recovery-key",
    asyncRoute(async (_req, res) =>
      res.json(
        await operations.run(
          { pluginId: "cloud", source: "gui", action: "recovery-key.replace" },
          async () => ({ recoveryKey: await controller.replaceRecoveryKey() }),
        ),
      ),
    ),
  );
  router.post(
    "/cloud/prefix",
    asyncRoute(async (req, res) => {
      const body = z
        .object({ prefix: z.string().min(1).max(64) })
        .strict()
        .parse(req.body);
      res.json(
        await operations.run(
          {
            pluginId: "cloud",
            source: "gui",
            action: "prefix.set",
            input: body,
          },
          () => controller.setPrefix(body.prefix),
        ),
      );
    }),
  );
  router.post(
    "/cloud/services/:service",
    asyncRoute(async (req, res) => {
      const service = CLOUD_SERVICE_SCHEMA.parse(req.params.service);
      const body = z.object({ enabled: z.boolean() }).strict().parse(req.body);
      res.json(
        await operations.run(
          {
            pluginId: "cloud",
            source: "gui",
            action: "service.set",
            input: { service, enabled: body.enabled },
          },
          () => controller.setService(service, body.enabled),
        ),
      );
    }),
  );
  return router;
}
