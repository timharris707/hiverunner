import { randomUUID } from "crypto";

import { generateAgentAvatarDataUrl } from "@/lib/orchestration/avatar";
import { ensureOpenClawAgentScaffold } from "@/lib/orchestration/openclaw-agent-scaffold";

import {
  type AgentRow,
  type AgentStatusInput,
  type OrchestrationAgent,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
  OrchestrationApiError,
  agentById,
  agentFromRow,
  getOrchestrationDb,
  getProjectRow,
  resolveProjectAvatarTheme,
  isNonProductionAgent,
  toApiPriority,
  toApiStatus,
  toApiType,
} from "./shared";

type AgentProfileTask = {
  id: string;
  title: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  updatedAt: string;
};

type AgentProfileActivity = {
  id: string;
  kind: "comment" | "event";
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  message: string;
  timestamp: string;
};

type AgentProfileExecutionRun = {
  id: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  provider: "openclaw" | "paperclip";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  durationMs?: number;
  errorMessage?: string;
};

const UUID_V4ISH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEEDED_AGENT_ID_REGEX = /^[a-z][a-z0-9-]*(?:-\d{3})?$/i;
const NEVERIDLE_CORE_SLUG = "neveridle-core";

function hasCanonicalAgentId(id: string): boolean {
  return UUID_V4ISH_REGEX.test(id);
}

function hasSeededAgentId(id: string): boolean {
  return SEEDED_AGENT_ID_REGEX.test(id);
}

function isTrustedCompanyAgent(row: AgentRow): boolean {
  if (hasCanonicalAgentId(row.id)) return true;
  if (hasSeededAgentId(row.id)) return true;
  if (row.paperclip_agent_id?.trim()) return true;
  if (row.openclaw_agent_id?.trim()) return true;
  return false;
}

function companyAgentPreferenceScore(row: AgentRow): number {
  let score = 0;
  if (hasSeededAgentId(row.id)) score += 8;
  if (row.paperclip_agent_id?.trim()) score += 5;
  if (row.openclaw_agent_id?.trim()) score += 4;
  if (!row.project_id) score += 2;
  if (hasCanonicalAgentId(row.id)) score += 1;
  return score;
}

function pickPreferredCompanyAgent(current: AgentRow, candidate: AgentRow): AgentRow {
  const currentScore = companyAgentPreferenceScore(current);
  const candidateScore = companyAgentPreferenceScore(candidate);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current;
  }

  const currentUpdated = Date.parse(current.updated_at);
  const candidateUpdated = Date.parse(candidate.updated_at);
  const currentValidUpdated = Number.isFinite(currentUpdated);
  const candidateValidUpdated = Number.isFinite(candidateUpdated);
  if (currentValidUpdated && candidateValidUpdated && candidateUpdated !== currentUpdated) {
    return candidateUpdated > currentUpdated ? candidate : current;
  }
  if (candidateValidUpdated && !currentValidUpdated) return candidate;
  if (currentValidUpdated && !candidateValidUpdated) return current;

  return candidate.id.localeCompare(current.id) < 0 ? candidate : current;
}

