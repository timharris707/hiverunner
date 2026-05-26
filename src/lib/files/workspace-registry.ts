import fs from "fs";
import path from "path";

import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { readProjectSourceWorkspaceRoot } from "@/lib/orchestration/service/shared";
import {
  ensureCompanyWorkspaceScaffold,
  resolveAgentWorkspacePathWithLegacyFallback,
  resolveCompanyProjectWorkspacePath,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";

export type FileWorkspaceKind =
  | "company"
  | "project_files"
  | "project_source"
  | "agent_memory";

export type FileWorkspaceRecord = {
  id: string;
  name: string;
  group: "Company" | "Projects" | "Agents";
  kind: FileWorkspaceKind;
  path: string;
  exists: boolean;
  writable: boolean;
  source: string;
  description?: string;
  projectId?: string;
  projectSlug?: string;
  projectName?: string;
  agentId?: string;
  agentSlug?: string;
  agentName?: string;
  emoji?: string | null;
  avatarUrl?: string | null;
};

type CompanyWorkspaceRow = {
  id: string;
  slug: string;
  workspace_slug: string | null;
  runtime_slug: string | null;
  company_code: string | null;
  name: string;
  workspace_root: string | null;
  workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
};

type ProjectWorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  settings_json: string | null;
};

type AgentWorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  role: string;
  emoji: string | null;
  avatar_url: string | null;
  project_id: string | null;
  project_slug: string | null;
  project_name: string | null;
};

type ScopedProjectWorkspaceRow = ProjectWorkspaceRow & {
  company_id: string;
  company_slug: string;
  company_name: string;
  company_workspace_slug: string | null;
  company_workspace_root: string | null;
  company_workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
};

type ScopedAgentWorkspaceRow = AgentWorkspaceRow & {
  company_id: string;
  company_slug: string;
  company_name: string;
  company_workspace_slug: string | null;
  company_workspace_root: string | null;
  company_workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
};

function exists(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  try {
    return fs.existsSync(pathname);
  } catch {
    return false;
  }
}

function resolveCompanyRoot(company: CompanyWorkspaceRow): string {
  return resolveCompanyWorkspaceRoot({
    companyId: company.id,
    workspaceSlug: company.workspace_slug,
    workspaceRoot: company.workspace_root,
    workspaceSource: company.workspace_source,
  });
}

function getProjectByIdOrUniqueSlug(projectIdOrSlug: string): ScopedProjectWorkspaceRow | null {
  const db = getOrchestrationDb();
  const byId = db.prepare(
    `SELECT
       p.id,
       p.slug,
       p.name,
       p.settings_json,
       c.id AS company_id,
       c.slug AS company_slug,
       c.name AS company_name,
       c.workspace_slug AS company_workspace_slug,
       c.workspace_root AS company_workspace_root,
       c.workspace_source AS company_workspace_source
     FROM projects p
     INNER JOIN companies c ON c.id = p.company_id
     WHERE p.id = ?
       AND p.archived_at IS NULL
       AND c.archived_at IS NULL
     LIMIT 1`
  ).get(projectIdOrSlug) as ScopedProjectWorkspaceRow | undefined;
  if (byId) return byId;

  const matches = db.prepare(
    `SELECT
       p.id,
       p.slug,
       p.name,
       p.settings_json,
       c.id AS company_id,
       c.slug AS company_slug,
       c.name AS company_name,
       c.workspace_slug AS company_workspace_slug,
       c.workspace_root AS company_workspace_root,
       c.workspace_source AS company_workspace_source
     FROM projects p
     INNER JOIN companies c ON c.id = p.company_id
     WHERE p.slug = ?
       AND p.archived_at IS NULL
       AND c.archived_at IS NULL
     LIMIT 2`
  ).all(projectIdOrSlug) as ScopedProjectWorkspaceRow[];

  return matches.length === 1 ? matches[0] : null;
}

