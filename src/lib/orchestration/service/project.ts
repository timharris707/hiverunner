import { randomUUID } from "crypto";

import {
  DEFAULT_STALE_ALERT_THRESHOLDS_HOURS,
  type OrchestrationProject,
  OrchestrationApiError,
  type OrchestrationTask,
  type ProjectAggregateRow,
  type ProjectStatusInput,
  commentsForTasks,
  fetchTaskRowsForProject,
  getOrchestrationDb,
  getProjectRow,
  projectFromRow,
  slugify,
  taskFromRow,
  parseProjectSettings,
  isNonProductionProject,
} from "./shared";
import { refreshEdgeRouteMapCache } from "@/lib/orchestration/edge-route-map-service";

export function listProjects(input?: {
  companyIdOrSlug?: string;
  includeArchived?: boolean;
  includeNonProduction?: boolean;
}): { projects: OrchestrationProject[] } {
  const db = getOrchestrationDb();
  let scopedCompanyId: string | null = null;
  const includeArchived = input?.includeArchived ?? false;
  const includeNonProduction = input?.includeNonProduction ?? false;
  const whereParts = [includeArchived ? "1=1" : "p.archived_at IS NULL"];
  const args: unknown[] = [];

  if (input?.companyIdOrSlug) {
    const companyRow = db
      .prepare(
        `SELECT id
         FROM companies
         WHERE archived_at IS NULL
           AND (id = ? OR slug = ?)
         LIMIT 1`
      )
      .get(input.companyIdOrSlug, input.companyIdOrSlug) as { id: string } | undefined;

    if (!companyRow) {
      throw new OrchestrationApiError(404, "company_not_found", "Company not found");
    }
    scopedCompanyId = companyRow.id;
    whereParts.push("p.company_id = ?");
    args.push(companyRow.id);
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

  let slug = rootSlug;
  let i = 1;
  while (
    db.prepare("SELECT 1 FROM projects WHERE slug = ? LIMIT 1").get(slug) ||
    db.prepare("SELECT 1 FROM project_slug_aliases WHERE slug_alias = ? LIMIT 1").get(slug)
  ) {
    i += 1;
    slug = `${rootSlug}-${i}`;
  }

  const projectId = randomUUID();
  const settings = JSON.stringify({
    emoji: input.emoji,
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
  status?: ProjectStatusInput;
  staleAlertThresholdsHours?: {
    review?: number;
    inProgress?: number;
    blocked?: number;
  };
}): { project: OrchestrationProject } {
  const db = getOrchestrationDb();
  const current = resolveProjectRow(db, input.projectIdOrSlug);
  if (!current) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  // Slug rename handling.
  const nextSlug = input.slug ? slugify(input.slug) : current.slug;
  if (!nextSlug) {
    throw new OrchestrationApiError(400, "invalid_slug", "Unable to derive project slug");
  }

  if (nextSlug !== current.slug) {
    // Reject if new slug collides with another project's canonical slug.
    const slugOwner = db
      .prepare("SELECT id FROM projects WHERE slug = ? LIMIT 1")
      .get(nextSlug) as { id: string } | undefined;
    if (slugOwner && slugOwner.id !== current.id) {
      throw new OrchestrationApiError(409, "project_slug_taken", "Another project already uses this slug");
    }
    // Reject if new slug collides with another project's alias.
    const aliasOwner = db
      .prepare("SELECT project_id FROM project_slug_aliases WHERE slug_alias = ? LIMIT 1")
      .get(nextSlug) as { project_id: string } | undefined;
    if (aliasOwner && aliasOwner.project_id !== current.id) {
      throw new OrchestrationApiError(409, "project_slug_taken", "Another project already uses this slug (via alias)");
    }
  }

  const parsed = parseProjectSettings(current.settings_json);
  const nextSettings = {
    ...parsed.extra,
    emoji: input.emoji ?? parsed.emoji,
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

    db.prepare(
      `UPDATE projects
       SET name = ?, slug = ?, settings_json = ?, status = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.name ?? current.name,
      nextSlug,
      JSON.stringify(nextSettings),
      input.status ?? current.status,
      now,
      current.id
    );
  })();

  // Invalidate edge route map cache if slug changed.
  if (nextSlug !== current.slug) {
    refreshEdgeRouteMapCache();
  }

  const row = getProjectRow(db, current.id);
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
function resolveProjectRow(db: ReturnType<typeof getOrchestrationDb>, idOrSlug: string): ProjectAggregateRow | undefined {
  const direct = getProjectRow(db, idOrSlug);
  if (direct) return direct;

  // Fall back to slug alias.
  const alias = db
    .prepare("SELECT project_id FROM project_slug_aliases WHERE slug_alias = ? LIMIT 1")
    .get(idOrSlug) as { project_id: string } | undefined;
  if (!alias) return undefined;

  return getProjectRow(db, alias.project_id);
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

  return {
    project: projectFromRow(db, projectRow),
    tasks: rows.map((row) => taskFromRow(row, commentMap.get(row.id) ?? [])),
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
