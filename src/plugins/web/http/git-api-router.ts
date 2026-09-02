import { Router } from "express";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import {
  asyncRoute,
  requireString,
} from "../../../presentation/http/http-utils.js";
import type { GitStatus } from "../../git/types.js";
import type { WebRuntime } from "../runtime.js";

export function createGitApiRouter(application: WebRuntime): Router {
  const router = Router();

  router.get(
    "/git/status",
    asyncRoute(async (req, res) => {
      const root = await resolveRoot(application, req.query.root);
      res.json(await application.git.status(root));
    }),
  );

  router.get(
    "/git/diff",
    asyncRoute(async (req, res) => {
      const root = await resolveRoot(application, req.query.root);
      const filePath =
        typeof req.query.path === "string" ? req.query.path : undefined;
      res.json(await application.git.diff(root, filePath));
    }),
  );

  router.get(
    "/git/branches",
    asyncRoute(async (req, res) => {
      const root = await resolveRoot(application, req.query.root);
      res.json(await application.git.branches(root));
    }),
  );

  router.get(
    "/git/log",
    asyncRoute(async (req, res) => {
      const root = await resolveRoot(application, req.query.root);
      const requested = Number(req.query.limit ?? 30);
      const limit = Number.isFinite(requested) ? requested : 30;
      res.json(await application.git.log(root, limit));
    }),
  );

  router.post(
    "/git/stage",
    asyncRoute(async (req, res) => {
      const body = bodyRecord(req.body);
      const root = await resolveRoot(application, body.root);
      const paths = requireStringArray(body.paths, "paths");
      res.json(
        await mutate(application, "git.stage", root, { paths }, () =>
          application.git.stage(root, paths),
        ),
      );
    }),
  );

  router.post(
    "/git/unstage",
    asyncRoute(async (req, res) => {
      const body = bodyRecord(req.body);
      const root = await resolveRoot(application, body.root);
      const paths = requireStringArray(body.paths, "paths");
      res.json(
        await mutate(application, "git.unstage", root, { paths }, () =>
          application.git.unstage(root, paths),
        ),
      );
    }),
  );

  router.post(
    "/git/restore",
    asyncRoute(async (req, res) => {
      const body = bodyRecord(req.body);
      const root = await resolveRoot(application, body.root);
      const filePath = requireString(body.path, "path");
      res.json(
        await mutate(application, "git.restore", root, { path: filePath }, () =>
          application.git.restore(root, filePath),
        ),
      );
    }),
  );

  router.post(
    "/git/commit",
    asyncRoute(async (req, res) => {
      const body = bodyRecord(req.body);
      const root = await resolveRoot(application, body.root);
      const message = requireString(body.message, "message");
      res.json(
        await mutate(application, "git.commit", root, { message }, () =>
          application.git.commit(root, message),
        ),
      );
    }),
  );

  router.post(
    "/git/branches",
    asyncRoute(async (req, res) => {
      const body = bodyRecord(req.body);
      const root = await resolveRoot(application, body.root);
      const name = requireString(body.name, "name");
      res.json(
        await mutate(application, "git.branch.create", root, { name }, () =>
          application.git.createBranch(root, name),
        ),
      );
    }),
  );

  router.post(
    "/git/switch",
    asyncRoute(async (req, res) => {
      const body = bodyRecord(req.body);
      const root = await resolveRoot(application, body.root);
      const name = requireString(body.name, "name");
      res.json(
        await mutate(application, "git.branch.switch", root, { name }, () =>
          application.git.switchBranch(root, name),
        ),
      );
    }),
  );

  router.delete(
    "/git/branches",
    asyncRoute(async (req, res) => {
      const body = bodyRecord(req.body);
      const root = await resolveRoot(application, body.root);
      const name = requireString(body.name, "name");
      res.json(
        await mutate(application, "git.branch.delete", root, { name }, () =>
          application.git.deleteBranch(root, name),
        ),
      );
    }),
  );

  for (const action of ["fetch", "pull", "push"] as const) {
    router.post(
      `/git/${action}`,
      asyncRoute(async (req, res) => {
        const body = bodyRecord(req.body);
        const root = await resolveRoot(application, body.root);
        res.json(
          await mutate(application, `git.${action}`, root, {}, () =>
            application.git[action](root),
          ),
        );
      }),
    );
  }

  return router;
}

async function resolveRoot(
  application: WebRuntime,
  value: unknown,
): Promise<string> {
  return application.workspaces.resolve(requireString(value, "root"));
}

function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireStringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !item)
  )
    throw new ChatRoomError(
      "INVALID_INPUT",
      `${name} must be a non-empty array of strings`,
    );
  return value as string[];
}

function mutate(
  application: WebRuntime,
  action: string,
  root: string,
  input: Record<string, unknown>,
  operation: () => Promise<GitStatus>,
): Promise<GitStatus> {
  return application.operations.run(
    {
      pluginId: "git",
      source: "gui",
      action,
      input: { root, ...input },
    },
    operation,
  );
}