function dedupeCompanyAgentsByName(rows: AgentRow[]): AgentRow[] {
  const byName = new Map<string, AgentRow>();
  for (const row of rows) {
    const normalizedName = row.name.trim().toLowerCase();
    if (!normalizedName) continue;
    const existing = byName.get(normalizedName);
    if (!existing) {
      byName.set(normalizedName, row);
      continue;
    }
    byName.set(normalizedName, pickPreferredCompanyAgent(existing, row));
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function openClawStatusToAgentStatus(status: string): AgentStatusInput {
  if (status === "online") return "working";
  return "offline";
}

export type OpenClawAgentSnapshot = {
  id: string;
  name: string;
  emoji?: string;
  model?: string;
  status?: string;
};

export type CompanyAgentProfile = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  agent: OrchestrationAgent;
  currentTasks: AgentProfileTask[];
  recentActivity: AgentProfileActivity[];
  executionHistory: AgentProfileExecutionRun[];
  liveSession?: AgentProfileExecutionRun;
};

export function getAgentProfile(input: {
  agentId: string;
  companyIdOrSlug?: string;
  executionLimit?: number;
  activityLimit?: number;
}): CompanyAgentProfile {
  const db = getOrchestrationDb();
  const agentIdOrName = input.agentId.trim();
  if (!agentIdOrName) {
    throw new OrchestrationApiError(400, "invalid_agent_id", "Agent id is required");
  }

  if (input.companyIdOrSlug?.trim()) {
    return getCompanyAgentProfile({
      companyIdOrSlug: input.companyIdOrSlug.trim(),
      agentId: agentIdOrName,
      executionLimit: input.executionLimit,
      activityLimit: input.activityLimit,
    });
  }

  const candidates = db
    .prepare(
      `SELECT
         a.id,
         a.company_id
       FROM agents a
       INNER JOIN companies c ON c.id = a.company_id
       WHERE a.archived_at IS NULL
         AND c.archived_at IS NULL
         AND (
           a.id = ?
           OR lower(a.name) = lower(?)
           OR lower(a.slug) = lower(?)
         )
       ORDER BY
         CASE WHEN a.id = ? THEN 0 ELSE 1 END,
         a.updated_at DESC`
    )
    .all(agentIdOrName, agentIdOrName, agentIdOrName, agentIdOrName) as Array<{
    id: string;
    company_id: string;
  }>;

  if (candidates.length === 0) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }

  const exactIdMatch = candidates.find((candidate) => candidate.id === agentIdOrName);
  if (exactIdMatch) {
    return getCompanyAgentProfile({
      companyIdOrSlug: exactIdMatch.company_id,
      agentId: exactIdMatch.id,
      executionLimit: input.executionLimit,
      activityLimit: input.activityLimit,
    });
  }

  if (candidates.length > 1) {
    throw new OrchestrationApiError(
      409,
      "ambiguous_agent_name",
      "Multiple agents match this name; provide company to disambiguate"
    );
  }

  const candidate = candidates[0];
  return getCompanyAgentProfile({
    companyIdOrSlug: candidate.company_id,
    agentId: candidate.id,
    executionLimit: input.executionLimit,
    activityLimit: input.activityLimit,
  });
}

export function listProjectAgents(
  projectIdOrSlug: string,
  options?: { projectId?: string; includeNonProduction?: boolean }
): { agents: OrchestrationAgent[] } {
  const db = getOrchestrationDb();
  const includeNonProduction = options?.includeNonProduction ?? false;

  const projectRow = getProjectRow(db, projectIdOrSlug);
  if (!projectRow) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }
  if (!projectRow.company_id) {
    throw new OrchestrationApiError(500, "project_company_missing", "Project has no company");
  }

  const rows = db
    .prepare(
      `SELECT
        a.id,
        a.company_id,
        a.project_id,
        a.name,
        a.slug,
        a.emoji,
        a.role,
        a.personality,
        a.avatar_url,
        a.status,
        a.current_task_id,
        t.title AS current_task_title,
        a.model,
        a.adapter_type,
        a.paperclip_agent_id,
        a.openclaw_agent_id,
        a.reporting_to,
        mgr.name AS reporting_to_name,
        a.skills_json,
        a.tasks_completed,
        a.total_runtime_minutes,
        a.last_heartbeat,
        a.created_at,
        a.updated_at
       FROM agents a
       LEFT JOIN tasks t ON t.id = a.current_task_id
       LEFT JOIN agents mgr ON mgr.id = a.reporting_to
       WHERE a.company_id = ?
         AND a.archived_at IS NULL
       ORDER BY
         CASE WHEN a.project_id = ? THEN 0 ELSE 1 END,
         a.name ASC`
    )
    .all(projectRow.company_id, projectRow.id) as AgentRow[];

  return {
    agents: dedupeCompanyAgentsByName(
      rows.filter((row) => {
        if (!isTrustedCompanyAgent(row)) return false;
        if (!row.project_id) return false;
        if (includeNonProduction) return true;
        return !isNonProductionAgent({ name: row.name, role: row.role });
      })
    ).map(agentFromRow),
  };
}

