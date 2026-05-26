import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

export type WorkspaceStatusEntry = {
  path: string;
  index: string;
  workingTree: string;
  raw: string;
};

export type WorkspaceGitSnapshot = {
  root: string;
  exists: boolean;
  isGitRepo: boolean;
  capturedAt: string;
  error?: string;
  entries: WorkspaceStatusEntry[];
};

export type WorkspaceFileChange = {
  path: string;
  before: string | null;
  after: string | null;
  changeType: "added" | "removed" | "status_changed";
};

export type WorkspaceRunVisibility = {
  schema: "hiverunner.workspace_run_visibility.v1";
  capturedAt: string;
  readOnlyIntent: boolean;
  roots: Array<{
    root: string;
    exists: boolean;
    isGitRepo: boolean;
    beforeDirtyCount: number;
    afterDirtyCount: number;
    changedDuringRunCount: number;
    changedDuringRun: WorkspaceFileChange[];
    beforeEntries: WorkspaceStatusEntry[];
    afterEntries: WorkspaceStatusEntry[];
    warning: string | null;
    error?: string;
  }>;
  totals: {
    trackedRoots: number;
    gitRoots: number;
    beforeDirtyCount: number;
    afterDirtyCount: number;
    changedDuringRunCount: number;
  };
  warnings: string[];
};

const MAX_ENTRIES_PER_ROOT = 200;
const MAX_CHANGED_PER_ROOT = 80;

function uniqueRealRoots(roots: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const root of roots) {
    if (!root?.trim()) continue;
    const resolved = path.resolve(root);
    const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
    if (seen.has(real)) continue;
    seen.add(real);
    result.push(real);
  }
  return result;
}

function gitStatus(root: string): WorkspaceGitSnapshot {
  const capturedAt = new Date().toISOString();
  if (!fs.existsSync(root)) {
    return { root, exists: false, isGitRepo: false, capturedAt, entries: [], error: "workspace_missing" };
  }
  const inside = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return { root, exists: true, isGitRepo: false, capturedAt, entries: [] };
  }

  const topLevel = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  const gitRoot = topLevel.status === 0 && topLevel.stdout.trim()
    ? path.resolve(topLevel.stdout.trim())
    : root;

  const status = spawnSync("git", ["-C", gitRoot, "status", "--porcelain=v1"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 512 * 1024,
  });
  if (status.status !== 0) {
    return {
      root: gitRoot,
      exists: true,
      isGitRepo: true,
      capturedAt,
      entries: [],
      error: status.stderr.trim() || "git_status_failed",
    };
  }

  const entries = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, MAX_ENTRIES_PER_ROOT)
    .map((line) => ({
      raw: line,
      index: line.slice(0, 1).trim() || " ",
      workingTree: line.slice(1, 2).trim() || " ",
      path: line.slice(3).trim(),
    }))
    .filter((entry) => entry.path.length > 0);

  return {
    root: gitRoot,
    exists: true,
    isGitRepo: true,
    capturedAt,
    entries,
  };
}

export function captureWorkspaceGitSnapshots(roots: Array<string | null | undefined>): WorkspaceGitSnapshot[] {
  return uniqueRealRoots(roots).map(gitStatus);
}

function statusMap(entries: WorkspaceStatusEntry[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.path, `${entry.index}${entry.workingTree}`]));
}

function diffEntries(before: WorkspaceStatusEntry[], after: WorkspaceStatusEntry[]): WorkspaceFileChange[] {
  const beforeMap = statusMap(before);
  const afterMap = statusMap(after);
  const paths = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: WorkspaceFileChange[] = [];

  for (const filePath of Array.from(paths).sort()) {
    const beforeStatus = beforeMap.get(filePath) ?? null;
    const afterStatus = afterMap.get(filePath) ?? null;
    if (beforeStatus === afterStatus) continue;
    changes.push({
      path: filePath,
      before: beforeStatus,
      after: afterStatus,
      changeType: beforeStatus === null ? "added" : afterStatus === null ? "removed" : "status_changed",
    });
  }

  return changes.slice(0, MAX_CHANGED_PER_ROOT);
}

export function detectReadOnlyIntent(text: string): boolean {
  const normalized = text
    .replace(/\b(?:not|no longer|without)\s+(?:a\s+)?read[-\s]?only\b/gi, "")
    .replace(/\bread[-\s]?only\s+(?:warnings?|classifier|detector|label|labels|flag|flags|classification)\b/gi, "");

  return (
    /\bread[-\s]?only\b/i.test(normalized) ||
    /\bno file changes?\b/i.test(normalized) ||
    /\bwithout modifying\b/i.test(normalized) ||
    /\bdo not make (?:any )?(?:file )?changes?\b/i.test(normalized) ||
    /\bdo not (?:modify|change|edit|write) (?:any )?(?:files?|the workspace|the repo|the repository|repository)\b/i.test(normalized)
  );
}

export function buildWorkspaceRunVisibility(input: {
  before: WorkspaceGitSnapshot[];
  after: WorkspaceGitSnapshot[];
  readOnlyIntent?: boolean;
}): WorkspaceRunVisibility {
  const afterByRoot = new Map(input.after.map((snapshot) => [snapshot.root, snapshot]));
  const roots = input.before.map((before) => {
    const after = afterByRoot.get(before.root) ?? before;
    const changedDuringRun = before.isGitRepo && after.isGitRepo
      ? diffEntries(before.entries, after.entries)
      : [];
    const warning = input.readOnlyIntent && changedDuringRun.length > 0
      ? "This run looked read-only but the workspace changed during execution."
      : null;

    return {
      root: before.root,
      exists: before.exists,
      isGitRepo: before.isGitRepo && after.isGitRepo,
      beforeDirtyCount: before.entries.length,
      afterDirtyCount: after.entries.length,
      changedDuringRunCount: changedDuringRun.length,
      changedDuringRun,
      beforeEntries: before.entries,
      afterEntries: after.entries,
      warning,
      error: before.error ?? after.error,
    };
  });
  const warnings = roots.map((root) => root.warning).filter((warning): warning is string => Boolean(warning));

  return {
    schema: "hiverunner.workspace_run_visibility.v1",
    capturedAt: new Date().toISOString(),
    readOnlyIntent: Boolean(input.readOnlyIntent),
    roots,
    totals: {
      trackedRoots: roots.length,
      gitRoots: roots.filter((root) => root.isGitRepo).length,
      beforeDirtyCount: roots.reduce((sum, root) => sum + root.beforeDirtyCount, 0),
      afterDirtyCount: roots.reduce((sum, root) => sum + root.afterDirtyCount, 0),
      changedDuringRunCount: roots.reduce((sum, root) => sum + root.changedDuringRunCount, 0),
    },
    warnings,
  };
}
