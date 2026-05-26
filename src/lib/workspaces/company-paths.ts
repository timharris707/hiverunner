import fs from "fs";
import path from "path";

import {
  resolveHiveRunnerWorkspaceRoot,
  resolveOpenClawDir,
  resolveOpenClawWorkspaceRoot,
} from "@/lib/workspaces/root";

type ResolveCompanyWorkspaceRootInput = {
  companyId: string;
  workspaceSlug?: string | null;
  workspaceRoot?: string | null;
  workspaceSource?: string | null;
  isDefaultCompany?: boolean;
  env?: NodeJS.ProcessEnv;
};

function slugifyPathPart(value: string): string {
  return value
    .replace(/'/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function normalizeWorkspaceSlug(value: string): string {
  return slugifyPathPart(value) || "company";
}

export function buildHumanReadableCompanyWorkspaceDirectoryName(
  workspaceSlug: string,
  _companyId?: string,
): string {
  void _companyId;
  return normalizeWorkspaceSlug(workspaceSlug);
}

export function resolveCanonicalCompanyWorkspaceRoot(
  companyId: string,
  workspaceSlugOrEnv?: string | NodeJS.ProcessEnv | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const workspaceSlug =
    typeof workspaceSlugOrEnv === "string" ? workspaceSlugOrEnv : null;
  const resolvedEnv =
    workspaceSlugOrEnv && typeof workspaceSlugOrEnv !== "string" ? workspaceSlugOrEnv : env;

  return path.join(
    resolveHiveRunnerWorkspaceRoot(resolvedEnv),
    "companies",
    workspaceSlug?.trim()
      ? buildHumanReadableCompanyWorkspaceDirectoryName(workspaceSlug, companyId)
      : companyId,
  );
}

export function resolvePlannedCanonicalCompanyWorkspaceRoot(
  companyId: string,
  workspaceSlug: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveCanonicalCompanyWorkspaceRoot(companyId, workspaceSlug, env);
}

export function resolveCompanyWorkspaceRoot(
  input: ResolveCompanyWorkspaceRootInput,
): string {
  const trimmedWorkspaceRoot = input.workspaceRoot?.trim();
  if (trimmedWorkspaceRoot) {
    return path.resolve(trimmedWorkspaceRoot);
  }

  if (input.workspaceSource === "openclaw" || input.isDefaultCompany) {
    return resolveOpenClawWorkspaceRoot(input.env);
  }

  return resolveCanonicalCompanyWorkspaceRoot(input.companyId, input.workspaceSlug, input.env);
}

// Fallback initializer — NOT the primary seed path. createCompany calls this
// eagerly before inserting the companies row (fix 1219863f), so under normal
// flow the dirs already exist by the time later consumers (agent hire,
// memory ops, voice-memory) reach for them. Calling this again is safe:
// mkdirSync({recursive: true}) is idempotent. Keep it around for legacy
// companies created before the eager seed and as a defense-in-depth layer
// in paths that can't assume the creator ran.
export function ensureCompanyWorkspaceScaffold(companyWorkspaceRoot: string): {
  root: string;
  projectsDir: string;
  memoryDir: string;
  scriptsDir: string;
} {
  const root = path.resolve(companyWorkspaceRoot);
  const projectsDir = path.join(root, "projects");
  const memoryDir = path.join(root, "memory");
  const scriptsDir = path.join(root, "scripts");

  fs.mkdirSync(projectsDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });

  return {
    root,
    projectsDir,
    memoryDir,
    scriptsDir,
  };
}

function resolveSourceWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidate =
    env.MC_AGENT_SOURCE_ROOT?.trim() ||
    env.MC_APP_ROOT?.trim() ||
    process.cwd();
  if (!candidate) return null;

  const resolved = path.resolve(candidate);
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }
  return resolved;
}

function isSameOrNestedPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureDirectorySymlink(input: {
  linkPath: string;
  targetPath: string;
  relativeToLinkDir?: boolean;
}): { linkPath: string; targetPath: string; linked: boolean; reason?: string } {
  const linkPath = path.resolve(input.linkPath);
  const targetPath = path.resolve(input.targetPath);
  const linkTarget = input.relativeToLinkDir
    ? path.relative(path.dirname(linkPath), targetPath) || "."
    : targetPath;

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  try {
    const existing = fs.lstatSync(linkPath);
    if (existing.isSymbolicLink()) {
      try {
        if (fs.realpathSync(linkPath) === fs.realpathSync(targetPath)) {
          return { linkPath, targetPath, linked: true };
        }
      } catch {
        // Replace broken or unreadable source links below.
      }
      fs.rmSync(linkPath, { force: true });
    } else {
      return { linkPath, targetPath, linked: false, reason: "path_occupied" };
    }
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : null;
    if (code !== "ENOENT") {
      return { linkPath, targetPath, linked: false, reason: "lstat_failed" };
    }
  }

  try {
    fs.symlinkSync(linkTarget, linkPath, "dir");
    return { linkPath, targetPath, linked: true };
  } catch {
    return { linkPath, targetPath, linked: false, reason: "symlink_failed" };
  }
}

