import { z } from "zod";
import type { PluginMcpRegistrar } from "../../mcp/server/plugin-mcp-registrar.js";
import {
  closedRead,
  openWorldMutation,
} from "../../mcp/server/tool-support.js";
import { currentMcpAccessScope } from "../../mcp/server/request-context.js";
import {
  auditActionOutput,
  auditComputerActions,
  auditSnapshotOutput,
} from "./audit.js";
import {
  computerActionMetadataSchema,
  computerActionSchema,
  computerSnapshotMetadataSchema,
  computerSnapshotTargetSchema,
} from "./computer-schemas.js";
import type { ComputerService } from "./computer-service.js";
import type {
  ComputerAction,
  ComputerActionRequest,
  ComputerActionResult,
  ComputerSnapshot,
  ComputerSnapshotTarget,
} from "./types.js";

export function registerComputerTools(
  mcp: PluginMcpRegistrar,
  service: ComputerService,
): void {
  mcp.registerTool(
    "computer_snapshot",
    {
      title: "Observe computer",
      description:
        "Observe the current desktop using a screenshot and compact accessibility elements. Element IDs are valid only for the returned snapshotId.",
      inputSchema: z.object({
        target: computerSnapshotTargetSchema.optional(),
        includeScreenshot: z.boolean().default(true),
        includeElements: z.boolean().default(true),
      }),
      outputSchema: computerSnapshotMetadataSchema,
      annotations: closedRead,
      action: "snapshot",
      audit: {
        output: (value) => auditSnapshotOutput(value as ComputerSnapshot),
      },
      present: presentSnapshot,
    },
    (input) =>
      service.snapshot(currentMcpAccessScope(), {
        includeScreenshot: input.includeScreenshot,
        includeElements: input.includeElements,
        ...(input.target === undefined
          ? {}
          : { target: normalizeSnapshotTarget(input.target) }),
      }),
  );

  mcp.registerTool(
    "computer_action",
    {
      title: "Control computer",
      description:
        "Execute a bounded batch of semantic or coordinate desktop actions. Prefer elementId from the latest snapshot; elementId actions require that snapshotId.",
      inputSchema: z.object({
        snapshotId: z.string().optional(),
        actions: z.array(computerActionSchema).min(1).max(50),
        observeAfter: z.boolean().default(true),
      }),
      outputSchema: computerActionMetadataSchema,
      annotations: openWorldMutation,
      action: "action",
      audit: {
        input: (value) => auditComputerActions(value as ComputerActionRequest),
        output: (value) => auditActionOutput(value as ComputerActionResult),
      },
      present: presentAction,
    },
    (input) =>
      service.action(currentMcpAccessScope(), {
        actions: input.actions as ComputerAction[],
        observeAfter: input.observeAfter,
        ...(input.snapshotId === undefined
          ? {}
          : { snapshotId: input.snapshotId }),
      }),
  );
}

function presentSnapshot(value: unknown) {
  const snapshot = value as ComputerSnapshot;
  const { screenshot, ...metadata } = snapshot;
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
      ...(screenshot
        ? [
            {
              type: "image" as const,
              data: screenshot.data,
              mimeType: screenshot.mimeType,
            },
          ]
        : []),
    ],
    structuredContent: metadata,
  };
}

function presentAction(value: unknown) {
  const result = value as ComputerActionResult;
  const screenshot = result.snapshot?.screenshot;
  const snapshot = result.snapshot
    ? (({ screenshot: _screenshot, ...metadata }) => metadata)(result.snapshot)
    : undefined;
  const safe = {
    success: result.success,
    revision: result.revision,
    executionMode: result.executionMode,
    focusChanged: result.focusChanged,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(safe, null, 2) },
      ...(screenshot
        ? [
            {
              type: "image" as const,
              data: screenshot.data,
              mimeType: screenshot.mimeType,
            },
          ]
        : []),
    ],
    structuredContent: safe,
  };
}

function normalizeSnapshotTarget(input: {
  type: "desktop" | "display" | "app" | "window" | "region";
  displayId?: string | undefined;
  app?: string;
  elementId?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): ComputerSnapshotTarget {
  switch (input.type) {
    case "desktop":
      return { type: "desktop" };
    case "display":
      return input.displayId === undefined
        ? { type: "display" }
        : { type: "display", displayId: input.displayId };
    case "app":
      return { type: "app", app: input.app! };
    case "window":
      return { type: "window", elementId: input.elementId! };
    case "region": {
      const region = {
        type: "region" as const,
        x: input.x!,
        y: input.y!,
        width: input.width!,
        height: input.height!,
      };
      return input.displayId === undefined
        ? region
        : { ...region, displayId: input.displayId };
    }
  }
}