function getAgentByIdOrUniqueSlug(agentIdOrSlug: string): ScopedAgentWorkspaceRow | null {
  const db = getOrchestrationDb();
  const byId = db.prepare(
    `SELECT
       a.id,
       a.slug,
       a.name,
       a.role,
       a.project_id,
       p.slug AS project_slug,
       p.name AS project_name,
       c.id AS company_id,
       c.slug AS company_slug,
       c.name AS company_name,
       c.workspace_slug AS company_workspace_slug,
       c.workspace_root AS company_workspace_root,
       c.workspace_source AS company_workspace_source
     FROM agents a
     LEFT JOIN projects p ON p.id = a.project_id
     INNER JOIN companies c ON c.id = p.company_id
        OR (a.company_id = c.id AND p.id IS NULL)
     WHERE a.id = ?
       AND a.archived_at IS NULL
       AND (p.id IS NULL OR p.archived_at IS NULL)
       AND c.archived_at IS NULL
     LIMIT 1`
  ).get(agentIdOrSlug) as ScopedAgentWorkspaceRow | undefined;
  if (byId) return byId;

  const matches = db.prepare(
    `SELECT
       a.id,
       a.slug,
       a.name,
       a.role,
       a.project_id,
       p.slug AS project_slug,
       p.name AS project_name,
       c.id AS company_id,
       c.slug AS company_slug,
       c.name AS company_name,
       c.workspace_slug AS company_workspace_slug,
       c.workspace_root AS company_workspace_root,
       c.workspace_source AS company_workspace_source
     FROM agents a
     LEFT JOIN projects p ON p.id = a.project_id
     INNER JOIN companies c ON c.id = p.company_id
        OR (a.company_id = c.id AND p.id IS NULL)
     WHERE a.slug = ?
       AND a.archived_at IS NULL
       AND (p.id IS NULL OR p.archived_at IS NULL)
       AND c.archived_at IS NULL
     LIMIT 2`
  ).all(agentIdOrSlug) as ScopedAgentWorkspaceRow[];

  return matches.length === 1 ? matches[0] : null;
}

export function resolveScopedFileWorkspaceBase(workspaceId: string): string | null {
  const [scope, idOrSlug, target] = workspaceId.split(":");

  if (scope === "company" && idOrSlug && !target) {
    const company = resolveCompanyIdBySlug(idOrSlug);
    return company ? resolveCompanyRoot(company) : null;
  }

  if (scope === "project" && idOrSlug && (target === "files" || target === "source")) {
    const project = getProjectByIdOrUniqueSlug(idOrSlug);
    if (!project) return null;

    const companyRoot = resolveCompanyWorkspaceRoot({
      companyId: project.company_id,
      workspaceSlug: project.company_workspace_slug,
      workspaceRoot: project.company_workspace_root,
      workspaceSource: project.company_workspace_source,
    });

    if (target === "files") {
      return resolveCompanyProjectWorkspacePath(companyRoot, {
        slug: project.slug,
        name: project.name,
      }).path;
    }

    const sourceWorkspaceRoot = readProjectSourceWorkspaceRoot(project.settings_json);
    return sourceWorkspaceRoot ? path.resolve(sourceWorkspaceRoot) : null;
  }

  if (scope === "agent" && idOrSlug && target === "memory") {
    const agent = getAgentByIdOrUniqueSlug(idOrSlug);
    if (!agent) return null;

    const companyRoot = resolveCompanyWorkspaceRoot({
      companyId: agent.company_id,
      workspaceSlug: agent.company_workspace_slug,
      workspaceRoot: agent.company_workspace_root,
      workspaceSource: agent.company_workspace_source,
    });

    return resolveAgentWorkspacePathWithLegacyFallback(companyRoot, agent.slug).path;
  }

  return null;
}