export function listCompanyAgents(
  companyIdOrSlug: string,
  options?: { includeNonProduction?: boolean }
): { agents: OrchestrationAgent[] } {
  const db = getOrchestrationDb();
  const includeNonProduction = options?.includeNonProduction ?? false;

  const companyRow = db
    .prepare("SELECT id FROM companies WHERE (id = ? OR slug = ?) AND archived_at IS NULL")
    .get(companyIdOrSlug, companyIdOrSlug) as { id: string } | undefined;

  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const rows = db
    .prepare(
      `SELECT
        a.id,
        a.company_id,
        a.project_id,
        a.name,
        a.slug,
        a.emoji,
        a.role,
        a.personality,
        a.avatar_url,
        a.status,
        a.current_task_id,
        t.title AS current_task_title,
        a.model,
        a.adapter_type,
        a.paperclip_agent_id,
        a.openclaw_agent_id,
        a.reporting_to,
        mgr.name AS reporting_to_name,
        a.skills_json,
        a.tasks_completed,
        a.total_runtime_minutes,
        a.last_heartbeat,
        a.created_at,
        a.updated_at
       FROM agents a
       LEFT JOIN tasks t ON t.id = a.current_task_id
       LEFT JOIN agents mgr ON mgr.id = a.reporting_to
       WHERE a.company_id = ?
         AND a.archived_at IS NULL
       ORDER BY a.name ASC`
    )
    .all(companyRow.id) as AgentRow[];

  return {
    agents: dedupeCompanyAgentsByName(
      rows
      .filter((row) => {
        if (!isTrustedCompanyAgent(row)) return false;
        if (includeNonProduction) return true;
        return !isNonProductionAgent({ name: row.name, role: row.role });
      })
    ).map(agentFromRow),
  };
}

export function syncCompanyAgentsFromOpenClaw(input: {
  companyIdOrSlug: string;
  agents: OpenClawAgentSnapshot[];
  allowNonDefaultCompanyImport?: boolean;
}): { synced: number; inserted: number; updated: number; skipped: number } {
  const db = getOrchestrationDb();
  const companyRow = db
    .prepare(
      `SELECT id, slug
       FROM companies
       WHERE archived_at IS NULL
         AND (id = ? OR slug = ?)
       LIMIT 1`
    )
    .get(input.companyIdOrSlug, input.companyIdOrSlug) as { id: string; slug: string } | undefined;

  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  if (!input.allowNonDefaultCompanyImport && companyRow.slug !== NEVERIDLE_CORE_SLUG) {
    return { synced: 0, inserted: 0, updated: 0, skipped: input.agents.length };
  }

  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    const findExisting = db.prepare(
      `SELECT
        id,
        name,
        role,
        personality,
        emoji,
        model,
        openclaw_agent_id
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (openclaw_agent_id = ? OR lower(name) = lower(?))
       ORDER BY
         CASE WHEN openclaw_agent_id = ? THEN 0 ELSE 1 END,
         updated_at DESC
       LIMIT 1`
    );

    const insertAgent = db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, slug, emoji, role, personality, status, model, openclaw_agent_id, skills_json, created_at, updated_at)
       VALUES
        (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
    );

    const updateAgent = db.prepare(
      `UPDATE agents
       SET
        name = ?,
        emoji = ?,
        role = ?,
        personality = ?,
        status = ?,
        model = ?,
        openclaw_agent_id = ?,
        archived_at = NULL,
        updated_at = ?
       WHERE id = ?`
    );

    for (const rawAgent of input.agents) {
      const openclawId = rawAgent.id?.trim();
      const normalizedName = rawAgent.name?.trim();
      if (!openclawId || !normalizedName) {
        skipped += 1;
        continue;
      }

      const existing = findExisting.get(
        companyRow.id,
        openclawId,
        normalizedName,
        openclawId
      ) as
        | {
            id: string;
            name: string;
            role: string;
            personality: string;
            emoji: string | null;
            model: string | null;
            openclaw_agent_id: string | null;
          }
        | undefined;

      const emoji = rawAgent.emoji?.trim() || existing?.emoji || "🤖";
      const role = existing?.role?.trim() || "OpenClaw Agent";
      const personality = existing?.personality ?? "";
      const model = rawAgent.model?.trim() || existing?.model || "unknown";
      const status = openClawStatusToAgentStatus(rawAgent.status?.trim() ?? "offline");

      if (existing) {
        updateAgent.run(
          normalizedName,
          emoji,
          role,
          personality,
          status,
          model,
          openclawId,
          now,
          existing.id
        );
        updated += 1;
        continue;
      }

      insertAgent.run(
        randomUUID(),
        companyRow.id,
        normalizedName,
        normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        emoji,
        role,
        personality,
        status,
        model,
        openclawId,
        now,
        now
      );
      inserted += 1;
    }
  });

  tx();

  return {
    synced: inserted + updated,
    inserted,
    updated,
    skipped,
  };
}

