import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import {
  DEFAULT_STALE_ALERT_THRESHOLDS_HOURS,
  type OrchestrationProject,
  OrchestrationApiError,
  type OrchestrationTask,
  type ProjectAggregateRow,
  type ProjectStatusInput,
  commentsForTasks,
  dependencySummariesForTaskRows,
  fetchTaskRowsForProject,
  getOrchestrationDb,
  getProjectRow,
  projectFromRow,
  resolveCompanyId,
  slugify,
  taskFromRow,
  parseProjectSettings,
  isNonProductionProject,
} from "./shared";
import { refreshEdgeRouteMapCache } from "@/lib/orchestration/edge-route-map-service";
import { cleanupDeletedCompanyOpenClawAgents } from "@/lib/orchestration/company-service";
import {
  resolveCompanyAgentWorkspacePath,
  resolveCompanyProjectWorkspaceCandidates,
} from "@/lib/workspaces/company-paths";
import { isPathContained } from "@/lib/workspaces/delete-safety";

export function listProjects(input?: {
  companyIdOrSlug?: string;
  includeArchived?: boolean;
  includeNonProduction?: boolean;
  ownerUserId?: string;
}): { projects: OrchestrationProject[] } {
  const db = getOrchestrationDb();
  let scopedCompanyId: string | null = null;
  const includeArchived = input?.includeArchived ?? false;
  // When scoped to a specific company, always show all its projects.
  // The non-production filter is only meaningful for the global unscoped list.
  const includeNonProduction = input?.companyIdOrSlug ? true : (input?.includeNonProduction ?? false);
  const whereParts = [includeArchived ? "1=1" : "p.archived_at IS NULL"];
  const args: unknown[] = [];

  if (input?.companyIdOrSlug) {
    const companyId = resolveCompanyId(db, input.companyIdOrSlug, { ownerUserId: input.ownerUserId });

    if (!companyId) {
      throw new OrchestrationApiError(404, "company_not_found", "Company not found");
    }
    scopedCompanyId = companyId;
    whereParts.push("p.company_id = ?");
    args.push(companyId);
  } else if (input?.ownerUserId?.trim()) {
    whereParts.push("p.company_id IN (SELECT id FROM companies WHERE owner_user_id = ? AND archived_at IS NULL)");
    args.push(input.ownerUserId.trim());
  }

  const rows = db
    .prepare(
      `SELECT
        p.id,
        p.company_id,
        p.slug,
        p.name,
        p.description,
        p.color,
        p.status,
        p.owner_user_id,
        p.settings_json,
        p.created_at,
        p.archived_at,
        COUNT(t.id) AS total_tasks,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tasks,
        SUM(CASE WHEN t.status = 'backlog' THEN 1 ELSE 0 END) AS backlog_tasks,
        SUM(CASE WHEN t.status = 'review' THEN 1 ELSE 0 END) AS review_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_tasks
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id AND t.archived_at IS NULL
       WHERE ${whereParts.join(" AND ")}
       GROUP BY p.id
       ORDER BY p.updated_at DESC`
    )
    .all(...args) as ProjectAggregateRow[];

  return {
    projects: rows
      .filter((row) => {
        if (row.slug === "no-project" || row.slug.startsWith("no-project-")) return false;
        if (includeNonProduction) return true;
        return !isNonProductionProject({
          slug: row.slug,
          name: row.name,
          description: row.description,
        });
      })
      .map((row) => {
        if (scopedCompanyId && row.company_id !== scopedCompanyId) {
          return null;
        }
        return projectFromRow(db, row);
      })
      .filter((row): row is OrchestrationProject => row !== null),
  };
}

