import fs from "fs";
import path from "path";

import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  resolveLegacyOpenClawAgentWorkspacePath,
  resolveCompanyProjectWorkspacePath,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { isPathContained } from "@/lib/workspaces/delete-safety";
import { resolveScopedFileWorkspaceBase } from "@/lib/files/workspace-registry";
import {
  resolveHiveRunnerWorkspaceRoot,
  resolveOpenClawDir,
} from "@/lib/workspaces/root";

function resolveProjectWorkspaceBase(workspace: string): string | null {
  if (!workspace.startsWith("project-")) {
    return null;
  }

  const projectIdOrSlug = workspace.slice("project-".length).trim();
  if (!projectIdOrSlug) {
    return null;
  }

  try {
    const db = getOrchestrationDb();
    const byId = db.prepare(
      `SELECT
         p.id,
         p.slug,
         p.name,
         c.id AS company_id,
         c.workspace_slug,
         c.workspace_root,
         c.workspace_source
       FROM projects p
       INNER JOIN companies c ON c.id = p.company_id
       WHERE p.id = ?
         AND p.archived_at IS NULL
         AND c.archived_at IS NULL
       LIMIT 1`
    ).get(projectIdOrSlug) as
      | {
          id: string;
          slug: string;
          name: string;
          company_id: string;
          workspace_slug: string | null;
          workspace_root: string | null;
          workspace_source: string | null;
        }
      | undefined;

    const row =
      byId ??
      (() => {
        const matches = db.prepare(
          `SELECT
             p.id,
             p.slug,
             p.name,
             c.id AS company_id,
             c.workspace_slug,
             c.workspace_root,
             c.workspace_source
           FROM projects p
           INNER JOIN companies c ON c.id = p.company_id
           WHERE p.slug = ?
             AND p.archived_at IS NULL
             AND c.archived_at IS NULL
           LIMIT 2`
        ).all(projectIdOrSlug) as Array<{
          id: string;
          slug: string;
          name: string;
          company_id: string;
          workspace_slug: string | null;
          workspace_root: string | null;
          workspace_source: string | null;
        }>;
        return matches.length === 1 ? matches[0] : undefined;
      })();

    if (!row) {
      return null;
    }

    const companyWorkspaceRoot = resolveCompanyWorkspaceRoot({
      companyId: row.company_id,
      workspaceSlug: row.workspace_slug,
      workspaceRoot: row.workspace_root,
      workspaceSource: row.workspace_source,
    });

    return resolveCompanyProjectWorkspacePath(companyWorkspaceRoot, {
      slug: row.slug,
      name: row.name,
    }).path;
  } catch (error) {
    console.warn("[workspace-resolver] Failed to resolve project workspace:", error);
    return null;
  }
}

function resolveLegacyProjectWorkspaceBase(workspace: string): string | null {
  if (!workspace.startsWith("project-")) {
    return null;
  }

  const projectIdOrSlug = workspace.slice("project-".length).trim();
  if (!projectIdOrSlug) {
    return null;
  }

  return resolveScopedFileWorkspaceBase(`project:${projectIdOrSlug}:files`);
}

function resolveLegacyWorkspaceAlias(workspace: string): string | null {
  if (workspace === "workspace") {
    return resolveHiveRunnerWorkspaceRoot();
  }

  // Keep accepting the old workspace selector so saved links do not break.
  if (workspace === "hiverunner" || workspace === "mission-control") {
    return resolveHiveRunnerWorkspaceRoot();
  }

  if (workspace.startsWith("workspace-")) {
    const agentSlug = workspace.slice("workspace-".length).trim();
    if (!agentSlug) {
      return path.join(resolveOpenClawDir(), workspace);
    }
    return resolveLegacyOpenClawAgentWorkspacePath(agentSlug).path;
  }

  return null;
}

