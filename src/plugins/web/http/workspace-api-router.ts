import { Router } from "express";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import {
  asyncRoute,
  bodyRecord,
  requireString,
} from "../../../presentation/http/http-utils.js";
import type { WebRuntime } from "../runtime.js";

const MAX_WRITE_BYTES = 1024 * 1024;

export function createWorkspaceApiRouter(application: WebRuntime): Router {
  const router = Router();

  router.get(
    "/workspaces",
    asyncRoute(async (_req, res) => {
      res.json(await application.workspaces.list());
    }),
  );

  router.post(
    "/workspaces",
    asyncRoute(async (req, res) => {
      const body = bodyRecord(req.body);
      const parent = requireString(body.parent, "parent");
      const name = requireString(body.name, "name");
      res.json(
        await application.operations.run(
          {
            pluginId: "workspace",
            source: "gui",
            action: "create",
            input: { parent, name },
          },
          () => application.workspaces.createProject(parent, name),
        ),
      );
    }),
  );

  router.get("/workspace/roots", (_req, res) => {
    res.json(application.workspaces.roots());
  });

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

  router.put(
    "/workspace/file",
    asyncRoute(async (req, res) => {
      const body = bodyRecord(req.body);
      const fs = await application.workspaces.fs(
        requireString(body.root, "root"),
      );
      const filePath = requireString(body.path, "path");
      if (typeof body.content !== "string")
        throw new ChatRoomError("INVALID_INPUT", "content must be a string");
      const bytes = Buffer.byteLength(body.content, "utf8");
      if (bytes > MAX_WRITE_BYTES)
        throw new ChatRoomError(
          "INVALID_INPUT",
          `File content exceeds ${MAX_WRITE_BYTES} bytes`,
        );
      res.json(
        await application.operations.run(
          {
            pluginId: "workspace",
            source: "gui",
            action: "file.write",
            input: { root: fs.root, path: filePath, bytes },
          },
          () => fs.write(filePath, body.content as string),
        ),
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
