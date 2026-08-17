const CHILD_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TERM",
  "COLORTERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  "NVM_DIR",
  "NVM_BIN",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
]);

export function childEnvironment(
  overrides: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      (CHILD_ENV_KEYS.has(key) || key.startsWith("LC_"))
    )
      env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides ?? {})) env[key] = value;
  return env;
}
