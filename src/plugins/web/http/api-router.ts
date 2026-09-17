import { Router } from "express";
import type { WebRuntime } from "../runtime.js";
import type { RuntimeEventBus } from "../../../app/event-bus.js";
import type { AuthService } from "../../../auth/auth-service.js";
import type { PasskeyService } from "../../../auth/passkey-service.js";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import { requireString } from "../../../presentation/http/http-utils.js";
import { createProcessApiRouter } from "./process-api-router.js";
import { createWorkspaceApiRouter } from "./workspace-api-router.js";
import { createGitApiRouter } from "./git-api-router.js";
import type { IngressPolicy } from "../../../auth/ingress-policy.js";
import type { CloudController } from "../../cloud/controller.js";
import { createCloudApiRouter } from "./cloud-api-router.js";
import { createComputerApiRouter } from "./computer-api-router.js";
import {
  apiAuthentication,
  createPrivateAuthApiRouter,
  createPublicAuthApiRouter,
} from "./auth-api-router.js";
import { createRuntimeApiRouter } from "./runtime-api-router.js";

export function createApiRouter(
  application: WebRuntime,
  eventBus: RuntimeEventBus,
  auth: AuthService,
  passkeys: PasskeyService,
  ingress: IngressPolicy,
  cloud: CloudController,
  runtimeStatus: () => {
    version: string;
    mcpRequests: number;
    uptimeMinutes: number;
  },
): Router {
  const router = Router();
  router.use(createPublicAuthApiRouter(auth, passkeys, ingress));
  router.use(apiAuthentication(auth, ingress));
  router.use(createPrivateAuthApiRouter(passkeys, ingress));
  router.use(createRuntimeApiRouter(application, eventBus, runtimeStatus));

  router.get("/operations", (req, res) => {
    res.json(
      application.operations.list({
        limit: numberQuery(req.query.limit, 100, 500),
        offset: numberQuery(req.query.offset, 0, 100000),
        ...(typeof req.query.pluginId === "string"
          ? { pluginId: req.query.pluginId }
          : {}),
        ...(typeof req.query.status === "string"
          ? { status: req.query.status }
          : {}),
      }),
    );
  });
  router.delete("/operations", (_req, res) => {
    res.json(application.operations.clearHistory());
  });
  router.get("/operations/:operationId", (req, res) => {
    const operationId = requireString(req.params.operationId, "operationId");
    const event = application.operations.get(operationId);
    if (!event) throw new ChatRoomError("NOT_FOUND", "Operation not found");
    res.json(event);
  });

  router.use(createWorkspaceApiRouter(application));
  router.use(createGitApiRouter(application));
  router.use(createProcessApiRouter(application));
  router.use(
    createComputerApiRouter(
      application.computer,
      application.operations,
      ingress,
    ),
  );
  router.use(createCloudApiRouter(cloud, application.operations));
  return router;
}

function numberQuery(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, max)
    : fallback;
}
