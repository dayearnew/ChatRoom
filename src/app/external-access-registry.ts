import type { ChatRoomConfig } from "../config/types.js";

export type ExternalAccessKind = "mcp" | "web";

export interface ExternalAccessState {
  mcpBaseUrl: string | null;
  webBaseUrl: string | null;
}

export class ExternalAccessRegistry {
  private readonly selfHosted: ExternalAccessState;
  private cloud: ExternalAccessState = { mcpBaseUrl: null, webBaseUrl: null };

  constructor(config: ChatRoomConfig["auth"]) {
    this.selfHosted = normalizeState({
      mcpBaseUrl: config.mcpPublicBaseUrl,
      webBaseUrl: config.webPublicBaseUrl,
    });
  }

  setCloud(state: ExternalAccessState): void {
    this.cloud = normalizeState(state);
  }

  clearCloud(): void {
    this.cloud = { mcpBaseUrl: null, webBaseUrl: null };
  }

  baseUrlForHost(kind: ExternalAccessKind, hostname: string): string | null {
    for (const url of this.urls(kind))
      if (new URL(url).hostname === hostname) return url;
    return null;
  }

  matches(kind: ExternalAccessKind, hostname: string): boolean {
    return this.baseUrlForHost(kind, hostname) !== null;
  }

  hasHost(hostname: string): boolean {
    return this.matches("mcp", hostname) || this.matches("web", hostname);
  }

  private urls(kind: ExternalAccessKind): string[] {
    const key = kind === "mcp" ? "mcpBaseUrl" : "webBaseUrl";
    return [this.selfHosted[key], this.cloud[key]].filter(
      (url): url is string => url !== null,
    );
  }
}

function normalizeState(state: ExternalAccessState): ExternalAccessState {
  return {
    mcpBaseUrl: normalizeUrl(state.mcpBaseUrl),
    webBaseUrl: normalizeUrl(state.webBaseUrl),
  };
}

function normalizeUrl(value: string | null): string | null {
  return value ? new URL(value).toString().replace(/\/$/, "") : null;
}
