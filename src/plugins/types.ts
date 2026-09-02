import type { ChatRoomConfig } from "../config/types.js";
import type { AppDatabase } from "../infrastructure/database/app-database.js";
import type { PluginMcpRegistrar } from "../mcp/server/plugin-mcp-registrar.js";
import type { OperationLog } from "../operations/operation-log.js";
import type { RuntimeEventBus } from "../app/event-bus.js";
import type { ExternalAccessRegistry } from "../app/external-access-registry.js";

export interface ServiceToken<T> {
  readonly key: symbol;
  readonly name: string;
  readonly __type?: T;
}
export function createServiceToken<T>(name: string): ServiceToken<T> {
  return { key: Symbol(name), name };
}

export class ServiceRegistry {
  private readonly values = new Map<symbol, unknown>();
  provide<T>(token: ServiceToken<T>, value: T): void {
    if (this.values.has(token.key))
      throw new Error(`Service already provided: ${token.name}`);
    this.values.set(token.key, value);
  }
  require<T>(token: ServiceToken<T>): T {
    const value = this.values.get(token.key);
    if (value === undefined)
      throw new Error(`Required service unavailable: ${token.name}`);
    return value as T;
  }
}

export interface PluginContext {
  config: ChatRoomConfig;
  database: AppDatabase;
  operations: OperationLog;
  events: RuntimeEventBus;
  externalAccess: ExternalAccessRegistry;
  services: ServiceRegistry;
}

export interface InternalPlugin {
  id: string;
  activate(context: PluginContext): Promise<void> | void;
  registerMcp?(mcp: PluginMcpRegistrar): void;
  deactivate?(): Promise<void> | void;
}