export function getCompanyAgentProfile(input: {
  companyIdOrSlug: string;
  agentId: string;
  executionLimit?: number;
  activityLimit?: number;
}): CompanyAgentProfile {
  const db = getOrchestrationDb();
  const executionLimit = Math.max(1, Math.min(100, Math.trunc(input.executionLimit ?? 20)));
  const activityLimit = Math.max(1, Math.min(100, Math.trunc(input.activityLimit ?? 20)));

  const companyRow = db
    .prepare(
      `SELECT id, slug, name
       FROM companies
       WHERE archived_at IS NULL
         AND (id = ? OR slug = ?)
       LIMIT 1`
    )
    .get(input.companyIdOrSlug, input.companyIdOrSlug) as
    | {
        id: string;
        slug: string;
        name: string;
      }
    | undefined;

  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const agentRow = db
    .prepare(
      `SELECT
        a.id,
        a.company_id,
        a.project_id,
        a.name,
        a.slug,
        a.emoji,
        a.role,
        a.personality,
        a.avatar_url,
        a.status,
        a.current_task_id,
        t.title AS current_task_title,
        a.model,
        a.adapter_type,
        a.paperclip_agent_id,
        a.openclaw_agent_id,
        a.reporting_to,
        a.skills_json,
        a.tasks_completed,
        a.total_runtime_minutes,
        a.last_heartbeat,
        a.created_at,
        a.updated_at
       FROM agents a
       LEFT JOIN tasks t ON t.id = a.current_task_id
       WHERE a.archived_at IS NULL
         AND a.company_id = ?
         AND (a.id = ? OR lower(a.name) = lower(?) OR lower(a.slug) = lower(?))

       ORDER BY CASE WHEN a.id = ? THEN 0 ELSE 1 END, a.updated_at DESC
       LIMIT 1`
    )
    .get(companyRow.id, input.agentId, input.agentId, input.agentId, input.agentId) as AgentRow | undefined;

  if (!agentRow) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }

  const currentTasks = db
    .prepare(
      `SELECT
        t.id,
        t.title,
        t.status,
        t.priority,
        t.type,
        t.updated_at,
        p.id AS project_id,
        p.slug AS project_slug,
        p.name AS project_name
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.archived_at IS NULL
         AND p.archived_at IS NULL
         AND t.assignee_agent_id = ?
         AND t.status IN ('backlog','on_deck','in_progress','review','blocked')
       ORDER BY t.updated_at DESC
       LIMIT 12`
    )
    .all(agentRow.id) as Array<{
    id: string;
    title: string;
    status: "backlog" | "on_deck" | "in_progress" | "review" | "done" | "blocked";
    priority: "critical" | "high" | "medium" | "low";
    type: "feature" | "bug" | "maintenance" | "research" | "infrastructure" | "directive";
    updated_at: string;
    project_id: string;
    project_slug: string;
    project_name: string;
  }>;

  const executionHistory = db
    .prepare(
      `SELECT
        er.id,
        er.task_id,
        er.provider,
        er.status,
        er.session_id,
        er.started_at,
        er.completed_at,
        er.created_at,
        er.duration_ms,
        er.error_message,
        t.title AS task_title,
        p.id AS project_id,
        p.slug AS project_slug,
        p.name AS project_name
      FROM execution_runs er
      INNER JOIN tasks t ON t.id = er.task_id
      INNER JOIN projects p ON p.id = t.project_id
      WHERE er.agent_id = ?
        AND p.company_id = ?
        AND p.archived_at IS NULL
        AND t.archived_at IS NULL
      ORDER BY COALESCE(er.started_at, er.created_at) DESC, er.created_at DESC
      LIMIT ?`
    )
    .all(agentRow.id, companyRow.id, executionLimit) as Array<{
    id: string;
    task_id: string;
    provider: "openclaw" | "paperclip";
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    session_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    duration_ms: number | null;
    error_message: string | null;
    task_title: string;
    project_id: string;
    project_slug: string;
    project_name: string;
  }>;

  const recentComments = db
    .prepare(
      `SELECT
        'comment:' || c.id AS id,
        c.task_id AS task_id,
        t.title AS task_title,
        p.id AS project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        c.body AS message,
        c.created_at AS timestamp
       FROM comments c
       INNER JOIN tasks t ON t.id = c.task_id
       INNER JOIN projects p ON p.id = t.project_id
       WHERE c.author_agent_id = ?
         AND t.archived_at IS NULL
         AND p.archived_at IS NULL
         AND p.company_id = ?
       ORDER BY c.created_at DESC
       LIMIT ?`
    )
    .all(agentRow.id, companyRow.id, activityLimit) as Array<{
    id: string;
    task_id: string;
    task_title: string;
    project_id: string;
    project_slug: string;
    project_name: string;
    message: string;
    timestamp: string;
  }>;

  const recentEvents = db
    .prepare(
      `SELECT
        'event:' || te.id AS id,
        te.task_id AS task_id,
        COALESCE(t.title, '[Deleted task]') AS task_title,
        p.id AS project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        te.event_type AS event_type,
        te.from_status AS from_status,
        te.to_status AS to_status,
        te.created_at AS timestamp
       FROM task_events te
       INNER JOIN projects p ON p.id = te.project_id
       LEFT JOIN tasks t ON t.id = te.task_id
       WHERE te.agent_id = ?
         AND p.company_id = ?
         AND p.archived_at IS NULL
       ORDER BY te.created_at DESC
       LIMIT ?`
    )
    .all(agentRow.id, companyRow.id, activityLimit) as Array<{
    id: string;
    task_id: string;
    task_title: string;
    project_id: string;
    project_slug: string;
    project_name: string;
    event_type: "task.status_changed" | "task.assigned" | "task.unassigned";
    from_status: "backlog" | "on_deck" | "in_progress" | "review" | "done" | "blocked" | null;
    to_status: "backlog" | "on_deck" | "in_progress" | "review" | "done" | "blocked" | null;
    timestamp: string;
  }>;

  const activityCombined = [
    ...recentComments.map((row) => ({
      id: row.id,
      kind: "comment" as const,
      taskId: row.task_id,
      taskTitle: row.task_title,
      projectId: row.project_id,
      projectSlug: row.project_slug,
      projectName: row.project_name,
      message: row.message,
      timestamp: row.timestamp,
    })),
    ...recentEvents.map((row) => {
      const message =
        row.event_type === "task.status_changed" && row.from_status && row.to_status
          ? `${row.task_title} moved ${toApiStatus(row.from_status)} -> ${toApiStatus(row.to_status)}`
          : row.event_type === "task.assigned"
            ? `${row.task_title} assigned`
            : `${row.task_title} unassigned`;

      return {
        id: row.id,
        kind: "event" as const,
        taskId: row.task_id,
        taskTitle: row.task_title,
        projectId: row.project_id,
        projectSlug: row.project_slug,
        projectName: row.project_name,
        message,
        timestamp: row.timestamp,
      };
    }),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, activityLimit);

  const mappedRuns = executionHistory.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    provider: row.provider,
    status: row.status,
    sessionId: row.session_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    durationMs: row.duration_ms ?? undefined,
    errorMessage: row.error_message ?? undefined,
  }));

  return {
    company: {
      id: companyRow.id,
      slug: companyRow.slug,
      name: companyRow.name,
    },
    agent: agentFromRow(agentRow),
    currentTasks: currentTasks.map((task) => ({
      id: task.id,
      title: task.title,
      projectId: task.project_id,
      projectSlug: task.project_slug,
      projectName: task.project_name,
      status: toApiStatus(task.status),
      priority: toApiPriority(task.priority),
      type: toApiType(task.type),
      updatedAt: task.updated_at,
    })),
    recentActivity: activityCombined,
    executionHistory: mappedRuns,
    liveSession: mappedRuns.find((run) => run.status === "running" || run.status === "pending"),
  };
}

