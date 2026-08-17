import os from "node:os";
import path from "node:path";

export interface PlatformPaths {
  configFile: string;
  dataDir: string;
  databaseFile: string;
}

export function platformPaths(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): PlatformPaths {
  if (platform === "win32") {
    const join = path.win32.join;
    const roaming = env.APPDATA ?? join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return {
      configFile: join(roaming, "ChatRoom", "config.json"),
      dataDir: join(local, "ChatRoom", "Data"),
      databaseFile: join(local, "ChatRoom", "State", "chatroom.sqlite"),
    };
  }

  const join = path.posix.join;
  if (platform === "darwin") {
    const applicationSupport = join(
      home,
      "Library",
      "Application Support",
      "ChatRoom",
    );
    return {
      configFile: join(applicationSupport, "config.json"),
      dataDir: join(applicationSupport, "Data"),
      databaseFile: join(applicationSupport, "State", "chatroom.sqlite"),
    };
  }

  const configHome = absoluteXdg(env.XDG_CONFIG_HOME) ?? join(home, ".config");
  const dataHome =
    absoluteXdg(env.XDG_DATA_HOME) ?? join(home, ".local", "share");
  const stateHome =
    absoluteXdg(env.XDG_STATE_HOME) ?? join(home, ".local", "state");
  return {
    configFile: join(configHome, "chatroom", "config.json"),
    dataDir: join(dataHome, "chatroom"),
    databaseFile: join(stateHome, "chatroom", "chatroom.sqlite"),
  };
}

function absoluteXdg(value: string | undefined): string | null {
  return value && path.posix.isAbsolute(value) ? value : null;
}
