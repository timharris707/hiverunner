import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export type SkillEffectivenessOutcome = "pass" | "fail" | "blocked" | "unknown";
export type SkillEffectivenessEventType = "available" | "explicit_use" | "review_outcome";
export type SkillHealthStatus = "healthy" | "needs_data" | "unused" | "stale" | "low_performing";
export type SkillHealthSeverity = "none" | "info" | "warning" | "danger";

export type SkillEffectivenessSummary = {
  skillId: string;
  skillSlug: string;
  skillName: string;
  skillStatus: string;
  skillVersion: number;
  assignedAgentNames: string[];
  availableCount: number;
  explicitUseCount: number;
  passCount: number;
  failCount: number;
  blockedCount: number;
  unknownCount: number;
  lastAvailableAt: string | null;
  lastExplicitUseAt: string | null;
  lastOutcomeAt: string | null;
  healthStatus: SkillHealthStatus;
  healthLabel: string;
  healthSeverity: SkillHealthSeverity;
  healthReason: string;
  needsAttention: boolean;
};

export type RunSkillEffectivenessEvent = {
  id: string;
  skillId: string | null;
  skillSlug: string | null;
  skillName: string;
  skillVersion: number | null;
  assignmentId: string | null;
  agentId: string | null;
  agentName: string | null;
  taskId: string | null;
  taskKey: string | null;
  eventType: SkillEffectivenessEventType;
  outcome: SkillEffectivenessOutcome | null;
  source: "system" | "agent" | "operator";
  note: string | null;
  createdAt: string;
};

export type RunSkillEffectiveness = {
  events: RunSkillEffectivenessEvent[];
  totals: {
    availableCount: number;
    explicitUseCount: number;
    passCount: number;
    failCount: number;
    blockedCount: number;
    unknownCount: number;
  };
};

type RuntimeSkill = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  version?: unknown;
  assignmentId?: unknown;
};