export function createProject(input: {
  companyId: string;
  name: string;
  slug?: string;
  description: string;
  color: string;
  emoji: string;
  owner?: string;
  status: ProjectStatusInput;
  avatarThemeName?: string;
  sourceWorkspaceRoot?: string | null;
  staleAlertThresholdsHours?: {
    review?: number;
    inProgress?: number;
    blocked?: number;
  };
}): { project: OrchestrationProject } {
  const db = getOrchestrationDb();
  const now = new Date().toISOString();
  const company = db
    .prepare(
      `SELECT id
       FROM companies
       WHERE id = ?
         AND archived_at IS NULL
         AND status <> 'archived'
       LIMIT 1`
    )
    .get(input.companyId) as { id: string } | undefined;
  if (!company) {
    throw new OrchestrationApiError(
      400,
      "invalid_company",
      "companyId must reference an active company"
    );
  }

  const rootSlug = input.slug ? slugify(input.slug) : slugify(input.name);
  if (!rootSlug) {
    throw new OrchestrationApiError(400, "invalid_slug", "Unable to derive project slug from name");
  }

  // Slug uniqueness is company-scoped (migration v40).
  let slug = rootSlug;
  let i = 1;
  while (
    db.prepare(
      "SELECT 1 FROM projects WHERE company_id = ? AND slug = ? AND archived_at IS NULL LIMIT 1"
    ).get(input.companyId, slug) ||
    db.prepare(
      `SELECT 1 FROM project_slug_aliases pa
       JOIN projects p ON p.id = pa.project_id
       WHERE p.company_id = ? AND pa.slug_alias = ? LIMIT 1`
    ).get(input.companyId, slug)
  ) {
    i += 1;
    slug = `${rootSlug}-${i}`;
  }

  const projectId = randomUUID();
  const sourceWorkspaceRoot = input.sourceWorkspaceRoot?.trim() || null;
  const settings = JSON.stringify({
    emoji: input.emoji,
    ...(sourceWorkspaceRoot
      ? {
          workspace: {
            sourceRoot: path.resolve(sourceWorkspaceRoot),
          },
        }
      : {}),
    staleAlertThresholdsHours: {
      review:
        input.staleAlertThresholdsHours?.review ??
        DEFAULT_STALE_ALERT_THRESHOLDS_HOURS.review,
      inProgress:
        input.staleAlertThresholdsHours?.inProgress ??
        DEFAULT_STALE_ALERT_THRESHOLDS_HOURS.inProgress,
      blocked:
        input.staleAlertThresholdsHours?.blocked ??
        DEFAULT_STALE_ALERT_THRESHOLDS_HOURS.blocked,
    },
  });

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO projects
        (id, company_id, slug, name, description, color, status, owner_user_id, settings_json, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      input.companyId,
      slug,
      input.name,
      input.description,
      input.color,
      input.status,
      input.owner ?? null,
      settings,
      now,
      now
    );

    if (input.avatarThemeName) {
      db.prepare(
        `INSERT OR IGNORE INTO avatar_themes
          (id, company_id, name, prompt_template, style_keywords_json, sample_url, is_default, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        randomUUID(),
        input.companyId,
        input.avatarThemeName,
        "cohesive team avatar style, role-informed portrait, production-safe",
        JSON.stringify(["cohesive", "team", "avatar"]),
        null,
        now,
        now
      );
    }
  });

  tx();

  const row = getProjectRow(db, projectId);
  if (!row) {
    throw new OrchestrationApiError(500, "project_create_failed", "Project created but could not be loaded");
  }

  return { project: projectFromRow(db, row) };
}

export function getProject(projectIdOrSlug: string): { project: OrchestrationProject } {
  const db = getOrchestrationDb();
  const row = resolveProjectRow(db, projectIdOrSlug);
  if (!row) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  return { project: projectFromRow(db, row) };
}

export function lookupProjectByName(input: {
  name: string;
  companyId?: string;
}): { project: { id: string; name: string; slug: string; companyId: string } } {
  const db = getOrchestrationDb();
  const normalized = input.name.trim();
  if (!normalized) {
    throw new OrchestrationApiError(400, "invalid_lookup_name", "name is required");
  }

  const row = db
    .prepare(
      `SELECT id, name, slug, company_id
       FROM projects
       WHERE archived_at IS NULL
         AND (? IS NULL OR company_id = ?)
         AND (
           id = ?
           OR lower(id) = lower(?)
           OR
           lower(name) = lower(?)
           OR lower(slug) = lower(?)
           OR lower(name) LIKE '%' || lower(?) || '%'
           OR lower(slug) LIKE '%' || lower(?) || '%'
         )
       ORDER BY
         CASE
           WHEN id = ? OR lower(id) = lower(?) THEN 0
           WHEN lower(name) = lower(?) THEN 1
           WHEN lower(slug) = lower(?) THEN 2
           WHEN lower(name) LIKE lower(?) || '%' THEN 3
           WHEN lower(slug) LIKE lower(?) || '%' THEN 4
           ELSE 5
         END,
         length(name) ASC,
         updated_at DESC
       LIMIT 1`
    )
    .get(
      input.companyId ?? null,
      input.companyId ?? null,
      normalized,
      normalized,
      normalized,
      normalized,
      normalized,
      normalized,
      normalized,
      normalized,
      normalized,
      normalized,
      normalized,
      normalized
    ) as
    | {
        id: string;
        name: string;
        slug: string;
        company_id: string | null;
      }
    | undefined;

  if (!row || !row.company_id) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  return {
    project: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      companyId: row.company_id,
    },
  };
}

export function updateProjectSettings(input: {
  projectIdOrSlug: string;
  name?: string;
  slug?: string;
  emoji?: string;
  color?: string;
  status?: ProjectStatusInput;
  defaultExecutionEngine?: "hiverunner" | "symphony" | "manual" | null;
  sourceWorkspaceRoot?: string | null;
  staleAlertThresholdsHours?: {
    review?: number;
    inProgress?: number;
    blocked?: number;
  };
}): { project: OrchestrationProject } {
  const db = getOrchestrationDb();
  const current = resolveProjectRow(db, input.projectIdOrSlug, { includeArchived: true });
  if (!current) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  // Slug rename handling.
  const nextSlug = input.slug ? slugify(input.slug) : current.slug;
  if (!nextSlug) {
    throw new OrchestrationApiError(400, "invalid_slug", "Unable to derive project slug");
  }

  const restoringArchivedProject =
    current.archived_at && input.status !== undefined && input.status !== "archived";

  if (nextSlug !== current.slug || restoringArchivedProject) {
    // Reject if new slug collides with another project in the SAME company.
    const slugOwner = db
      .prepare(
        "SELECT id FROM projects WHERE company_id = ? AND slug = ? AND archived_at IS NULL LIMIT 1"
      )
      .get(current.company_id, nextSlug) as { id: string } | undefined;
    if (slugOwner && slugOwner.id !== current.id) {
      throw new OrchestrationApiError(409, "project_slug_taken", "Another project already uses this slug");
    }
    // Reject if new slug collides with another project's alias in the same company.
    const aliasOwner = db
      .prepare(
        `SELECT pa.project_id FROM project_slug_aliases pa
         JOIN projects p ON p.id = pa.project_id
         WHERE p.company_id = ? AND pa.slug_alias = ? LIMIT 1`
      )
      .get(current.company_id, nextSlug) as { project_id: string } | undefined;
    if (aliasOwner && aliasOwner.project_id !== current.id) {
      throw new OrchestrationApiError(409, "project_slug_taken", "Another project already uses this slug (via alias)");
    }
  }

  const parsed = parseProjectSettings(current.settings_json);
  const executionSettings =
    parsed.extra.execution &&
    typeof parsed.extra.execution === "object" &&
    !Array.isArray(parsed.extra.execution)
      ? parsed.extra.execution as Record<string, unknown>
      : undefined;
  const hasDefaultExecutionEngine = Object.prototype.hasOwnProperty.call(
    input,
    "defaultExecutionEngine"
  );
  const workspaceSettings =
    parsed.extra.workspace &&
    typeof parsed.extra.workspace === "object" &&
    !Array.isArray(parsed.extra.workspace)
      ? parsed.extra.workspace as Record<string, unknown>
      : undefined;
  const hasSourceWorkspaceRoot = Object.prototype.hasOwnProperty.call(
    input,
    "sourceWorkspaceRoot"
  );
  const nextSourceWorkspaceRoot = hasSourceWorkspaceRoot
    ? input.sourceWorkspaceRoot?.trim()
      ? path.resolve(input.sourceWorkspaceRoot.trim())
      : null
    : parsed.sourceWorkspaceRoot;
  const nextSettings = {
    ...parsed.extra,
    emoji: input.emoji ?? parsed.emoji,
    ...(hasSourceWorkspaceRoot || workspaceSettings
      ? {
          workspace: {
            ...(workspaceSettings ?? {}),
            sourceRoot: nextSourceWorkspaceRoot,
          },
        }
      : {}),
    ...(hasDefaultExecutionEngine || executionSettings
      ? {
          execution: {
            ...(executionSettings ?? {}),
            ...(hasDefaultExecutionEngine
              ? { defaultEngine: input.defaultExecutionEngine ?? null }
              : {}),
          },
        }
      : {}),
    staleAlertThresholdsHours: {
      review:
        input.staleAlertThresholdsHours?.review ??
        parsed.staleAlertThresholdsHours.review,
      inProgress:
        input.staleAlertThresholdsHours?.inProgress ??
        parsed.staleAlertThresholdsHours.inProgress,
      blocked:
        input.staleAlertThresholdsHours?.blocked ??
        parsed.staleAlertThresholdsHours.blocked,
    },
  };

  const now = new Date().toISOString();
  db.transaction(() => {
    // Record old slug as alias when slug changes.
    if (nextSlug !== current.slug) {
      db.prepare(
        `INSERT OR IGNORE INTO project_slug_aliases (project_id, slug_alias, created_at)
         VALUES (?, ?, ?)`
      ).run(current.id, current.slug, now);
    }

    const nextStatus = input.status ?? current.status;
    const nextArchivedAt =
      input.status === undefined
        ? current.archived_at
        : nextStatus === "archived"
          ? current.archived_at ?? now
          : null;

    db.prepare(
      `UPDATE projects
       SET name = ?, slug = ?, color = ?, settings_json = ?, status = ?, archived_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.name ?? current.name,
      nextSlug,
      input.color ?? current.color,
      JSON.stringify(nextSettings),
      nextStatus,
      nextArchivedAt,
      now,
      current.id
    );
  })();

  // Invalidate edge route map cache if slug changed.
  if (nextSlug !== current.slug) {
    refreshEdgeRouteMapCache();
  }

  const row = getProjectRow(db, current.id, { includeArchived: true });
  if (!row) {
    throw new OrchestrationApiError(
      500,
      "project_update_failed",
      "Project settings updated but project reload failed"
    );
  }

  return { project: projectFromRow(db, row) };
}

