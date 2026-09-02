export const DATABASE_SCHEMA_VERSION = 1;

export const DATABASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS operations (
    operation_id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    source TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    process_id TEXT,
    input_json TEXT NOT NULL,
    output_json TEXT NOT NULL,
    error_json TEXT NOT NULL,
    input_truncated INTEGER NOT NULL DEFAULT 0,
    output_truncated INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS operations_started_idx ON operations(started_at DESC);
  CREATE INDEX IF NOT EXISTS operations_plugin_idx ON operations(plugin_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS operations_status_idx ON operations(status, started_at DESC);

  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    redirect_uris_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS oauth_code_expiry_idx ON oauth_codes(expires_at);
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    token_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS oauth_token_expiry_idx ON oauth_tokens(expires_at);
  CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS oauth_refresh_expiry_idx ON oauth_refresh_tokens(expires_at);

  CREATE TABLE IF NOT EXISTS web_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS web_session_expiry_idx ON web_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS passkeys (
    credential_id TEXT PRIMARY KEY,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports_json TEXT NOT NULL,
    device_type TEXT NOT NULL CHECK(device_type IN ('singleDevice','multiDevice')),
    backed_up INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS passkeys_last_used_idx ON passkeys(last_used_at DESC);

  CREATE TABLE IF NOT EXISTS computer_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    remote_access INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

`;