type ExecutionRunRow = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  token_usage_json: string | null;
};

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function runtimeSkillsFromUsage(usage: Record<string, unknown>): RuntimeSkill[] {
  return Array.isArray(usage.runtimeSkills)
    ? usage.runtimeSkills.filter((item): item is RuntimeSkill => (
        typeof item === "object" && item !== null && !Array.isArray(item)
      ))
    : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function companyIdForRun(db: Database.Database, run: ExecutionRunRow): string | null {
  if (run.task_id) {
    const task = db
      .prepare(
        `SELECT COALESCE(t.company_id, p.company_id) AS company_id
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.id = ?
         LIMIT 1`,
      )
      .get(run.task_id) as { company_id: string | null } | undefined;
    if (task?.company_id) return task.company_id;
  }

  if (run.agent_id) {
    const agent = db
      .prepare("SELECT company_id FROM agents WHERE id = ? LIMIT 1")
      .get(run.agent_id) as { company_id: string | null } | undefined;
    if (agent?.company_id) return agent.company_id;
  }

  return null;
}

function resolveSkillIds(
  db: Database.Database,
  companyId: string,
  skill: RuntimeSkill,
): { skillId: string | null; assignmentId: string | null } {
  const rawSkillId = stringValue(skill.id);
  const rawAssignmentId = stringValue(skill.assignmentId);
  const assignment = rawAssignmentId
    ? db
        .prepare("SELECT id FROM agent_skill_assignments WHERE id = ? LIMIT 1")
        .get(rawAssignmentId) as { id: string } | undefined
    : undefined;
  const assignmentId = assignment?.id ?? null;
  if (rawSkillId) {
    const row = db
      .prepare("SELECT id FROM company_skills WHERE company_id = ? AND id = ? LIMIT 1")
      .get(companyId, rawSkillId) as { id: string } | undefined;
    return { skillId: row?.id ?? null, assignmentId };
  }

  const slug = stringValue(skill.slug);
  if (!slug) {
    return { skillId: null, assignmentId };
  }

  const row = db
    .prepare("SELECT id FROM company_skills WHERE company_id = ? AND slug = ? LIMIT 1")
    .get(companyId, slug) as { id: string } | undefined;
  return { skillId: row?.id ?? null, assignmentId };
}

function alreadyRecorded(db: Database.Database, input: {
  executionRunId: string | null;
  skillId: string | null;
  assignmentId: string | null;
  taskId: string | null;
  eventType: SkillEffectivenessEventType;
  outcome?: SkillEffectivenessOutcome | null;
}): boolean {
  const row = db
    .prepare(
      `SELECT id
       FROM skill_effectiveness_events
       WHERE execution_run_id = ?
         AND COALESCE(skill_id, '') = COALESCE(?, '')
         AND COALESCE(assignment_id, '') = COALESCE(?, '')
         AND COALESCE(task_id, '') = COALESCE(?, '')
         AND event_type = ?
         AND COALESCE(outcome, '') = COALESCE(?, '')
       LIMIT 1`,
    )
    .get(
      input.executionRunId,
      input.skillId,
      input.assignmentId,
      input.taskId,
      input.eventType,
      input.outcome ?? null,
    ) as { id: string } | undefined;
  return Boolean(row);
}

function insertEvent(db: Database.Database, input: {
  companyId: string;
  skillId: string | null;
  assignmentId: string | null;
  agentId: string | null;
  taskId: string | null;
  executionRunId: string | null;
  eventType: SkillEffectivenessEventType;
  outcome?: SkillEffectivenessOutcome | null;
  source?: "system" | "agent" | "operator";
  metadata?: Record<string, unknown>;
}): boolean {
  if (alreadyRecorded(db, {
    executionRunId: input.executionRunId,
    skillId: input.skillId,
    assignmentId: input.assignmentId,
    taskId: input.taskId,
    eventType: input.eventType,
    outcome: input.outcome ?? null,
  })) {
    return false;
  }

  db.prepare(
    `INSERT INTO skill_effectiveness_events (
       id, company_id, skill_id, assignment_id, agent_id, task_id, execution_run_id,
       event_type, outcome, source, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.companyId,
    input.skillId,
    input.assignmentId,
    input.agentId,
    input.taskId,
    input.executionRunId,
    input.eventType,
    input.outcome ?? null,
    input.source ?? "system",
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  );
  return true;
}

function resolveCompany(companyIdOrSlug: string): { id: string; slug: string; name: string } {
  const db = getOrchestrationDb();
  const company = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return company;
}

function resolveCompanySkill(
  db: Database.Database,
  companyId: string,
  skillIdOrSlugOrName: string,
): { id: string; slug: string; name: string; version: number } {
  const skill = db
    .prepare(
      `SELECT id, slug, name, version
       FROM company_skills
       WHERE company_id = ?
         AND archived_at IS NULL
         AND status = 'active'
         AND (review_required = 0 OR review_state = 'approved')
         AND (id = ? OR slug = ? OR lower(name) = lower(?))
       LIMIT 1`,
    )
    .get(companyId, skillIdOrSlugOrName, skillIdOrSlugOrName, skillIdOrSlugOrName) as
      | { id: string; slug: string; name: string; version: number }
      | undefined;
  if (!skill) {
    throw new OrchestrationApiError(404, "skill_not_found", "Active approved skill not found");
  }
  return skill;
}

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function skillHealth(input: {
  skillStatus: string;
  assignedAgentCount: number;
  availableCount: number;
  explicitUseCount: number;
  passCount: number;
  failCount: number;
  blockedCount: number;
  lastAvailableAt: string | null;
  lastExplicitUseAt: string | null;
  lastOutcomeAt: string | null;
}): {
  healthStatus: SkillHealthStatus;
  healthLabel: string;
  healthSeverity: SkillHealthSeverity;
  healthReason: string;
  needsAttention: boolean;
} {
  if (input.skillStatus === "archived") {
    return {
      healthStatus: "healthy",
      healthLabel: "Archived",
      healthSeverity: "none",
      healthReason: "This skill is archived and no longer exported at runtime.",
      needsAttention: false,
    };
  }

  const outcomeCount = input.passCount + input.failCount + input.blockedCount;
  const issueCount = input.failCount + input.blockedCount;
  const issueRate = outcomeCount > 0 ? issueCount / outcomeCount : 0;
  const lastUseAge = ageDays(input.lastExplicitUseAt);
  const lastAvailableAge = ageDays(input.lastAvailableAt);

  if (outcomeCount >= 3 && issueRate >= 0.34) {
    return {
      healthStatus: "low_performing",
      healthLabel: "Low performing",
      healthSeverity: "danger",
      healthReason: `${issueCount}/${outcomeCount} reviewed outcome${outcomeCount === 1 ? "" : "s"} failed or blocked after this skill was available.`,
      needsAttention: true,
    };
  }

  if (input.availableCount >= 5 && input.explicitUseCount === 0) {
    return {
      healthStatus: "unused",
      healthLabel: "Unused",
      healthSeverity: "warning",
      healthReason: `Available on ${input.availableCount} run${input.availableCount === 1 ? "" : "s"} but never explicitly used.`,
      needsAttention: true,
    };
  }

  if (
    input.explicitUseCount > 0
    && ((lastUseAge !== null && lastUseAge >= 30) || (lastAvailableAge !== null && lastAvailableAge >= 30))
  ) {
    return {
      healthStatus: "stale",
      healthLabel: "Stale",
      healthSeverity: "warning",
      healthReason: lastUseAge !== null && lastUseAge >= 30
        ? `Last explicit use was ${lastUseAge} day${lastUseAge === 1 ? "" : "s"} ago.`
        : `Last runtime availability was ${lastAvailableAge} day${lastAvailableAge === 1 ? "" : "s"} ago.`,
      needsAttention: true,
    };
  }

  if (input.assignedAgentCount > 0 && input.availableCount === 0) {
    return {
      healthStatus: "needs_data",
      healthLabel: "Needs data",
      healthSeverity: "info",
      healthReason: "Assigned but not yet observed in a completed runtime run.",
      needsAttention: false,
    };
  }

  return {
    healthStatus: "healthy",
    healthLabel: "Healthy",
    healthSeverity: "none",
    healthReason: outcomeCount > 0
      ? `${input.passCount}/${outcomeCount} reviewed outcome${outcomeCount === 1 ? "" : "s"} passed.`
      : "No negative runtime signal has been observed.",
    needsAttention: false,
  };
}

function resolveCompanyTask(
  db: Database.Database,
  companyId: string,
  taskIdOrKey: string | null | undefined,
): { id: string; task_key: string | null } | null {
  if (!taskIdOrKey?.trim()) return null;
  const task = db
    .prepare(
      `SELECT t.id, t.task_key
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE COALESCE(t.company_id, p.company_id) = ?
         AND t.archived_at IS NULL
         AND (t.id = ? OR t.task_key = ?)
       LIMIT 1`,
    )
    .get(companyId, taskIdOrKey, taskIdOrKey) as { id: string; task_key: string | null } | undefined;
  return task ?? null;
}

function resolveExecutionRunForUse(db: Database.Database, input: {
  executionRunId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
}): string | null {
  if (input.executionRunId?.trim()) return input.executionRunId.trim();
  if (!input.taskId) return null;
  const row = db
    .prepare(
      `SELECT id
       FROM execution_runs
       WHERE task_id = ?
         AND (? IS NULL OR agent_id = ?)
         AND status IN ('running', 'completed')
       ORDER BY
         CASE status WHEN 'running' THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 1`,
    )
    .get(input.taskId, input.agentId ?? null, input.agentId ?? null) as { id: string } | undefined;
  return row?.id ?? null;
}

export function recordRuntimeSkillAvailabilityForRun(
  db: Database.Database,
  executionRunId: string,
): number {
  const run = db
    .prepare("SELECT id, task_id, agent_id, token_usage_json FROM execution_runs WHERE id = ? LIMIT 1")
    .get(executionRunId) as ExecutionRunRow | undefined;
  if (!run) return 0;

  const usage = parseJson(run.token_usage_json);
  const runtimeSkills = runtimeSkillsFromUsage(usage);
  if (runtimeSkills.length === 0) return 0;

  const companyId = companyIdForRun(db, run);
  if (!companyId) return 0;

  let inserted = 0;
  for (const skill of runtimeSkills) {
    const ids = resolveSkillIds(db, companyId, skill);
    const didInsert = insertEvent(db, {
      companyId,
      skillId: ids.skillId,
      assignmentId: ids.assignmentId,
      agentId: run.agent_id,
      taskId: run.task_id,
      executionRunId,
      eventType: "available",
      metadata: {
        skillSlug: stringValue(skill.slug),
        skillName: stringValue(skill.name),
        skillVersion: typeof skill.version === "number" ? skill.version : null,
      },
    });
    if (didInsert) inserted += 1;
  }
  return inserted;
}

export function recordTaskSkillReviewOutcome(
  db: Database.Database,
  input: {
    taskId: string;
    outcome: SkillEffectivenessOutcome;
    reviewerAgentId?: string | null;
    executionRunId?: string | null;
  },
): number {
  const runs = db
    .prepare(
      `SELECT id, task_id, agent_id, token_usage_json
       FROM execution_runs
       WHERE task_id = ?
         AND status = 'completed'
         AND (? IS NULL OR id = ?)
       ORDER BY completed_at DESC, created_at DESC`,
    )
    .all(input.taskId, input.executionRunId ?? null, input.executionRunId ?? null) as ExecutionRunRow[];

  let inserted = 0;
  for (const run of runs) {
    const usage = parseJson(run.token_usage_json);
    const runtimeSkills = runtimeSkillsFromUsage(usage);
    if (runtimeSkills.length === 0) continue;
    const companyId = companyIdForRun(db, run);
    if (!companyId) continue;

    for (const skill of runtimeSkills) {
      const ids = resolveSkillIds(db, companyId, skill);
      const didInsert = insertEvent(db, {
        companyId,
        skillId: ids.skillId,
        assignmentId: ids.assignmentId,
        agentId: run.agent_id,
        taskId: run.task_id,
        executionRunId: run.id,
        eventType: "review_outcome",
        outcome: input.outcome,
        source: "system",
        metadata: {
          reviewerAgentId: input.reviewerAgentId ?? null,
          skillSlug: stringValue(skill.slug),
          skillName: stringValue(skill.name),
          skillVersion: typeof skill.version === "number" ? skill.version : null,
        },
      });
      if (didInsert) inserted += 1;
    }
  }

  return inserted;
}

export function recordExplicitSkillUse(input: {
  companyIdOrSlug: string;
  skillIdOrSlugOrName: string;
  agentId?: string | null;
  taskIdOrKey?: string | null;
  executionRunId?: string | null;
  heartbeatRunId?: string | null;
  source?: "system" | "agent" | "operator";
  note?: string | null;
}): { company: { id: string; slug: string; name: string }; inserted: boolean; skillId: string; taskId: string | null; executionRunId: string | null } {
  const company = resolveCompany(input.companyIdOrSlug);
  const db = getOrchestrationDb();
  const skill = resolveCompanySkill(db, company.id, input.skillIdOrSlugOrName);
  const task = resolveCompanyTask(db, company.id, input.taskIdOrKey);
  const executionRunId = resolveExecutionRunForUse(db, {
    executionRunId: input.executionRunId,
    taskId: task?.id ?? null,
    agentId: input.agentId ?? null,
  });
  const assignment = input.agentId
    ? db
        .prepare(
          `SELECT id
           FROM agent_skill_assignments
           WHERE company_id = ?
             AND agent_id = ?
             AND skill_id = ?
             AND status = 'active'
             AND archived_at IS NULL
           LIMIT 1`,
        )
        .get(company.id, input.agentId, skill.id) as { id: string } | undefined
    : undefined;

  const inserted = insertEvent(db, {
    companyId: company.id,
    skillId: skill.id,
    assignmentId: assignment?.id ?? null,
    agentId: input.agentId ?? null,
    taskId: task?.id ?? null,
    executionRunId,
    eventType: "explicit_use",
    source: input.source ?? "agent",
    metadata: {
      skillSlug: skill.slug,
      skillName: skill.name,
      skillVersion: Number(skill.version),
      taskKey: task?.task_key ?? null,
      heartbeatRunId: input.heartbeatRunId ?? null,
      note: input.note ?? null,
    },
  });

  return {
    company,
    inserted,
    skillId: skill.id,
    taskId: task?.id ?? null,
    executionRunId,
  };
}

export function listCompanySkillEffectiveness(companyIdOrSlug: string, input?: {
  includeArchived?: boolean;
}): {
  company: { id: string; slug: string; name: string };
  summary: SkillEffectivenessSummary[];
  totals: {
    skillCount: number;
    availableCount: number;
    explicitUseCount: number;
    passCount: number;
    failCount: number;
    blockedCount: number;
    unknownCount: number;
    attentionCount: number;
  };
} {
  const company = resolveCompany(companyIdOrSlug);
  const db = getOrchestrationDb();
  const archivedClause = input?.includeArchived ? "" : "AND cs.archived_at IS NULL";
  const rows = db
    .prepare(
      `SELECT
         cs.id AS skill_id,
         cs.slug AS skill_slug,
         cs.name AS skill_name,
         cs.status AS skill_status,
         cs.version AS skill_version,
         COALESCE((
           SELECT GROUP_CONCAT(a.name, '|||')
           FROM agent_skill_assignments asa
           JOIN agents a ON a.id = asa.agent_id
           WHERE asa.skill_id = cs.id
             AND asa.archived_at IS NULL
             AND asa.status != 'archived'
         ), '') AS assigned_agent_names,
         COALESCE(SUM(CASE WHEN see.event_type = 'available' THEN 1 ELSE 0 END), 0) AS available_count,
         COALESCE(SUM(CASE WHEN see.event_type = 'explicit_use' THEN 1 ELSE 0 END), 0) AS explicit_use_count,
         COALESCE(SUM(CASE WHEN see.event_type = 'review_outcome' AND see.outcome = 'pass' THEN 1 ELSE 0 END), 0) AS pass_count,
         COALESCE(SUM(CASE WHEN see.event_type = 'review_outcome' AND see.outcome = 'fail' THEN 1 ELSE 0 END), 0) AS fail_count,
         COALESCE(SUM(CASE WHEN see.event_type = 'review_outcome' AND see.outcome = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked_count,
         COALESCE(SUM(CASE WHEN see.event_type = 'review_outcome' AND see.outcome = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown_count,
         MAX(CASE WHEN see.event_type = 'available' THEN see.created_at ELSE NULL END) AS last_available_at,
         MAX(CASE WHEN see.event_type = 'explicit_use' THEN see.created_at ELSE NULL END) AS last_explicit_use_at,
         MAX(CASE WHEN see.event_type = 'review_outcome' THEN see.created_at ELSE NULL END) AS last_outcome_at
       FROM company_skills cs
       LEFT JOIN skill_effectiveness_events see ON see.skill_id = cs.id
       WHERE cs.company_id = ?
         ${archivedClause}
       GROUP BY cs.id
       ORDER BY explicit_use_count DESC, available_count DESC, cs.name ASC`,
    )
    .all(company.id) as Array<{
      skill_id: string;
      skill_slug: string;
      skill_name: string;
      skill_status: string;
      skill_version: number;
      assigned_agent_names: string | null;
      available_count: number;
      explicit_use_count: number;
      pass_count: number;
      fail_count: number;
      blocked_count: number;
      unknown_count: number;
      last_available_at: string | null;
      last_explicit_use_at: string | null;
      last_outcome_at: string | null;
    }>;

  const summary = rows.map((row) => {
    const assignedAgentNames = row.assigned_agent_names
      ? row.assigned_agent_names.split("|||").map((name) => name.trim()).filter(Boolean)
      : [];
    const availableCount = Number(row.available_count);
    const explicitUseCount = Number(row.explicit_use_count);
    const passCount = Number(row.pass_count);
    const failCount = Number(row.fail_count);
    const blockedCount = Number(row.blocked_count);
    const health = skillHealth({
      skillStatus: row.skill_status,
      assignedAgentCount: assignedAgentNames.length,
      availableCount,
      explicitUseCount,
      passCount,
      failCount,
      blockedCount,
      lastAvailableAt: row.last_available_at,
      lastExplicitUseAt: row.last_explicit_use_at,
      lastOutcomeAt: row.last_outcome_at,
    });

    return {
      skillId: row.skill_id,
      skillSlug: row.skill_slug,
      skillName: row.skill_name,
      skillStatus: row.skill_status,
      skillVersion: Number(row.skill_version),
      assignedAgentNames,
      availableCount,
      explicitUseCount,
      passCount,
      failCount,
      blockedCount,
      unknownCount: Number(row.unknown_count),
      lastAvailableAt: row.last_available_at,
      lastExplicitUseAt: row.last_explicit_use_at,
      lastOutcomeAt: row.last_outcome_at,
      ...health,
    };
  });

  return {
    company,
    summary,
    totals: summary.reduce(
      (acc, row) => ({
        skillCount: acc.skillCount + 1,
        availableCount: acc.availableCount + row.availableCount,
        explicitUseCount: acc.explicitUseCount + row.explicitUseCount,
        passCount: acc.passCount + row.passCount,
        failCount: acc.failCount + row.failCount,
        blockedCount: acc.blockedCount + row.blockedCount,
        unknownCount: acc.unknownCount + row.unknownCount,
        attentionCount: acc.attentionCount + (row.needsAttention ? 1 : 0),
      }),
      { skillCount: 0, availableCount: 0, explicitUseCount: 0, passCount: 0, failCount: 0, blockedCount: 0, unknownCount: 0, attentionCount: 0 },
    ),
  };
}

export function listSkillEffectivenessForRun(
  db: Database.Database,
  executionRunId: string,
): RunSkillEffectiveness {
  const rows = db
    .prepare(
      `SELECT
         see.id,
         see.skill_id,
         see.assignment_id,
         see.agent_id,
         see.task_id,
         see.event_type,
         see.outcome,
         see.source,
         see.metadata_json,
         see.created_at,
         cs.slug AS skill_slug,
         cs.name AS skill_name,
         cs.version AS skill_version,
         a.name AS agent_name,
         t.task_key
       FROM skill_effectiveness_events see
       LEFT JOIN company_skills cs ON cs.id = see.skill_id
       LEFT JOIN agents a ON a.id = see.agent_id
       LEFT JOIN tasks t ON t.id = see.task_id
       WHERE see.execution_run_id = ?
       ORDER BY see.created_at ASC`,
    )
    .all(executionRunId) as Array<{
      id: string;
      skill_id: string | null;
      assignment_id: string | null;
      agent_id: string | null;
      task_id: string | null;
      event_type: SkillEffectivenessEventType;
      outcome: SkillEffectivenessOutcome | null;
      source: "system" | "agent" | "operator";
      metadata_json: string | null;
      created_at: string;
      skill_slug: string | null;
      skill_name: string | null;
      skill_version: number | null;
      agent_name: string | null;
      task_key: string | null;
    }>;

  const events = rows.map((row) => {
    const metadata = parseJson(row.metadata_json);
    return {
      id: row.id,
      skillId: row.skill_id,
      skillSlug: row.skill_slug ?? stringValue(metadata.skillSlug),
      skillName: row.skill_name ?? stringValue(metadata.skillName) ?? "Unknown skill",
      skillVersion: row.skill_version ?? numberOrNull(metadata.skillVersion),
      assignmentId: row.assignment_id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      taskId: row.task_id,
      taskKey: row.task_key ?? stringValue(metadata.taskKey),
      eventType: row.event_type,
      outcome: row.outcome,
      source: row.source,
      note: stringValue(metadata.note),
      createdAt: row.created_at,
    } satisfies RunSkillEffectivenessEvent;
  });

  return {
    events,
    totals: events.reduce(
      (acc, event) => ({
        availableCount: acc.availableCount + (event.eventType === "available" ? 1 : 0),
        explicitUseCount: acc.explicitUseCount + (event.eventType === "explicit_use" ? 1 : 0),
        passCount: acc.passCount + (event.eventType === "review_outcome" && event.outcome === "pass" ? 1 : 0),
        failCount: acc.failCount + (event.eventType === "review_outcome" && event.outcome === "fail" ? 1 : 0),
        blockedCount: acc.blockedCount + (event.eventType === "review_outcome" && event.outcome === "blocked" ? 1 : 0),
        unknownCount: acc.unknownCount + (event.eventType === "review_outcome" && event.outcome === "unknown" ? 1 : 0),
      }),
      { availableCount: 0, explicitUseCount: 0, passCount: 0, failCount: 0, blockedCount: 0, unknownCount: 0 },
    ),
  };
}
