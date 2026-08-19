import { en, zhHans } from "vuetify/locale";

export type AppLocale = "en" | "zhHans";

const enChatRoom = {
  nav: {
    operations: "Operations",
    workspaces: "Workspaces",
    processes: "Processes",
    cloud: "Cloud",
  },
  cloud: {
    inactive: "Not activated",
    inactiveDescription: "Purchase or restore ChatRoom Cloud to continue.",
    purchase: "Purchase",
    manage: "Manage",
    refresh: "Refresh",
    restore: "Restore subscription",
    recoveryKey: "Recovery key",
    restoreAction: "Restore",
    subscription: "Subscription",
    active: "Active",
    expires: "Expires",
    installationId: "Installation ID",
    remoteMcp: "Remote MCP",
    remoteMcpDescription: "Expose MCP through ChatRoom Cloud.",
    remoteWeb: "Remote WebUI",
    remoteWebDescription: "Expose the ChatRoom WebUI through ChatRoom Cloud.",
    disableMcpTitle: "Disable remote MCP?",
    disableMcpDescription:
      "Remote MCP access will stop until you enable it again from this page.",
    disableWebTitle: "Disable remote WebUI?",
    disableWebDescription:
      "The current remote WebUI address will stop working immediately. You will not be able to use that address to return here and re-enable remote access; use the local WebUI instead.",
    disableConfirm: "Disable",
    connection: {
      inactive: "Inactive",
      connecting: "Connecting",
      connected: "Connected",
      disconnected: "Disconnected",
      error: "Error",
    },
  },
  runtime: {
    version: "Version",
    mcpRequests: "MCP requests",
    uptime: "Uptime",
    uptimeHoursMinutes: "{0} h {1} min",
  },
  common: {
    connected: "Connected",
    signOut: "Sign out",
    language: "Language",
    theme: "Theme",
    cancel: "Cancel",
    close: "Close",
  },
  theme: { system: "Follow system", light: "Light", dark: "Dark" },
  auth: {
    ownerAccess: "Owner access",
    ownerToken: "Owner token",
    signIn: "Sign in",
    signInWithPasskey: "Sign in with passkey",
    orToken: "or use owner token",
    rememberDevice: "Keep me signed in for 30 days",
    passkeys: "Passkeys",
    passkeyDescription:
      "Use Face ID, Touch ID, Windows Hello, or a security key.",
    passkeyName: "Passkey name",
    thisDevice: "This device",
    addPasskey: "Add passkey",
    removePasskey: "Remove passkey",
    noPasskeys: "No passkeys registered.",
    lastUsed: "Last used",
  },
  operations: {
    title: "Plugin operations",
    subtitle: "Operations produced by ChatRoom plugins",
    all: "All",
    running: "Running",
    errors: "Errors",
    success: "Success",
    empty: "No operations yet.",
    select: "Select an operation to inspect details.",
    clear: "Clear history",
    clearTitle: "Clear operation history?",
    clearDescription:
      "Completed operation records will be permanently deleted. Running operations are preserved until they finish.",
    clearConfirm: "Clear history",
  },
  table: {
    time: "Time",
    action: "Action",
    plugin: "Plugin",
    source: "Source",
    status: "Status",
    duration: "Duration",
  },
  detail: {
    plugin: "Plugin",
    duration: "Duration",
    workspace: "Workspace",
    process: "Process",
    input: "Input",
    output: "Output",
    error: "Error",
  },
  workspaces: {
    lastActivity: "Last activity",
    git: "Git",
    files: "Files",
    skills: "Skills",
    select: "Select a workspace.",
    dirty: "Dirty",
    clean: "Clean",
    isolatedWorktree: "Isolated worktree",
    checkout: "Checkout",
    worktree: "Worktree",
    diff: "Diff",
    worktreeChanges: "Worktree changes",
    worktreeChangesDescription:
      "Review the isolated changes before applying them to the source checkout.",
    pendingFiles: "pending",
    appliedFiles: "applied",
    conflictFiles: "conflicts",
    applied: "Applied",
    mergeConflict: "Conflict",
    approveAll: "Approve all",
    approveFile: "Approve file",
    applyTitle: "Apply worktree changes?",
    applyDescription:
      "The current worktree changes will be applied to the source checkout as uncommitted, unstaged changes. The worktree will be kept.",
    applyFileTitle: "Apply this file?",
    applyFileDescription:
      "Only this file will be applied to the source checkout as an uncommitted, unstaged change. Other worktree files will remain pending.",
    applySuccess:
      "Changes were applied to the source checkout and remain uncommitted. The worktree is still available.",
    applyPartialSuccess:
      "{0} conflicting file(s) were skipped. All mergeable files were applied and remain uncommitted.",
    applyMergeConflicts:
      "All remaining files have real three-way merge conflicts. Resolve the conflicting files before applying them.",
    mergeConflictsWarning:
      "{0} file(s) have merge conflicts. Approve all will apply only the mergeable files and leave conflicts untouched.",
    mergeConflictDescription:
      "Git detected a real three-way merge conflict for this file. ChatRoom will not write conflict markers or overwrite the source checkout.",
    applyHeadMismatch:
      "The source checkout HEAD no longer matches this worktree. Automatic apply is blocked.",
    noWorktreeChanges: "This worktree has no changes to apply.",
    diffTruncated:
      "The diff preview is truncated. Apply still uses the complete Git patch.",
    binary: "Binary",
    binaryShort: "BIN",
  },
  files: {
    select: "Select a file",
    readOnly: "File browsing is read-only.",
    file: "File",
    directory: "Directory",
    symlink: "Symbolic link",
    previewUnavailable: "Preview not available",
  },
  skills: { empty: "No mounted skills." },
  processes: {
    title: "Processes",
    subtitle: "Supervised commands and their current state",
    command: "Command",
    fullCommand: "Full command",
    state: "State",
    started: "Started",
    duration: "Duration",
    terminate: "Terminate",
    kill: "Kill",
    moreActions: "More actions",
    empty: "No supervised processes.",
    exit: "Exit",
    timeout: "Timeout",
    yes: "yes",
    no: "no",
    select: "Select a process to inspect output.",
  },
  code: { search: "Search", noOutput: "No output." },
  sources: { mcp: "Model", gui: "Web UI", cli: "CLI", system: "Runtime" },
  statuses: {
    running: "Running",
    success: "Success",
    exited: "Exited",
    error: "Error",
    failed: "Failed",
    cancelled: "Cancelled",
    killed: "Killed",
  },
  actions: {
    openWorkspace: "Open workspace",
    removeWorkspace: "Remove workspace",
    applyWorktree: "Apply worktree changes",
    readFile: "Read file",
    writeFile: "Write file",
    listFiles: "List files",
    searchFiles: "Search files",
    patchFiles: "Apply file patch",
    startProcess: "Start process",
    readProcess: "Read process output",
    writeProcess: "Write process input",
    stopProcess: "Stop process",
    terminateProcess: "Terminate process",
    forceStopProcess: "Force stop process",
    syncCloud: "Sync Cloud status",
    manageCloud: "Open Cloud management",
    restoreCloud: "Restore Cloud subscription",
    replaceRecoveryKey: "Replace recovery key",
    setCloudService: "Set Cloud service",
  },
};

