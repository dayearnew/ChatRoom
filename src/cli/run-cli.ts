import { initializeConfig, loadConfig } from "../config/load-config.js";
import { ApplicationLifecycle } from "../app/lifecycle.js";

export async function runChatRoomCli(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const [command = "help"] = argv;
  if (command === "init") return init();
  if (command === "serve") return serve();
  printHelp();
}

async function init(): Promise<void> {
  const result = await initializeConfig();
  console.log(`ChatRoom initialized: ${result.configPath}`);
  console.log(`Allowed roots: ${result.config.allowedRoots.join(", ")}`);
  console.log(`Owner token: ${result.config.auth.ownerToken}`);
  console.log(
    "Local loopback WebUI does not require authentication by default. Keep the owner token private for public access.",
  );
}

async function serve(): Promise<void> {
  const config = await loadConfig();
  const lifecycle = new ApplicationLifecycle(config);
  await lifecycle.start();
  console.log(
    `ChatRoom listening on http://${config.server.host}:${config.server.port}`,
  );
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void lifecycle
      .shutdown()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function printHelp(): void {
  console.log("ChatRoom\n\nUsage:\n  chatroom init\n  chatroom serve");
}