export function lookupAgentByName(input: {
  name: string;
  companyId?: string;
  projectId?: string;
}): { agent: { id: string; name: string; avatar?: string; companyId: string } } {
  const db = getOrchestrationDb();
  const normalized = input.name.trim();
  if (!normalized) {
    throw new OrchestrationApiError(400, "invalid_lookup_name", "name is required");
  }

  let companyId = input.companyId;
  if (input.projectId) {
    const project = getProjectRow(db, input.projectId);
    if (!project || !project.company_id) {
      throw new OrchestrationApiError(404, "project_not_found", "Project not found");
    }
    if (companyId && companyId !== project.company_id) {
      throw new OrchestrationApiError(
        400,
        "company_mismatch",
        "companyId must match the selected project's company"
      );
    }
    companyId = project.company_id;
  }

  const row = db
    .prepare(
      `SELECT id, name, avatar_url, company_id
       FROM agents
       WHERE archived_at IS NULL
         AND (? IS NULL OR company_id = ?)
         AND (
           id = ?
           OR lower(name) = lower(?)
           OR lower(name) LIKE '%' || lower(?) || '%'
         )
       ORDER BY
         CASE
           WHEN id = ? THEN 0
           WHEN lower(name) = lower(?) THEN 1
           WHEN lower(name) LIKE lower(?) || '%' THEN 2
           ELSE 3
         END,
         length(name) ASC,
         updated_at DESC
       LIMIT 1`
    )
    .get(
      companyId ?? null,
      companyId ?? null,
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
        avatar_url: string | null;
        company_id: string | null;
      }
    | undefined;

  if (!row || !row.company_id) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }

  return {
    agent: {
      id: row.id,
      name: row.name,
      avatar: row.avatar_url ?? undefined,
      companyId: row.company_id,
    },
  };
}

