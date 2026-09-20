import type { ChatRoomConfig } from "#config/types";
import { CHATROOM_VERSION } from "#core/runtime/identity";
import { FileLogStore } from "#infrastructure/logging/file-log-store";
import { SystemLog } from "#infrastructure/logging/system-log";
import {
  createApplication,
  type ApplicationComponents,
} from "./application.js";

export class ApplicationLifecycle {
  private components: ApplicationComponents | null = null;
  private starting: Promise<ApplicationComponents> | null = null;
  private shuttingDown: Promise<void> | null = null;
  private readonly logs: SystemLog;

  constructor(private readonly config: ChatRoomConfig) {
    this.logs = new SystemLog(new FileLogStore(config.dataDir));
  }

  async start(): Promise<ApplicationComponents> {
    if (this.shuttingDown) await this.shuttingDown;
    if (this.components) return this.components;
    if (this.starting) return this.starting;

    const starting = this.startInternal();
    this.starting = starting;
    try {
      return await starting;
    } finally {
      if (this.starting === starting) this.starting = null;
    }
  }

  private async startInternal(): Promise<ApplicationComponents> {
    this.logs.info("app", "app.starting", "ChatRoom is starting", {
      version: CHATROOM_VERSION,
    });
    let components: ApplicationComponents | null = null;
    try {
      components = await createApplication(this.config, this.logs);
      await components.http.start();
      await components.cloud.start();
      this.components = components;
      this.logs.info("app", "app.started", "ChatRoom started", {
        version: CHATROOM_VERSION,
      });
      return components;
    } catch (error) {
      this.logs.error("app", "app.start_failed", "ChatRoom failed to start", {
        error,
      });
      if (components) {
        try {
          await cleanupComponents(components);
        } catch (cleanupError) {
          await this.logs.flush();
          throw new AggregateError(
            [error, cleanupError],
            "Application startup failed and cleanup encountered errors",
          );
        }
      }
      await this.logs.flush();
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    const shutdown = this.shutdownInternal();
    this.shuttingDown = shutdown;
    try {
      await shutdown;
    } finally {
      if (this.shuttingDown === shutdown) this.shuttingDown = null;
    }
  }

  private async shutdownInternal(): Promise<void> {
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        return;
      }
    }

    const components = this.components;
    if (!components) return;
    this.components = null;
    this.logs.info("app", "app.stopping", "ChatRoom is stopping");
    try {
      await cleanupComponents(components);
      this.logs.info("app", "app.stopped", "ChatRoom stopped");
    } catch (error) {
      this.logs.error(
        "app",
        "app.stop_failed",
        "ChatRoom shutdown encountered errors",
        {
          error,
        },
      );
      throw error;
    } finally {
      await this.logs.flush();
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
