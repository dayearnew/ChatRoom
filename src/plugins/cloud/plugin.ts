import type { InternalPlugin } from "../types.js";
import { createServiceToken } from "../types.js";
import { CloudController } from "./controller.js";

export const CloudService = createServiceToken<CloudController>("cloud");

export function createCloudPlugin(): InternalPlugin {
  let controller: CloudController | null = null;

  return {
    id: "cloud",
    async activate(context) {
      controller = await CloudController.create(
        context.config,
        context.externalAccess,
      );
      context.services.provide(CloudService, controller);
    },
    async deactivate() {
      await controller?.stop();
      controller = null;
    },
  };
}
