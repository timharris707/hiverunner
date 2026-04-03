import fs from "fs";
import path from "path";
import { getOrchestrationDb } from "@/lib/orchestration/db";

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/Users/timharris/.openclaw";

const WORKSPACE_MAP: Record<string, string> = {
  workspace: path.join(OPENCLAW_DIR, "workspace"),
  "mission-control": path.join(OPENCLAW_DIR, "workspace", "mission-control"),
};

export function resolveWorkspaceBase(inputWorkspace?: string | null): string | null {
  const workspace = (inputWorkspace || "workspace").trim();
  if (!workspace) return null;

  if (path.isAbsolute(workspace)) {
    return workspace;
  }

  const mapped = WORKSPACE_MAP[workspace];
  if (mapped) {
    return mapped;
  }

  try {
    const db = getOrchestrationDb();
    const company = db
      .prepare("SELECT workspace_root FROM companies WHERE slug = ? AND archived_at IS NULL LIMIT 1")
      .get(workspace) as { workspace_root?: string | null } | undefined;

    if (company?.workspace_root?.trim()) {
      return company.workspace_root.trim();
    }
  } catch (error) {
    console.warn("[workspace-resolver] Failed to resolve company workspace:", error);
  }

  return path.join(OPENCLAW_DIR, workspace);
}

export function resolveWorkspacePath(inputWorkspace: string | null | undefined, targetPath = ""): { base: string; fullPath: string } | null {
  const base = resolveWorkspaceBase(inputWorkspace);
  if (!base) return null;

  const safeTarget = path.normalize(targetPath || "");
  const fullPath = path.resolve(base, safeTarget);

  if (!fullPath.startsWith(base)) {
    return null;
  }

  return { base, fullPath };
}

export function workspaceExists(inputWorkspace?: string | null): boolean {
  const base = resolveWorkspaceBase(inputWorkspace);
  return Boolean(base && fs.existsSync(base));
}
