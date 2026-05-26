import path from "path";

import {
  resolveHiveRunnerWorkspaceRoot,
  resolveOpenClawDir,
  resolveOpenClawWorkspaceRoot,
} from "@/lib/workspaces/root";

export type CompanyWorkspaceDeletionClassification =
  | "hiverunner"
  | "legacy-openclaw-company"
  | "legacy-openclaw-agent-workspace"
  | "default-openclaw-workspace"
  | "external";

export function isPathContained(rootPath: string, targetPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function classifyCompanyWorkspaceRoot(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): {
  classification: CompanyWorkspaceDeletionClassification;
  safeToDelete: boolean;
} {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const hiveRunnerCompaniesRoot = path.join(
    resolveHiveRunnerWorkspaceRoot(env),
    "companies",
  );
  if (
    resolvedWorkspaceRoot !== path.resolve(hiveRunnerCompaniesRoot) &&
    isPathContained(hiveRunnerCompaniesRoot, resolvedWorkspaceRoot)
  ) {
    return {
      classification: "hiverunner",
      safeToDelete: true,
    };
  }

  const openclawWorkspaceRoot = path.resolve(resolveOpenClawWorkspaceRoot(env));
  if (resolvedWorkspaceRoot === openclawWorkspaceRoot) {
    return {
      classification: "default-openclaw-workspace",
      safeToDelete: false,
    };
  }

  const openclawCompaniesRoot = path.join(openclawWorkspaceRoot, "companies");
  if (
    resolvedWorkspaceRoot !== path.resolve(openclawCompaniesRoot) &&
    isPathContained(openclawCompaniesRoot, resolvedWorkspaceRoot)
  ) {
    return {
      classification: "legacy-openclaw-company",
      safeToDelete: true,
    };
  }

  const openclawDir = path.resolve(resolveOpenClawDir(env));
  const openclawWorkspacesRoot = path.join(openclawDir, "workspaces");
  if (
    resolvedWorkspaceRoot !== path.resolve(openclawWorkspacesRoot) &&
    isPathContained(openclawWorkspacesRoot, resolvedWorkspaceRoot)
  ) {
    return {
      classification: "legacy-openclaw-company",
      safeToDelete: true,
    };
  }

  if (
    isPathContained(openclawDir, resolvedWorkspaceRoot) &&
    path.basename(resolvedWorkspaceRoot).startsWith("workspace-")
  ) {
    return {
      classification: "legacy-openclaw-agent-workspace",
      safeToDelete: true,
    };
  }

  return {
    classification: "external",
    safeToDelete: false,
  };
}

export function isSafeManagedCompanyWorkspacePath(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return classifyCompanyWorkspaceRoot(workspaceRoot, env).safeToDelete;
}
