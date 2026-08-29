/** Composition root for the single-package ChatRoom runtime. */
import type { ChatRoomConfig } from "../config/types.js";
import { AppDatabase } from "../infrastructure/database/app-database.js";
import { OperationRepository } from "../infrastructure/database/operation-repository.js";
import { OAuthRepository } from "../infrastructure/database/oauth-repository.js";
import { PasskeyRepository } from "../infrastructure/database/passkey-repository.js";
import { WebSessionRepository } from "../infrastructure/database/web-session-repository.js";
import { RuntimeEventBus } from "./event-bus.js";
import { OperationLog } from "../operations/operation-log.js";
import { AuthService } from "../auth/auth-service.js";
import { PasskeyService } from "../auth/passkey-service.js";
import { ExternalAccessRegistry } from "./external-access-registry.js";
import { ServiceRegistry } from "../plugins/types.js";
import { PluginManager } from "../plugins/plugin-manager.js";
import { createWorkspacePlugin } from "../plugins/workspace/plugin.js";
import {
  createProcessPlugin,
  ProcessService,
} from "../plugins/process/plugin.js";
import { createCloudPlugin, CloudService } from "../plugins/cloud/plugin.js";
import {
  createComputerPlugin,
  ComputerServiceToken,
} from "../plugins/computer/plugin.js";
import { createWebPlugin, WebServiceToken } from "../plugins/web/plugin.js";
import { createChatRoomMcpHandler } from "../mcp/server/create-mcp-server.js";
import { HttpServer } from "../infrastructure/http/http-server.js";

export interface ApplicationComponents {
  database: AppDatabase;
  eventBus: RuntimeEventBus;
  operations: OperationLog;
  plugins: PluginManager;
  application: import("../plugins/web/runtime.js").WebRuntime;
  processes: import("../plugins/process/process-supervisor.js").ProcessSupervisor;
  cloud: import("../plugins/cloud/controller.js").CloudController;
  computer: import("../plugins/computer/computer-service.js").ComputerService;
  http: HttpServer;
}

export async function createApplication(
  config: ChatRoomConfig,
): Promise<ApplicationComponents> {
  const database = new AppDatabase(config.databasePath);
  try {
    const eventBus = new RuntimeEventBus();
    const operations = new OperationLog(
      new OperationRepository(database),
      eventBus,
      config.operations.maxPayloadBytes,
    );
    operations.reconcileInterrupted();
    const externalAccess = new ExternalAccessRegistry(config.auth);
    const auth = new AuthService(
      new OAuthRepository(database),
      new WebSessionRepository(database),
      config.auth,
    );
    const passkeys = new PasskeyService(new PasskeyRepository(database));
    const services = new ServiceRegistry();
    const plugins = new PluginManager(
      {
        config,
        database,
        operations,
        events: eventBus,
        externalAccess,
        services,
      },
      [
        createWorkspacePlugin(),
        createProcessPlugin(),
        createComputerPlugin(),
        createCloudPlugin(),
        createWebPlugin(),
      ],
    );
    await plugins.start();
    const web = services.require(WebServiceToken);
    const processes = services.require(ProcessService);
    const cloud = services.require(CloudService);
    const computer = services.require(ComputerServiceToken);
    const mcp = createChatRoomMcpHandler(plugins);
    const http = new HttpServer(
      config,
      web.application,
      eventBus,
      auth,
      passkeys,
      mcp,
      externalAccess,
      cloud,
    );
    return {
      database,
      eventBus,
      operations,
      plugins,
      application: web.application,
      processes,
      cloud,
      computer,
      http,
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