/**
 * Alias-aware project row resolver. Checks canonical slug first,
 * then falls back to project_slug_aliases.
 */
function resolveProjectRow(
  db: ReturnType<typeof getOrchestrationDb>,
  idOrSlug: string,
  options?: { includeArchived?: boolean },
): ProjectAggregateRow | undefined {
  const direct = getProjectRow(db, idOrSlug, options);
  if (direct) return direct;

  // Fall back to slug alias.
  const alias = db
    .prepare("SELECT project_id FROM project_slug_aliases WHERE slug_alias = ? LIMIT 1")
    .get(idOrSlug) as { project_id: string } | undefined;
  if (!alias) return undefined;

  return getProjectRow(db, alias.project_id, options);
}

export function archiveProject(projectIdOrSlug: string): {
  projectId: string;
  archivedAt: string;
} {
  const db = getOrchestrationDb();
  const resolved = resolveProjectRow(db, projectIdOrSlug);
  if (!resolved) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }
  const project = { id: resolved.id };

  const archivedAt = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks
       SET archived_at = ?, updated_at = ?
       WHERE project_id = ? AND archived_at IS NULL`
    ).run(archivedAt, archivedAt, project.id);

    db.prepare(
      `UPDATE agents
       SET archived_at = ?, updated_at = ?
       WHERE project_id = ? AND archived_at IS NULL`
    ).run(archivedAt, archivedAt, project.id);

    db.prepare(
      `UPDATE projects
       SET status = 'archived', archived_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(archivedAt, archivedAt, project.id);
  });

  tx();

  return {
    projectId: project.id,
    archivedAt,
  };
}

