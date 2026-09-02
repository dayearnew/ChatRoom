import { Router } from "express";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import {
  asyncRoute,
  requireString,
} from "../../../presentation/http/http-utils.js";
import type { WebRuntime } from "../runtime.js";

export function createWorkspaceApiRouter(application: WebRuntime): Router {
  const router = Router();

  router.get(
    "/workspaces",
    asyncRoute(async (_req, res) => {
      res.json(await application.workspaces.list());
    }),
  );

  router.get(
    "/workspace",
    asyncRoute(async (req, res) => {
      res.json(
        await application.workspaces.info(
          requireString(req.query.root, "root"),
        ),
      );
    }),
  );

  router.get(
    "/workspace/files",
    asyncRoute(async (req, res) => {
      const fs = await application.workspaces.fs(
        requireString(req.query.root, "root"),
      );
      const filePath =
        typeof req.query.path === "string" ? req.query.path : ".";
      res.json(
        await fs.list(filePath, { recursive: req.query.recursive === "1" }),
      );
    }),
  );

  router.get(
    "/workspace/file",
    asyncRoute(async (req, res) => {
      const fs = await application.workspaces.fs(
        requireString(req.query.root, "root"),
      );
      res.json(
        await fs.read(requireString(req.query.path, "path"), {
          maxBytes: 2 * 1024 * 1024,
        }),
      );
    }),
  );

  router.get(
    "/workspace/file/image",
    asyncRoute(async (req, res) => {
      const filePath = requireString(req.query.path, "path");
      const mime = imageMime(filePath);
      if (!mime)
        throw new ChatRoomError(
          "INVALID_INPUT",
          "File type is not supported for image preview",
        );
      const fs = await application.workspaces.fs(
        requireString(req.query.root, "root"),
      );
      const file = await fs.readBytes(filePath, { maxBytes: 10 * 1024 * 1024 });
      if (file.truncated)
        throw new ChatRoomError(
          "INVALID_INPUT",
          "Image is too large to preview",
        );
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", String(file.data.byteLength));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(file.data);
    }),
  );

  return router;
}

function imageMime(filePath: string): string | null {
  switch (filePath.split(".").pop()?.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    default:
      return null;
  }
}
