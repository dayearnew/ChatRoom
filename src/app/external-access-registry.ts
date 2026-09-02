import type { ChatRoomConfig } from "../config/types.js";

export type ExternalAccessKind = "mcp" | "web";

export interface ExternalAccessState {
  mcpBaseUrl: string | null;
  webBaseUrl: string | null;
}

export class ExternalAccessRegistry {
  private cloud: ExternalAccessState = { mcpBaseUrl: null, webBaseUrl: null };

  constructor(private readonly config: ChatRoomConfig["auth"]) {}

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

  hosts(): ReadonlySet<string> {
    const hosts = new Set<string>();
    for (const kind of ["mcp", "web"] as const)
      for (const url of this.urls(kind)) hosts.add(new URL(url).hostname);
    return hosts;
  }

  private urls(kind: ExternalAccessKind): string[] {
    const selfHosted =
      kind === "mcp"
        ? this.config.mcpPublicBaseUrl
        : this.config.webPublicBaseUrl;
    const cloud =
      kind === "mcp" ? this.cloud.mcpBaseUrl : this.cloud.webBaseUrl;
    return [selfHosted, cloud]
      .filter((url): url is string => Boolean(url))
      .map(normalizeUrl);
  }
}

function normalizeState(state: ExternalAccessState): ExternalAccessState {
  return {
    mcpBaseUrl: state.mcpBaseUrl ? normalizeUrl(state.mcpBaseUrl) : null,
    webBaseUrl: state.webBaseUrl ? normalizeUrl(state.webBaseUrl) : null,
  };
}

function normalizeUrl(value: string): string {
  return new URL(value).toString().replace(/\/$/, "");
}
