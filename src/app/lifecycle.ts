import type { ChatRoomConfig } from "../config/types.js";
import { CHATROOM_VERSION } from "../core/runtime/identity.js";
import { SystemLogger } from "../infrastructure/logging/logger.js";
import {
  createApplication,
  type ApplicationComponents,
} from "./application.js";

export class ApplicationLifecycle {
  private components: ApplicationComponents | null = null;
  private shuttingDown: Promise<void> | null = null;
  private readonly logger: SystemLogger;

  constructor(private readonly config: ChatRoomConfig) {
    this.logger = new SystemLogger(config.dataDir);
  }

  async start(): Promise<ApplicationComponents> {
    if (this.components) return this.components;
    this.logger.info("app", "app.starting", "ChatRoom is starting", {
      version: CHATROOM_VERSION,
    });
    let components: ApplicationComponents | null = null;
    try {
      components = await createApplication(this.config, this.logger);
      await components.http.start();
      await components.cloud.start();
      this.components = components;
      this.logger.info("app", "app.started", "ChatRoom started", {
        version: CHATROOM_VERSION,
      });
      return components;
    } catch (error) {
      this.logger.error("app", "app.start_failed", "ChatRoom failed to start", {
        error,
      });
      if (components) {
        try {
          await cleanupComponents(components);
        } catch (cleanupError) {
          await this.logger.flush();
          throw new AggregateError(
            [error, cleanupError],
            "Application startup failed and cleanup encountered errors",
          );
        }
      }
      await this.logger.flush();
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    this.shuttingDown = this.shutdownInternal();
    return this.shuttingDown;
  }

  private async shutdownInternal(): Promise<void> {
    const components = this.components;
    if (!components) return;
    this.components = null;
    this.logger.info("app", "app.stopping", "ChatRoom is stopping");
    try {
      await cleanupComponents(components);
      this.logger.info("app", "app.stopped", "ChatRoom stopped");
    } catch (error) {
      this.logger.error(
        "app",
        "app.stop_failed",
        "ChatRoom shutdown encountered errors",
        {
          error,
        },
      );
      throw error;
    } finally {
      await this.logger.flush();
    }
  }
}

async function cleanupComponents(
  components: ApplicationComponents,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await components.http.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    await components.plugins.stop();
  } catch (error) {
    errors.push(error);
  }
  try {
    components.database.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Application shutdown encountered errors");
}