type HardDeleteProjectResult = {
  projectId: string;
  projectSlug: string;
  companyId: string;
  workspace: {
    companyRoot: string | null;
    projectPaths: Array<{ path: string; existed: boolean; deleted: boolean }>;
    agentPaths: Array<{ agentId: string; agentSlug: string; path: string; existed: boolean; deleted: boolean }>;
  };
  openclawAgents: {
    queued: string[];
  };
  deletedCounts: {
    tasks: number;
    agents: number;
    project: number;
  };
};

function deletePathIfPresent(targetPath: string, containerRoot?: string | null): { existed: boolean; deleted: boolean } {
  const resolvedTarget = path.resolve(targetPath);
  if (containerRoot && !isPathContained(containerRoot, resolvedTarget)) {
    throw new OrchestrationApiError(400, "unsafe_workspace_path", `Refusing to delete path outside company workspace: ${resolvedTarget}`);
  }

  const existed = fs.existsSync(resolvedTarget);
  if (!existed) {
    return { existed: false, deleted: true };
  }

  fs.rmSync(resolvedTarget, { recursive: true, force: true });
  const deleted = !fs.existsSync(resolvedTarget);
  if (!deleted) {
    throw new OrchestrationApiError(500, "workspace_delete_failed", `Failed to delete workspace path: ${resolvedTarget}`);
  }

  return { existed: true, deleted: true };
}

