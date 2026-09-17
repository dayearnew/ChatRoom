import type { AppLocale } from "./types.js";

const actionKeys: Record<string, string> = {
  info: "workspaceInfo",
  "git.stage": "gitStage",
  "git.unstage": "gitUnstage",
  "git.restore": "gitRestore",
  "git.commit": "gitCommit",
  "git.branch.create": "gitBranchCreate",
  "git.branch.switch": "gitBranchSwitch",
  "git.branch.delete": "gitBranchDelete",
  "git.fetch": "gitFetch",
  "git.pull": "gitPull",
  "git.push": "gitPush",
  start: "startProcess",
  read: "readProcess",
  write: "writeProcess",
  terminate: "terminateProcess",
  kill: "forceStopProcess",
  sync: "syncCloud",
  management: "manageCloud",
  restore: "restoreCloud",
  "recovery-key.replace": "replaceRecoveryKey",
  "service.set": "setCloudService",
};

export function initialAppLocale(): AppLocale {
  const stored = window.localStorage.getItem("chatroom.locale");
  if (stored === "en" || stored === "zhHans") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zhHans" : "en";
}

export function actionMessageKey(action: string): string | null {
  const key = actionKeys[action];
  return key ? `$vuetify.chatroom.actions.${key}` : null;
}

export function sourceMessageKey(source: string): string | null {
  return ["mcp", "gui", "cli", "system"].includes(source)
    ? `$vuetify.chatroom.sources.${source}`
    : null;
}

export function statusMessageKey(status: string): string | null {
  return [
    "running",
    "success",
    "exited",
    "error",
    "failed",
    "cancelled",
    "killed",
  ].includes(status)
    ? `$vuetify.chatroom.statuses.${status}`
    : null;
}

export function humanizeAction(action: string): string {
  return action
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function appIntlLocale(locale: string): string {
  return locale === "zhHans" ? "zh-CN" : "en-US";
}