export function ensureCompanySourceWorkspaceLink(
  companyWorkspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): { linkPath: string; targetPath: string | null; linked: boolean; reason?: string } {
  const root = ensureCompanyWorkspaceScaffold(companyWorkspaceRoot).root;
  const targetPath = resolveSourceWorkspaceRoot(env);
  const linkPath = path.join(root, "source");
  if (!targetPath) {
    return { linkPath, targetPath: null, linked: false, reason: "source_unavailable" };
  }
  if (isSameOrNestedPath(root, targetPath)) {
    return { linkPath, targetPath, linked: false, reason: "source_inside_company_workspace" };
  }
  return ensureDirectorySymlink({ linkPath, targetPath });
}

export function ensureAgentSourceWorkspaceLink(
  agentWorkspacePath: string,
  companyWorkspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): { linkPath: string; targetPath: string | null; linked: boolean; reason?: string } {
  const companySource = ensureCompanySourceWorkspaceLink(companyWorkspaceRoot, env);
  const linkPath = path.join(path.resolve(agentWorkspacePath), "source");
  if (!companySource.targetPath || !companySource.linked) {
    return {
      linkPath,
      targetPath: companySource.targetPath,
      linked: false,
      reason: companySource.reason ?? "company_source_unavailable",
    };
  }
  return ensureDirectorySymlink({
    linkPath,
    targetPath: companySource.linkPath,
    relativeToLinkDir: true,
  });
}

export function resolveCompanyAgentWorkspacePath(
  companyWorkspaceRoot: string | null,
  agentSlug: string,
): string | null {
  if (!companyWorkspaceRoot?.trim()) {
    return null;
  }
  return path.join(path.resolve(companyWorkspaceRoot), "agents", agentSlug);
}

const LEGACY_OPENCLAW_AGENT_WORKSPACE_MARKERS = [
  [".openclaw", "workspace-state.json"],
  ["IDENTITY.md"],
  ["AGENTS.md"],
] as const;

function hasRecognizedLegacyOpenClawAgentWorkspace(candidatePath: string): boolean {
  try {
    if (!fs.statSync(candidatePath).isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }

  return LEGACY_OPENCLAW_AGENT_WORKSPACE_MARKERS.some((markerPath) =>
    fs.existsSync(path.join(candidatePath, ...markerPath)),
  );
}

export function resolveLegacyOpenClawAgentWorkspacePath(
  agentSlug: string,
  env: NodeJS.ProcessEnv = process.env,
): {
  path: string;
  exists: boolean;
  source: "legacy-openclaw-subworkspace" | "legacy-openclaw-workspace";
  aliasPath: string;
} {
  const legacySubworkspaceDir = path.join(resolveOpenClawWorkspaceRoot(env), agentSlug);
  const legacyWorkspaceDir = path.join(resolveOpenClawDir(env), `workspace-${agentSlug}`);
  const legacyAliasExists = fs.existsSync(legacyWorkspaceDir);

  if (legacyAliasExists && hasRecognizedLegacyOpenClawAgentWorkspace(legacySubworkspaceDir)) {
    return {
      path: legacySubworkspaceDir,
      exists: true,
      source: "legacy-openclaw-subworkspace",
      aliasPath: legacyWorkspaceDir,
    };
  }

  if (legacyAliasExists) {
    return {
      path: legacyWorkspaceDir,
      exists: true,
      source: "legacy-openclaw-workspace",
      aliasPath: legacyWorkspaceDir,
    };
  }

  return {
    path: legacyWorkspaceDir,
    exists: false,
    source: "legacy-openclaw-workspace",
    aliasPath: legacyWorkspaceDir,
  };
}

export function resolveCompanyProjectWorkspaceCandidates(
  companyWorkspaceRoot: string | null,
  project: { slug: string; name: string },
): string[] {
  if (!companyWorkspaceRoot?.trim()) {
    return [];
  }

  const root = path.resolve(companyWorkspaceRoot);
  const candidates = [
    path.join(root, "projects", project.slug),
    path.join(root, "projects", slugifyPathPart(project.name)),
  ];

  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

export function resolveCompanyProjectWorkspacePath(
  companyWorkspaceRoot: string | null,
  project: { slug: string; name: string },
): { path: string | null; exists: boolean } {
  const candidates = resolveCompanyProjectWorkspaceCandidates(companyWorkspaceRoot, project);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { path: candidate, exists: true };
    }
  }

  return {
    path: candidates[0] ?? null,
    exists: false,
  };
}

export function resolveAgentWorkspacePathWithLegacyFallback(
  companyWorkspaceRoot: string | null,
  agentSlug: string,
  env: NodeJS.ProcessEnv = process.env,
): {
  path: string;
  exists: boolean;
  source:
    | "company-convention"
    | "legacy-openclaw-subworkspace"
    | "legacy-openclaw-workspace";
} {
  const companyScopedWorkspaceDir = resolveCompanyAgentWorkspacePath(companyWorkspaceRoot, agentSlug);
  const legacyWorkspace = resolveLegacyOpenClawAgentWorkspacePath(agentSlug, env);

  if (companyScopedWorkspaceDir && fs.existsSync(companyScopedWorkspaceDir)) {
    return {
      path: companyScopedWorkspaceDir,
      exists: true,
      source: "company-convention",
    };
  }

  if (legacyWorkspace.exists) {
    return {
      path: legacyWorkspace.path,
      exists: true,
      source: legacyWorkspace.source,
    };
  }

  return {
    path: companyScopedWorkspaceDir ?? legacyWorkspace.path,
    exists: false,
    source: companyScopedWorkspaceDir ? "company-convention" : legacyWorkspace.source,
  };
}