export function createProjectAgent(input: {
  projectId: string;
  companyId?: string;
  name: string;
  emoji: string;
  role: string;
  personality: string;
  avatarUrl?: string;
  model?: string;
  paperclipAgentId?: string;
  openclawAgentId?: string;
  reportingTo?: string;
  skills: string[];
  status: AgentStatusInput;
}): { agent: OrchestrationAgent } {
  const db = getOrchestrationDb();
  const project = getProjectRow(db, input.projectId);
  if (!project) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }
  if (!project.company_id) {
    throw new OrchestrationApiError(500, "project_company_missing", "Project has no company");
  }
  if (input.companyId && input.companyId !== project.company_id) {
    throw new OrchestrationApiError(
      400,
      "company_mismatch",
      "companyId must match the selected project's company"
    );
  }

  const nameConflict = db
    .prepare(
      "SELECT 1 FROM agents WHERE company_id = ? AND archived_at IS NULL AND lower(name) = lower(?) LIMIT 1"
    )
    .get(project.company_id, input.name);
  if (nameConflict) {
    throw new OrchestrationApiError(
      409,
      "agent_name_conflict",
      "An agent with this name already exists in the company"
    );
  }

  if (input.reportingTo) {
    const reporting = db
      .prepare("SELECT id FROM agents WHERE id = ? AND company_id = ? AND archived_at IS NULL")
      .get(input.reportingTo, project.company_id) as { id: string } | undefined;
    if (!reporting) {
      throw new OrchestrationApiError(
        400,
        "invalid_reporting_to",
        "reportingTo must reference an active agent in the same company"
      );
    }
  }

  if (input.paperclipAgentId) {
    const paperclipConflict = db
      .prepare(
        "SELECT id FROM agents WHERE paperclip_agent_id = ? AND archived_at IS NULL LIMIT 1"
      )
      .get(input.paperclipAgentId) as { id: string } | undefined;
    if (paperclipConflict) {
      throw new OrchestrationApiError(
        409,
        "paperclip_agent_conflict",
        "paperclipAgentId is already in use"
      );
    }
  }

  if (input.openclawAgentId) {
    const openclawConflict = db
      .prepare(
        "SELECT id FROM agents WHERE openclaw_agent_id = ? AND archived_at IS NULL LIMIT 1"
      )
      .get(input.openclawAgentId) as { id: string } | undefined;
    if (openclawConflict) {
      throw new OrchestrationApiError(
        409,
        "openclaw_agent_conflict",
        "openclawAgentId is already in use"
      );
    }
  }

  const now = new Date().toISOString();
  const agentId = randomUUID();
  const avatarUrl =
    input.avatarUrl ??
    generateAgentAvatarDataUrl({
      name: input.name,
      role: input.role,
      personality: input.personality,
      emoji: input.emoji,
      theme: resolveProjectAvatarTheme(db, project.id),
    });

  const createAgentTx = db.transaction(() => {
    const agentSlug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, slug, emoji, role, personality, avatar_url, status, current_task_id, model,
         openclaw_agent_id, paperclip_agent_id, reporting_to, skills_json, tasks_completed, total_runtime_minutes,
         last_heartbeat, created_at, updated_at, archived_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, NULL)`
    ).run(
      agentId,
      project.company_id,
      project.id,
      input.name,
      agentSlug,
      input.emoji || "🤖",
      input.role,
      input.personality,
      avatarUrl,
      input.status,
      input.model ?? null,
      input.openclawAgentId ?? null,
      input.paperclipAgentId ?? null,
      input.reportingTo ?? null,
      JSON.stringify(input.skills),
      now,
      now
    );

    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, project.id);
  });
  createAgentTx();

  if (input.openclawAgentId) {
    try {
      ensureOpenClawAgentScaffold({
        openclawAgentId: input.openclawAgentId,
        name: input.name,
        role: input.role,
        personality: input.personality,
        projectName: project.name,
        projectSlug: project.slug,
        model: input.model,
        skills: input.skills,
      });
    } catch (error) {
      const rollbackTx = db.transaction(() => {
        db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
        db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), project.id);
      });
      rollbackTx();
      throw error;
    }
  }

  const row = agentById(db, agentId);

  if (!row) {
    throw new OrchestrationApiError(500, "agent_create_failed", "Agent created but reload failed");
  }

  return { agent: agentFromRow(row) };
}

export function regenerateProjectAgentAvatar(input: {
  projectId: string;
  agentId: string;
}): { agent: OrchestrationAgent } {
  const db = getOrchestrationDb();
  const project = getProjectRow(db, input.projectId);
  if (!project) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }
  if (!project.company_id) {
    throw new OrchestrationApiError(500, "project_company_missing", "Project has no company");
  }

  const agent = db
    .prepare(
      `SELECT id, name, role, personality, emoji
       FROM agents
       WHERE id = ? AND company_id = ? AND archived_at IS NULL`
    )
    .get(input.agentId, project.company_id) as
    | { id: string; name: string; role: string; personality: string; emoji: string | null }
    | undefined;

  if (!agent) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }

  const now = new Date().toISOString();
  const avatarUrl = generateAgentAvatarDataUrl({
    name: agent.name,
    role: agent.role,
    personality: agent.personality ?? "",
    emoji: agent.emoji,
    theme: resolveProjectAvatarTheme(db, project.id),
    seed: randomUUID(),
  });

  const tx = db.transaction(() => {
    db.prepare("UPDATE agents SET avatar_url = ?, updated_at = ? WHERE id = ?").run(
      avatarUrl,
      now,
      agent.id
    );
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, project.id);
  });
  tx();

  const row = agentById(db, agent.id);

  if (!row) {
    throw new OrchestrationApiError(500, "agent_avatar_regen_failed", "Avatar regenerated but reload failed");
  }

  return { agent: agentFromRow(row) };
}

export function heartbeatProjectAgent(input: {
  agentId: string;
  status?: AgentStatusInput;
  currentTaskId?: string | null;
  runtimeMinutesDelta?: number;
  observedAt?: string;
  source?: "cron" | "openclaw" | "manual";
}): {
  agent: OrchestrationAgent;
  heartbeat: {
    source: "cron" | "openclaw" | "manual";
    receivedAt: string;
    observedAt: string;
    runtimeMinutesDelta: number;
  };
} {
  const db = getOrchestrationDb();
  const existing = db
    .prepare(
      `SELECT id, company_id, project_id, current_task_id, total_runtime_minutes
       FROM agents
       WHERE id = ? AND archived_at IS NULL`
    )
    .get(input.agentId) as
    | {
        id: string;
        company_id: string;
        project_id: string | null;
        current_task_id: string | null;
        total_runtime_minutes: number;
      }
    | undefined;

  if (!existing) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }

  const now = new Date().toISOString();
  const observedAt = input.observedAt ?? now;
  const runtimeMinutesDelta = Number(input.runtimeMinutesDelta ?? 0);

  if (!Number.isFinite(runtimeMinutesDelta) || runtimeMinutesDelta < 0) {
    throw new OrchestrationApiError(
      400,
      "invalid_runtime_delta",
      "runtimeMinutesDelta must be a non-negative number"
    );
  }

  if (input.currentTaskId) {
    if (!existing.project_id) {
      throw new OrchestrationApiError(
        400,
        "invalid_current_task",
        "currentTaskId must reference an active task in the agent's project"
      );
    }

    const task = db
      .prepare(
        `SELECT id
         FROM tasks
         WHERE id = ?
           AND project_id = ?
           AND archived_at IS NULL
         LIMIT 1`
      )
      .get(input.currentTaskId, existing.project_id) as { id: string } | undefined;

    if (!task) {
      throw new OrchestrationApiError(
        400,
        "invalid_current_task",
        "currentTaskId must reference an active task in the agent's project"
      );
    }
  }

  const totalRuntimeMinutes = Math.max(
    0,
    Math.trunc(Number(existing.total_runtime_minutes ?? 0) + runtimeMinutesDelta)
  );
  const source = input.source ?? "cron";
  const nextTaskId = input.currentTaskId === undefined ? existing.current_task_id : input.currentTaskId;
  const nextStatus = input.status ?? (nextTaskId ? "working" : "idle");

  db.prepare(
    `UPDATE agents
     SET status = ?, current_task_id = ?, total_runtime_minutes = ?, last_heartbeat = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    nextStatus,
    nextTaskId,
    totalRuntimeMinutes,
    observedAt,
    now,
    existing.id
  );

  if (existing.project_id) {
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, existing.project_id);
  }

  const row = agentById(db, existing.id);
  if (!row) {
    throw new OrchestrationApiError(500, "agent_heartbeat_failed", "Heartbeat saved but agent reload failed");
  }

  return {
    agent: agentFromRow(row),
    heartbeat: {
      source,
      receivedAt: now,
      observedAt,
      runtimeMinutesDelta: Math.trunc(runtimeMinutesDelta),
    },
  };
}
