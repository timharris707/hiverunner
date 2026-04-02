import { randomUUID } from "crypto";

import { generateAgentAvatarDataUrl } from "@/lib/orchestration/avatar";
import { ensureOpenClawAgentScaffold } from "@/lib/orchestration/openclaw-agent-scaffold";

import {
  type AgentRow,
  type AgentStatusInput,
  type OrchestrationAgent,
  OrchestrationApiError,
  agentById,
  agentFromRow,
  getOrchestrationDb,
  getProjectRow,
  resolveProjectAvatarTheme,
  isNonProductionAgent,
} from "./shared";

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
        a.emoji,
        a.role,
        a.personality,
        a.avatar_url,
        a.status,
        a.current_task_id,
        t.title AS current_task_title,
        a.model,
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
       WHERE a.company_id = ?
         AND a.archived_at IS NULL
       ORDER BY
         CASE WHEN a.project_id = ? THEN 0 ELSE 1 END,
         a.name ASC`
    )
    .all(projectRow.company_id, projectRow.id) as AgentRow[];

  return {
    agents: rows
      .filter((row) => {
        if (includeNonProduction) return true;
        return !isNonProductionAgent({ name: row.name, role: row.role });
      })
      .map(agentFromRow),
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
    db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, emoji, role, personality, avatar_url, status, current_task_id, model,
         openclaw_agent_id, paperclip_agent_id, reporting_to, skills_json, tasks_completed, total_runtime_minutes,
         last_heartbeat, created_at, updated_at, archived_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, NULL)`
    ).run(
      agentId,
      project.company_id,
      project.id,
      input.name,
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
