#!/usr/bin/env node
import { asChatRoomError } from "../core/errors/chatroom-error.js";
import { runChatRoomCli } from "./run-cli.js";

void runChatRoomCli().catch((error) => {
  const normalized = asChatRoomError(error);
  console.error(`[${normalized.code}] ${normalized.message}`);
  if (normalized.details) console.error(normalized.details);
  process.exitCode = 1;
});