const zhChatRoom: typeof enChatRoom = {
  nav: {
    operations: "操作日志",
    workspaces: "工作区",
    processes: "进程",
    cloud: "Cloud",
  },
  cloud: {
    inactive: "尚未启用",
    inactiveDescription: "购买或恢复 ChatRoom Cloud 后即可使用。",
    purchase: "购买",
    manage: "管理",
    refresh: "刷新",
    restore: "恢复订阅",
    recoveryKey: "恢复密钥",
    restoreAction: "恢复",
    subscription: "订阅状态",
    active: "已生效",
    expires: "到期时间",
    installationId: "安装 ID",
    remoteMcp: "远程 MCP",
    remoteMcpDescription: "通过 ChatRoom Cloud 暴露 MCP。",
    remoteWeb: "远程 WebUI",
    remoteWebDescription: "通过 ChatRoom Cloud 暴露 ChatRoom WebUI。",
    disableMcpTitle: "关闭远程 MCP？",
    disableMcpDescription:
      "关闭后将停止远程 MCP 访问，重新开启后才能继续使用。",
    disableWebTitle: "关闭远程 WebUI？",
    disableWebDescription:
      "关闭后，当前远程 WebUI 地址将立即无法访问，也无法再通过该地址返回此页面重新开启。请通过本地 WebUI 重新开启远程访问。",
    disableConfirm: "关闭",
    connection: {
      inactive: "未启用",
      connecting: "连接中",
      connected: "已连接",
      disconnected: "已断开",
      error: "错误",
    },
  },
  runtime: {
    version: "运行时版本",
    mcpRequests: "MCP 请求",
    uptime: "运行时间",
    uptimeHoursMinutes: "{0} 小时 {1} 分钟",
  },
  common: {
    connected: "已连接",
    signOut: "退出登录",
    language: "语言",
    theme: "主题",
    cancel: "取消",
    close: "关闭",
  },
  theme: { system: "跟随系统", light: "浅色", dark: "深色" },
  auth: {
    ownerAccess: "所有者访问",
    ownerToken: "所有者令牌",
    signIn: "登录",
    signInWithPasskey: "使用通行密钥登录",
    orToken: "或使用所有者令牌",
    rememberDevice: "在此设备保持登录 30 天",
    passkeys: "通行密钥",
    passkeyDescription:
      "使用 Face ID、Touch ID、Windows Hello 或安全密钥登录。",
    passkeyName: "通行密钥名称",
    thisDevice: "此设备",
    addPasskey: "添加通行密钥",
    removePasskey: "删除通行密钥",
    noPasskeys: "尚未注册通行密钥。",
    lastUsed: "最近使用",
  },
  operations: {
    title: "插件操作日志",
    subtitle: "ChatRoom 各插件产生的操作记录",
    all: "全部",
    running: "运行中",
    errors: "错误",
    success: "成功",
    empty: "暂无操作记录。",
    select: "选择一条操作查看详情。",
    clear: "清空记录",
    clearTitle: "清空操作记录？",
    clearDescription:
      "已完成的操作记录将被永久删除。正在运行的操作会保留，直到操作结束。",
    clearConfirm: "清空记录",
  },
  table: {
    time: "时间",
    action: "操作",
    plugin: "插件",
    source: "来源",
    status: "状态",
    duration: "耗时",
  },
  detail: {
    plugin: "插件",
    duration: "耗时",
    workspace: "工作区",
    process: "进程",
    input: "输入",
    output: "输出",
    error: "错误",
  },
  workspaces: {
    lastActivity: "最近活动",
    git: "Git",
    files: "文件",
    skills: "技能",
    select: "请选择工作区。",
    dirty: "有修改",
    clean: "干净",
    isolatedWorktree: "隔离工作区",
    checkout: "Checkout",
    worktree: "Worktree",
    diff: "Diff",
    worktreeChanges: "Worktree 修改",
    worktreeChangesDescription:
      "审核隔离 Worktree 中的修改，确认后再应用到源 Checkout。",
    pendingFiles: "待应用",
    appliedFiles: "已应用",
    conflictFiles: "冲突",
    applied: "已应用",
    mergeConflict: "冲突",
    approveAll: "批准全部",
    approveFile: "批准此文件",
    applyTitle: "应用 Worktree 修改？",
    applyDescription:
      "当前 Worktree 的修改会应用到源 Checkout，并保持为未提交、未暂存状态。Worktree 会继续保留。",
    applyFileTitle: "应用这个文件？",
    applyFileDescription:
      "只把当前文件应用到源 Checkout，并保持为未提交、未暂存状态。其他 Worktree 文件继续保持待应用。",
    applySuccess:
      "修改已应用到源 Checkout，并保持未提交状态。Worktree 仍然保留。",
    applyPartialSuccess:
      "已应用所有可自动合并的文件；{0} 个冲突文件保持原样，未写入源 Checkout。",
    applyMergeConflicts:
      "剩余文件都存在真实的三方合并冲突，需要先处理冲突后再应用。",
    mergeConflictsWarning:
      "有 {0} 个文件存在合并冲突。“批准全部”只会应用可自动合并的文件，冲突文件保持不动。",
    mergeConflictDescription:
      "Git 检测到该文件存在真实三方合并冲突。ChatRoom 不会写入冲突标记，也不会覆盖源 Checkout。",
    applyHeadMismatch:
      "源 Checkout 的 HEAD 已与当前 Worktree 不一致，已阻止自动应用。",
    noWorktreeChanges: "当前 Worktree 没有可应用的修改。",
    diffTruncated: "Diff 预览已截断；实际应用时仍会使用完整 Git Patch。",
    binary: "二进制",
    binaryShort: "BIN",
  },
  files: {
    select: "选择文件",
    readOnly: "文件浏览为只读。",
    file: "文件",
    directory: "目录",
    symlink: "符号链接",
    previewUnavailable: "暂不支持预览",
  },
  skills: { empty: "未挂载技能。" },
  processes: {
    title: "进程",
    subtitle: "受监管命令及其当前状态",
    command: "命令",
    fullCommand: "完整命令",
    state: "状态",
    started: "启动时间",
    duration: "耗时",
    terminate: "终止",
    kill: "强制结束",
    moreActions: "更多操作",
    empty: "暂无受监管进程。",
    exit: "退出码",
    timeout: "超时",
    yes: "是",
    no: "否",
    select: "选择一个进程查看输出。",
  },
  code: { search: "搜索", noOutput: "暂无输出。" },
  sources: { mcp: "模型", gui: "网页界面", cli: "命令行", system: "运行时" },
  statuses: {
    running: "运行中",
    success: "成功",
    exited: "已退出",
    error: "错误",
    failed: "失败",
    cancelled: "已取消",
    killed: "已结束",
  },
  actions: {
    openWorkspace: "打开工作区",
    removeWorkspace: "删除工作区",
    applyWorktree: "应用 Worktree 修改",
    readFile: "读取文件",
    writeFile: "写入文件",
    listFiles: "列出文件",
    searchFiles: "搜索文件",
    patchFiles: "应用文件补丁",
    startProcess: "启动进程",
    readProcess: "读取进程输出",
    writeProcess: "写入进程输入",
    stopProcess: "停止进程",
    terminateProcess: "终止进程",
    forceStopProcess: "强制结束进程",
    syncCloud: "同步 Cloud 状态",
    manageCloud: "打开 Cloud 管理页面",
    restoreCloud: "恢复 Cloud 订阅",
    replaceRecoveryKey: "更换恢复密钥",
    setCloudService: "设置 Cloud 服务",
  },
};

export const chatroomLocaleMessages = {
  en: { ...en, chatroom: enChatRoom },
  zhHans: { ...zhHans, chatroom: zhChatRoom },
};

const actionKeys: Record<string, string> = {
  open: "openWorkspace",
  remove: "removeWorkspace",
  "worktree.apply": "applyWorktree",
  "fs.read": "readFile",
  "fs.write": "writeFile",
  "fs.list": "listFiles",
  "fs.search": "searchFiles",
  "fs.patch": "patchFiles",
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
