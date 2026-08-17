import { Router } from "express";
import type { WebRuntime } from "../runtime.js";
import {
  asyncRoute,
  requireString,
} from "../../../presentation/http/http-utils.js";

export function createProcessApiRouter(application: WebRuntime): Router {
  const router = Router();
  router.get("/processes", (_req, res) =>
    res.json(application.listProcesses()),
  );
  router.get("/processes/:processId", (req, res) => {
    res.json(
      application.getProcess(requireString(req.params.processId, "processId")),
    );
  });
  router.post(
    "/processes/:processId/terminate",
    asyncRoute(async (req, res) => {
      res.json(
        await application.processKill(
          requireString(req.params.processId, "processId"),
          false,
        ),
      );
    }),
  );
  router.post(
    "/processes/:processId/kill",
    asyncRoute(async (req, res) => {
      res.json(
        await application.processKill(
          requireString(req.params.processId, "processId"),
          true,
        ),
      );
    }),
  );
  return router;
}
