/** Runtime configuration after defaults and path normalization have been resolved. */
export interface ChatRoomConfig {
  allowedRoots: string[];
  dataDir: string;
  databasePath: string;
  server: {
    host: string;
    port: number;
  };
  auth: {
    localWebAuth: boolean;
    ownerToken: string | null;
    mcpPublicBaseUrl: string | null;
    webPublicBaseUrl: string | null;
    allowedRedirectHosts: string[];
  };
  operations: {
    maxPayloadBytes: number;
  };
  process: {
    maxOutputBytes: number;
    defaultTimeoutMs: number;
    maxCompletedProcesses: number;
  };
}