export function resolveWorkspaceBase(inputWorkspace?: string | null): string | null {
  const workspace = (inputWorkspace || "workspace").trim();
  if (!workspace) return null;

  const scopedWorkspace = resolveScopedFileWorkspaceBase(workspace);
  if (scopedWorkspace) {
    return scopedWorkspace;
  }

  if (path.isAbsolute(workspace)) {
    if (
      isPathContained(resolveHiveRunnerWorkspaceRoot(), workspace) ||
      isPathContained(resolveOpenClawDir(), workspace)
    ) {
      return path.resolve(workspace);
    }
    return null;
  }

  const projectWorkspace = resolveLegacyProjectWorkspaceBase(workspace) ?? resolveProjectWorkspaceBase(workspace);
  if (projectWorkspace) {
    return projectWorkspace;
  }
  if (workspace.startsWith("project-")) {
    return null;
  }

  const mapped = resolveLegacyWorkspaceAlias(workspace);
  if (mapped) {
    if (workspace === "workspace" || workspace === "hiverunner" || workspace === "mission-control" || workspace.startsWith("workspace-")) {
      return mapped;
    }
  }

  try {
    const resolved = resolveCompanyIdBySlug(workspace);
    if (resolved) {
      return resolveCompanyWorkspaceRoot({
        companyId: resolved.id,
        workspaceSlug: resolved.workspace_slug,
        workspaceRoot: resolved.workspace_root,
        workspaceSource: resolved.workspace_source,
      });
    }
  } catch (error) {
    console.warn("[workspace-resolver] Failed to resolve company workspace:", error);
  }

  return mapped;
}

export function resolveWorkspacePath(inputWorkspace: string | null | undefined, targetPath = ""): { base: string; fullPath: string } | null {
  const base = resolveWorkspaceBase(inputWorkspace);
  if (!base) return null;

  const safeTarget = path.normalize(targetPath || "");
  const fullPath = path.resolve(base, safeTarget);

  if (!isPathContained(base, fullPath)) {
    return null;
  }

  return { base, fullPath };
}

function nearestExistingParent(candidatePath: string): string | null {
  let current = path.resolve(candidatePath);
  while (current && current !== path.dirname(current)) {
    try {
      if (fs.statSync(current).isDirectory()) {
        return current;
      }
    } catch {
      // Keep walking upward.
    }
    current = path.dirname(current);
  }
  return null;
}

export function resolveWorkspacePathStrict(
  inputWorkspace: string | null | undefined,
  targetPath = "",
  options: { forWrite?: boolean } = {},
): { base: string; fullPath: string; realBase: string } | null {
  if (options.forWrite && (inputWorkspace || "").trim().endsWith(":source")) {
    return null;
  }

  const resolved = resolveWorkspacePath(inputWorkspace, targetPath);
  if (!resolved) return null;

  let realBase: string;
  try {
    realBase = fs.realpathSync(resolved.base);
  } catch {
    return null;
  }

  if (options.forWrite) {
    try {
      if (fs.lstatSync(resolved.fullPath).isSymbolicLink()) {
        return null;
      }
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : null;
      if (code !== "ENOENT") return null;
    }

    const parent = nearestExistingParent(path.dirname(resolved.fullPath));
    if (!parent) return null;
    let realParent: string;
    try {
      realParent = fs.realpathSync(parent);
    } catch {
      return null;
    }
    if (!isPathContained(realBase, realParent)) return null;
    return { ...resolved, realBase };
  }

  try {
    if (fs.lstatSync(resolved.fullPath).isSymbolicLink()) {
      return null;
    }
    const realTarget = fs.realpathSync(resolved.fullPath);
    if (!isPathContained(realBase, realTarget)) {
      return null;
    }
  } catch {
    return null;
  }

  return { ...resolved, realBase };
}

export function workspaceExists(inputWorkspace?: string | null): boolean {
  const base = resolveWorkspaceBase(inputWorkspace);
  return Boolean(base && fs.existsSync(base));
}
