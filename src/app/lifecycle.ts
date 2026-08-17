/** Coordinates startup and shutdown ordering for runtime resources and internal plugins. */
import type { ChatRoomConfig } from "../config/types.js";
import {
  createApplication,
  type ApplicationComponents,
} from "./application.js";

export class ApplicationLifecycle {
  private components: ApplicationComponents | null = null;
  private shuttingDown: Promise<void> | null = null;
  constructor(private readonly config: ChatRoomConfig) {}

  async start(): Promise<ApplicationComponents> {
    if (this.components) return this.components;
    const components = await createApplication(this.config);
    try {
      await components.http.start();
      await components.cloud.start();
      this.components = components;
      return components;
    } catch (error) {
      await components.http.close().catch(() => undefined);
      await components.plugins.stop().catch(() => undefined);
      components.database.close();
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
    await components.http.close();
    await components.plugins.stop();
    components.database.close();
    this.components = null;
  }
}