export function hardDeleteProject(projectIdOrSlug: string): HardDeleteProjectResult {
  const db = getOrchestrationDb();
  const resolved = resolveProjectRow(db, projectIdOrSlug);
  if (!resolved) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }
  if (!resolved.company_id) {
    throw new OrchestrationApiError(400, "project_company_missing", "Project has no company binding");
  }

  const companyRow = db.prepare(
    `SELECT workspace_root
       FROM companies
      WHERE id = ?
      LIMIT 1`
  ).get(resolved.company_id) as { workspace_root: string | null } | undefined;

  const companyWorkspaceRoot = companyRow?.workspace_root?.trim()
    ? path.resolve(companyRow.workspace_root)
    : null;

  const agentRows = db.prepare(
    `SELECT id, slug, openclaw_agent_id
       FROM agents
      WHERE project_id = ?`
  ).all(resolved.id) as Array<{ id: string; slug: string | null; openclaw_agent_id: string | null }>;

  const deletedCounts = {
    tasks: Number((db.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?`).get(resolved.id) as { count?: number } | undefined)?.count ?? 0),
    agents: agentRows.length,
    project: 1,
  };

  const projectWorkspaceResults = resolveCompanyProjectWorkspaceCandidates(companyWorkspaceRoot, {
    slug: resolved.slug,
    name: resolved.name,
  }).map((projectPath) => {
    const result = deletePathIfPresent(projectPath, companyWorkspaceRoot);
    return {
      path: projectPath,
      ...result,
    };
  });

  const agentWorkspaceResults = agentRows.map((agent) => {
    const agentSlug = agent.slug?.trim();
    const agentPath = agentSlug && companyWorkspaceRoot
      ? resolveCompanyAgentWorkspacePath(companyWorkspaceRoot, agentSlug)
      : null;

    if (!agentPath) {
      return {
        agentId: agent.id,
        agentSlug: agentSlug ?? "",
        path: "",
        existed: false,
        deleted: true,
      };
    }

    const result = deletePathIfPresent(agentPath, companyWorkspaceRoot);
    return {
      agentId: agent.id,
      agentSlug: agentSlug ?? "",
      path: agentPath,
      ...result,
    };
  });

  db.transaction(() => {
    db.prepare(`DELETE FROM tasks WHERE project_id = ?`).run(resolved.id);
    db.prepare(`DELETE FROM agents WHERE project_id = ?`).run(resolved.id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(resolved.id);
  })();

  refreshEdgeRouteMapCache();

  return {
    projectId: resolved.id,
    projectSlug: resolved.slug,
    companyId: resolved.company_id,
    workspace: {
      companyRoot: companyWorkspaceRoot,
      projectPaths: projectWorkspaceResults,
      agentPaths: agentWorkspaceResults,
    },
    openclawAgents: {
      queued: agentRows
        .map((agent) => agent.openclaw_agent_id?.trim() || null)
        .filter((value): value is string => Boolean(value)),
    },
    deletedCounts,
  };
}

export async function cleanupDeletedProjectOpenClawAgents(runtimeIds: string[]) {
  return cleanupDeletedCompanyOpenClawAgents(runtimeIds);
}

export function getProjectBoard(projectIdOrSlug: string): {
  project: OrchestrationProject;
  tasks: OrchestrationTask[];
} {
  const db = getOrchestrationDb();

  const projectRow = getProjectRow(db, projectIdOrSlug);
  if (!projectRow) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  const rows = fetchTaskRowsForProject(db, projectRow.id);
  const commentMap = commentsForTasks(
    db,
    rows.map((row) => row.id)
  );
  const dependencyMap = dependencySummariesForTaskRows(db, rows);

  return {
    project: projectFromRow(db, projectRow),
    tasks: rows.map((row) => taskFromRow(row, commentMap.get(row.id) ?? [], dependencyMap.get(row.id))),
  };
}

export function getProjectBoardUpdatedAt(projectIdOrSlug: string): {
  projectId: string;
  projectSlug: string;
  updatedAt: string;
} {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT id, slug, updated_at
       FROM projects
       WHERE (id = ? OR slug = ?)
         AND archived_at IS NULL
       LIMIT 1`
    )
    .get(projectIdOrSlug, projectIdOrSlug) as
    | {
        id: string;
        slug: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  return {
    projectId: row.id,
    projectSlug: row.slug,
    updatedAt: row.updated_at,
  };
}
