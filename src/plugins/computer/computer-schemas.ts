import { z } from "zod";

export const computerPermissionStateSchema = z.enum([
  "granted",
  "denied",
  "unknown",
  "not-required",
]);

export const computerDisplaySchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  scale: z.number(),
  primary: z.boolean(),
});

export const computerElementSchema = z.object({
  id: z.number().int(),
  role: z.string(),
  name: z.string().nullable(),
  value: z.string().nullable(),
  enabled: z.boolean(),
  focused: z.boolean(),
  selected: z.boolean(),
  sensitive: z.boolean(),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  actions: z.array(z.string()),
});

export const computerScreenshotSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png"]),
  data: z.string(),
});

export const computerNativeStatusSchema = z.object({
  platform: z.enum(["macos", "windows", "unsupported"]),
  helper: z.enum(["running", "stopped", "unavailable"]),
  permissions: z.object({
    accessibility: computerPermissionStateSchema,
    screenRecording: computerPermissionStateSchema,
  }),
  displays: z.array(computerDisplaySchema),
});

export const computerSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  revision: z.number().int(),
  display: computerDisplaySchema.nullable(),
  activeApp: z.string().nullable(),
  activeWindow: z.string().nullable(),
  cursor: z.object({ x: z.number(), y: z.number() }).nullable(),
  elements: z.array(computerElementSchema),
  screenshot: computerScreenshotSchema.optional(),
});

export const computerSnapshotMetadataSchema = computerSnapshotSchema.omit({
  screenshot: true,
});

export const computerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), x: z.number(), y: z.number() }),
  z.object({
    type: z.literal("click"),
    x: z.number().optional(),
    y: z.number().optional(),
    elementId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("double_click"),
    x: z.number().optional(),
    y: z.number().optional(),
    elementId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("right_click"),
    x: z.number().optional(),
    y: z.number().optional(),
    elementId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("drag"),
    from: z.object({ x: z.number(), y: z.number() }),
    to: z.object({ x: z.number(), y: z.number() }),
    durationMs: z.number().int().min(0).max(10_000).optional(),
  }),
  z.object({
    type: z.literal("scroll"),
    deltaX: z.number().optional(),
    deltaY: z.number(),
    elementId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("keypress"),
    keys: z.array(z.string().min(1)).min(1).max(8),
  }),
  z.object({
    type: z.literal("type_text"),
    text: z.string().max(100_000),
    elementId: z.number().int().optional(),
  }),
  z.object({ type: z.literal("invoke"), elementId: z.number().int() }),
  z.object({
    type: z.literal("set_value"),
    elementId: z.number().int(),
    value: z.string().max(100_000),
  }),
  z.object({
    type: z.literal("select_text"),
    elementId: z.number().int(),
    start: z.number().int().min(0),
    length: z.number().int().min(0),
  }),
  z.object({ type: z.literal("activate_app"), app: z.string().min(1) }),
  z.object({ type: z.literal("activate_window"), elementId: z.number().int() }),
  z.object({
    type: z.literal("move_window"),
    elementId: z.number().int(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal("resize_window"),
    elementId: z.number().int(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  z.object({
    type: z.literal("wait"),
    ms: z.number().int().min(0).max(30_000),
  }),
]);

export const computerActionResultSchema = z.object({
  success: z.literal(true),
  revision: z.number().int(),
  snapshot: computerSnapshotSchema.optional(),
  executionMode: z.enum(["semantic", "background", "foreground", "mixed"]),
  focusChanged: z.boolean(),
});

export const computerActionMetadataSchema = computerActionResultSchema.extend({
  snapshot: computerSnapshotMetadataSchema.optional(),
});

export const computerSnapshotTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("desktop") }),
  z.object({
    type: z.literal("display"),
    displayId: z.string().optional(),
  }),
  z.object({ type: z.literal("app"), app: z.string().min(1) }),
  z.object({ type: z.literal("window"), elementId: z.number().int() }),
  z.object({
    type: z.literal("region"),
    displayId: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
]);
