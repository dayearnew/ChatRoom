import { computed, ref, watch, type WatchSource } from "vue";
import {
  api,
  type GitBranch,
  type GitChange,
  type GitCommit,
  type GitDiff,
  type GitStatus,
} from "../api.js";
import { errorMessage } from "../utils/errors.js";
import { createRequestGate } from "../utils/requests.js";

export function useWorkspaceGit(root: WatchSource<string>) {
  const status = ref<GitStatus | null>(null);
  const branches = ref<GitBranch[]>([]);
  const commits = ref<GitCommit[]>([]);
  const selectedPath = ref<string | null>(null);
  const diff = ref<GitDiff | null>(null);
  const loading = ref(false);
  const diffLoading = ref(false);
  const busy = ref<string | null>(null);
  const error = ref("");
  let generation = 0;
  const loadRequests = createRequestGate();
  const diffRequests = createRequestGate();

  const currentRoot = () =>
    typeof root === "function" ? root() : String(root.value ?? "");
  const changes = computed(() => status.value?.changes ?? []);
  const selectedChange = computed(
    () =>
      changes.value.find((change) => change.path === selectedPath.value) ??
      null,
  );
  const stagedPaths = computed(() =>
    changes.value.filter(isStaged).map((change) => change.path),
  );
  const unstagedPaths = computed(() =>
    changes.value.filter(isUnstaged).map((change) => change.path),
  );

  watch(
    root,
    () => {
      generation += 1;
      loadRequests.invalidate();
      diffRequests.invalidate();
      selectedPath.value = null;
      diff.value = null;
      void load();
    },
    { immediate: true },
  );
  watch(selectedPath, () => void loadDiff());

  async function load() {
    const generationAtStart = ++generation;
    const request = loadRequests.begin();
    const targetRoot = currentRoot();
    loading.value = true;
    error.value = "";
    try {
      const next = await api<GitStatus | null>(
        `/git/status?root=${encodeURIComponent(targetRoot)}`,
        { signal: request.signal },
      );
      if (
        generationAtStart !== generation ||
        !loadRequests.isCurrent(request) ||
        currentRoot() !== targetRoot
      )
        return;
      status.value = next;
      if (!next) {
        branches.value = [];
        commits.value = [];
        selectedPath.value = null;
        diff.value = null;
        return;
      }
      await loadAncillary(generationAtStart, targetRoot, request.signal);
      if (
        generationAtStart !== generation ||
        !loadRequests.isCurrent(request) ||
        currentRoot() !== targetRoot
      )
        return;
      normalizeSelection();
      await loadDiff();
    } catch (cause) {
      if (
        generationAtStart === generation &&
        loadRequests.isCurrent(request) &&
        currentRoot() === targetRoot
      )
        error.value = errorMessage(cause);
    } finally {
      if (
        generationAtStart === generation &&
        loadRequests.isCurrent(request) &&
        currentRoot() === targetRoot
      )
        loading.value = false;
    }
  }

  async function loadAncillary(
    generationAtStart: number,
    targetRoot: string,
    signal?: AbortSignal,
  ) {
    const encoded = encodeURIComponent(targetRoot);
    const options = signal ? { signal } : {};
    const [nextBranches, nextCommits] = await Promise.all([
      api<GitBranch[]>(`/git/branches?root=${encoded}`, options),
      api<GitCommit[]>(`/git/log?root=${encoded}&limit=20`, options),
    ]);
    if (generationAtStart !== generation || currentRoot() !== targetRoot)
      return;
    branches.value = nextBranches;
    commits.value = nextCommits;
  }

  async function loadDiff() {
    const path = selectedPath.value;
    const targetRoot = currentRoot();
    if (!path || !status.value?.head) {
      diffRequests.invalidate();
      diffLoading.value = false;
      diff.value = null;
      return;
    }
    const request = diffRequests.begin();
    diffLoading.value = true;
    try {
      const next = await api<GitDiff>(
        `/git/diff?root=${encodeURIComponent(targetRoot)}&path=${encodeURIComponent(path)}`,
        { signal: request.signal },
      );
      if (
        diffRequests.isCurrent(request) &&
        currentRoot() === targetRoot &&
        selectedPath.value === path
      )
        diff.value = next;
    } catch (cause) {
      if (diffRequests.isCurrent(request) && currentRoot() === targetRoot) {
        diff.value = null;
        error.value = errorMessage(cause);
      }
    } finally {
      if (diffRequests.isCurrent(request) && currentRoot() === targetRoot)
        diffLoading.value = false;
    }
  }

  async function mutate(
    key: string,
    endpoint: string,
    method: "POST" | "DELETE",
    body: Record<string, unknown>,
    timeoutMs = 60_000,
  ): Promise<boolean> {
    if (busy.value) return false;
    const targetRoot = currentRoot();
    const request = ++generation;
    loadRequests.invalidate();
    diffRequests.invalidate();
    loading.value = false;
    diffLoading.value = false;
    busy.value = key;
    error.value = "";
    try {
      const next = await api<GitStatus>(endpoint, {
        method,
        body: JSON.stringify({ root: targetRoot, ...body }),
        timeoutMs,
      });
      if (request !== generation || currentRoot() !== targetRoot) return false;
      status.value = next;
      normalizeSelection();
      await loadAncillary(request, targetRoot);
      if (request !== generation || currentRoot() !== targetRoot) return false;
      await loadDiff();
      return true;
    } catch (cause) {
      if (request === generation && currentRoot() === targetRoot)
        error.value = errorMessage(cause);
      return false;
    } finally {
      if (request === generation && currentRoot() === targetRoot)
        busy.value = null;
    }
  }

  async function stage(paths: string[]) {
    return paths.length
      ? mutate("stage", "/git/stage", "POST", { paths })
      : false;
  }

  async function unstage(paths: string[]) {
    return paths.length
      ? mutate("unstage", "/git/unstage", "POST", { paths })
      : false;
  }

  function restore(path: string) {
    return mutate("restore", "/git/restore", "POST", { path });
  }

  function commit(message: string) {
    return mutate("commit", "/git/commit", "POST", { message });
  }

  function createBranch(name: string) {
    return mutate("branch", "/git/branches", "POST", { name });
  }

  function switchBranch(name: string) {
    return mutate("branch", "/git/switch", "POST", { name });
  }

  function deleteBranch(name: string) {
    return mutate("branch", "/git/branches", "DELETE", { name });
  }

  function remote(action: "fetch" | "pull" | "push") {
    return mutate(action, `/git/${action}`, "POST", {}, 5 * 60_000);
  }

  function normalizeSelection() {
    if (!changes.value.some((change) => change.path === selectedPath.value))
      selectedPath.value = changes.value[0]?.path ?? null;
  }

  return {
    status,
    branches,
    commits,
    selectedPath,
    diff,
    loading,
    diffLoading,
    busy,
    error,
    changes,
    selectedChange,
    stagedPaths,
    unstagedPaths,
    load,
    stage,
    unstage,
    restore,
    commit,
    createBranch,
    switchBranch,
    deleteBranch,
    remote,
    isStaged,
    isUnstaged,
    statusCode,
  };
}

export function isStaged(change: GitChange): boolean {
  return change.indexStatus !== " " && change.indexStatus !== "?";
}

export function isUnstaged(change: GitChange): boolean {
  return (
    change.indexStatus === "?" ||
    (change.workingTreeStatus !== " " && change.workingTreeStatus !== "?")
  );
}

export function statusCode(change: GitChange): string {
  return `${change.indexStatus}${change.workingTreeStatus}`.replaceAll(
    " ",
    "·",
  );
}
