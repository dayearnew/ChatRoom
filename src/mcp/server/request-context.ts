import { AsyncLocalStorage } from "node:async_hooks";
import type { ComputerAccessScope } from "../../plugins/computer/types.js";

const storage = new AsyncLocalStorage<ComputerAccessScope>();

export function runWithMcpAccessScope<T>(
  scope: ComputerAccessScope,
  action: () => T,
): T {
  return storage.run(scope, action);
}

export function currentMcpAccessScope(): ComputerAccessScope {
  return storage.getStore() ?? "local";
}
