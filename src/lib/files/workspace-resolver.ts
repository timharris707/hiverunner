import fs from "fs";
import path from "path";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";

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

  // Alias-aware company workspace resolution.
  try {
    const resolved = resolveCompanyIdBySlug(workspace);
    if (resolved?.workspace_root?.trim()) {
      return resolved.workspace_root.trim();
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
