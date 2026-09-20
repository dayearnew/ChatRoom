import { Router } from "express";
import type { WebRuntime } from "#plugins/web/runtime";
import type { RuntimeEventBus } from "#app/event-bus";
import type { AuthService } from "#auth/auth-service";
import type { PasskeyService } from "#auth/passkey-service";
import { ChatRoomError } from "#core/errors/chatroom-error";
import {
  boundedIntegerQuery,
  requireString,
} from "#presentation/http/http-utils";
import { createProcessApiRouter } from "./process-api-router.js";
import { createWorkspaceApiRouter } from "./workspace-api-router.js";
import { createGitApiRouter } from "./git-api-router.js";
import type { IngressPolicy } from "#auth/ingress-policy";
import type { CloudController } from "#plugins/cloud/controller";
import { createCloudApiRouter } from "./cloud-api-router.js";
import { createComputerApiRouter } from "./computer-api-router.js";
import {
  apiAuthentication,
  createPrivateAuthApiRouter,
  createPublicAuthApiRouter,
} from "./auth-api-router.js";
import { createRuntimeApiRouter } from "./runtime-api-router.js";
import { createLogsApiRouter } from "./logs-api-router.js";
import type { LogService } from "#core/logging/types";

export function createApiRouter(
  application: WebRuntime,
  eventBus: RuntimeEventBus,
  auth: AuthService,
  passkeys: PasskeyService,
  ingress: IngressPolicy,
  cloud: CloudController,
  logs: LogService,
  runtimeStatus: () => {
    version: string;
    mcpRequests: number;
    uptimeMinutes: number;
  },
): Router {
  const router = Router();
  router.use(createPublicAuthApiRouter(auth, passkeys, ingress, logs));
  router.use(apiAuthentication(auth, ingress));
  router.use(createPrivateAuthApiRouter(passkeys, ingress, logs));
  router.use(createRuntimeApiRouter(application, eventBus, runtimeStatus));
  router.use(createLogsApiRouter(logs));

  router.get("/operations", (req, res) => {
    res.json(
      application.operations.list({
        limit: boundedIntegerQuery(req.query.limit, 100, 0, 500),
        offset: boundedIntegerQuery(req.query.offset, 0, 0, 100000),
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