export function listCompanyFileWorkspaces(companySlugOrId: string): FileWorkspaceRecord[] {
  const db = getOrchestrationDb();
  const company = resolveCompanyIdBySlug(companySlugOrId, db);
  if (!company) return [];

  const companyRoot = resolveCompanyRoot(company);
  const workspaces: FileWorkspaceRecord[] = [
    {
      id: `company:${company.id}`,
      name: `${company.name} company files`,
      group: "Company",
      kind: "company",
      path: companyRoot,
      exists: exists(companyRoot),
      writable: true,
      source: company.workspace_source ?? "company",
      description: "Company-level memory, settings, and shared artifacts",
    },
  ];

  const projects = db.prepare(
    `SELECT id, slug, name, settings_json
     FROM projects
     WHERE company_id = ?
       AND archived_at IS NULL
     ORDER BY lower(name) ASC`
  ).all(company.id) as ProjectWorkspaceRow[];

  for (const project of projects) {
    const projectDirectory = resolveCompanyProjectWorkspacePath(companyRoot, {
      slug: project.slug,
      name: project.name,
    }).path;
    if (!projectDirectory) {
      continue;
    }
    const sourceWorkspaceRoot = readProjectSourceWorkspaceRoot(project.settings_json);

    workspaces.push({
      id: `project:${project.id}:files`,
      name: `${project.name} project files`,
      group: "Projects",
      kind: "project_files",
      path: projectDirectory,
      exists: exists(projectDirectory),
      writable: true,
      source: "hiverunner-managed",
      description: "HiveRunner-managed project plans, notes, and artifacts",
      projectId: project.id,
      projectSlug: project.slug,
      projectName: project.name,
    });

    if (sourceWorkspaceRoot) {
      const resolvedSource = path.resolve(sourceWorkspaceRoot);
      workspaces.push({
        id: `project:${project.id}:source`,
        name: `${project.name} source repo`,
        group: "Projects",
        kind: "project_source",
        path: resolvedSource,
        exists: exists(resolvedSource),
        writable: true,
        source: "project-settings",
        description: "Linked source workspace used by execution engines for code and tests",
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
      });
    }
  }

  const agents = db.prepare(
    `SELECT
       a.id,
       a.slug,
       a.name,
       a.role,
       a.emoji,
       a.avatar_url,
       a.project_id,
       p.slug AS project_slug,
       p.name AS project_name
     FROM agents a
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE a.company_id = ?
       AND a.archived_at IS NULL
       AND (p.id IS NULL OR p.archived_at IS NULL)
     ORDER BY lower(a.name) ASC`
  ).all(company.id) as AgentWorkspaceRow[];

  for (const agent of agents) {
    const agentWorkspace = resolveAgentWorkspacePathWithLegacyFallback(companyRoot, agent.slug);
    workspaces.push({
      id: `agent:${agent.id}:memory`,
      name: `${agent.name} memory`,
      group: "Agents",
      kind: "agent_memory",
      path: agentWorkspace.path,
      exists: agentWorkspace.exists,
      writable: true,
      source: agentWorkspace.source,
      description: `${agent.role} runtime workspace`,
      ...(agent.project_id ? { projectId: agent.project_id } : {}),
      ...(agent.project_slug ? { projectSlug: agent.project_slug } : {}),
      ...(agent.project_name ? { projectName: agent.project_name } : {}),
      agentId: agent.id,
      agentSlug: agent.slug,
      agentName: agent.name,
      emoji: agent.emoji,
      avatarUrl: agent.avatar_url,
    });
  }

  return workspaces;
}

export function ensureCompanyManagedFileWorkspaces(companySlugOrId: string): {
  companyRoot: string;
  projectDirectories: string[];
} | null {
  const db = getOrchestrationDb();
  const company = resolveCompanyIdBySlug(companySlugOrId, db);
  if (!company) return null;

  const companyRoot = resolveCompanyRoot(company);
  ensureCompanyWorkspaceScaffold(companyRoot);

  const projects = db.prepare(
    `SELECT id, slug, name, settings_json
     FROM projects
     WHERE company_id = ?
       AND archived_at IS NULL
     ORDER BY lower(name) ASC`
  ).all(company.id) as ProjectWorkspaceRow[];

  const projectDirectories: string[] = [];
  for (const project of projects) {
    const projectDirectory = resolveCompanyProjectWorkspacePath(companyRoot, {
      slug: project.slug,
      name: project.name,
    }).path;
    if (!projectDirectory) {
      continue;
    }
    fs.mkdirSync(projectDirectory, { recursive: true });
    projectDirectories.push(projectDirectory);
  }

  return { companyRoot, projectDirectories };
}
