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
      try {
        await cleanupComponents(components);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Application startup failed and cleanup encountered errors",
        );
      }
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
    await cleanupComponents(components);
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
