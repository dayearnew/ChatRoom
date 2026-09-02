import {
  createMcpHandler,
  McpServer,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import type { PluginManager } from "../../plugins/plugin-manager.js";
import {
  CHATROOM_NAME,
  CHATROOM_VERSION,
} from "../../core/runtime/identity.js";

export function createChatRoomMcpHandler(
  plugins: PluginManager,
): McpHttpHandler {
  return createMcpHandler(() => createServer(plugins), {
    legacy: "stateless",
    responseMode: "auto",
  });
}

function createServer(plugins: PluginManager): McpServer {
  const server = new McpServer({
    name: CHATROOM_NAME,
    version: CHATROOM_VERSION,
  });
  plugins.registerMcp(server);
  return server;
}
