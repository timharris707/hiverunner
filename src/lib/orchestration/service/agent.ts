import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { generateAgentDossier } from "@/lib/orchestration/agent-dossier";
import { normalizeAgentSymbol } from "@/lib/orchestration/avatar-icons";
import { reconcileScopedTerminalOpenClawTasks } from "@/lib/orchestration/openclaw-reconciliation";
import { ensureOpenClawAgentScaffold } from "@/lib/orchestration/openclaw-agent-scaffold";
import { disableAgentRuntimesForArchivedAgent, upsertCompanyRuntime } from "@/lib/orchestration/runtime-registry";
import { ensureUniqueAgentRuntimeSlug } from "@/lib/orchestration/runtime-identifiers";
import { resolveCompanyAgentWorkspacePath } from "@/lib/workspaces/company-paths";
import { isPathContained } from "@/lib/workspaces/delete-safety";
import { normalizeAgentAdapterType } from "@/lib/orchestration/service/provider-activation";

import {
  type AgentRow,
  type AgentStatusInput,
  type OrchestrationAgent,
  type SprintStatus,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
  OrchestrationApiError,
  agentById,
  agentFromRow,
  getOrchestrationDb,
  getProjectRow,
  resolveCompanyId,
  isNonProductionAgent,
  toApiPriority,
  toApiSprintStatus,
  toApiStatus,
  toApiType,
} from "./shared";
import { createTaskComment } from "./comment";

type AgentProfileTask = {
  id: string;
  key?: string | null;
  title: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectColor?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  updatedAt: string;
  sprintId?: string | null;
  sprintName?: string | null;
  sprintStatus?: SprintStatus | null;
  sprintStartDate?: string | null;
  sprintEndDate?: string | null;
  sprintOwner?: string | null;
  sprintTaskCount?: number;
  sprintDoneCount?: number;
  companyGoalId?: string | null;
  companyGoalName?: string | null;
  companyGoalStatus?: SprintStatus | null;
  companyGoalProjectName?: string | null;
  companyGoalProjectColor?: string | null;
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
  provider: "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony" | "manual";
  status: "pending" | "running" | "completed" | "succeeded" | "failed" | "timed_out" | "cancelled";
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  durationMs?: number;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  totalCostUsd?: number;
};

type AgentUsageSummary = {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
};

function normalizeProfileRunProvider(agent: AgentRow): AgentProfileExecutionRun["provider"] {
  const provider = normalizeAgentAdapterType({
    adapterType: agent.adapter_type,
    openclawAgentId: agent.openclaw_agent_id,
  });
  if (
    provider === "openclaw" ||
    provider === "codex" ||
    provider === "anthropic" ||
    provider === "hermes" ||
    provider === "gemini" ||
    provider === "symphony" ||
    provider === "manual"
  ) {
    return provider;
  }
  return "manual";
}

function numberFromUsage(usage: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function nestedUsageObjects(usage: Record<string, unknown>): Record<string, unknown>[] {
  const nestedKeys = ["usage", "tokenUsage", "token_usage", "metrics", "adapterUsage", "adapter_usage"];
  return nestedKeys
    .map((key) => usage[key])
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));
}

function parseRunUsage(raw: string | null | undefined): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
} {
  if (!raw?.trim()) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalCostUsd: 0 };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalCostUsd: 0 };
    }
    const objects = [parsed as Record<string, unknown>, ...nestedUsageObjects(parsed as Record<string, unknown>)];
    const firstNumber = (keys: string[]) => {
      for (const object of objects) {
        const value = numberFromUsage(object, keys);
        if (value > 0) return value;
      }
      return 0;
    };
    const totalCostUsd = firstNumber(["totalCostUsd", "costUsd", "total_cost_usd", "cost_usd"]);
    const totalCostCents = firstNumber(["totalCostCents", "costCents", "total_cost_cents", "cost_cents"]);
    return {
      inputTokens: firstNumber(["inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "totalInputTokens", "total_input_tokens"]),
      outputTokens: firstNumber(["outputTokens", "output_tokens", "completionTokens", "completion_tokens", "totalOutputTokens", "total_output_tokens"]),
      cacheReadTokens: firstNumber(["cacheReadInputTokens", "cacheReadTokens", "cache_read_input_tokens", "cache_read_tokens", "cachedInputTokens", "cached_input_tokens"]),
      totalCostUsd: totalCostUsd || (totalCostCents > 0 ? totalCostCents / 100 : 0),
    };
  } catch {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalCostUsd: 0 };
  }
}

const UUID_V4ISH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEEDED_AGENT_ID_REGEX = /^[a-z][a-z0-9-]*(?:-\d{3})?$/i;
// Stable ID for the primary company — use this instead of slug for identity checks.
const DEFAULT_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

function hasCanonicalAgentId(id: string): boolean {
  return UUID_V4ISH_REGEX.test(id);
}

function hasSeededAgentId(id: string): boolean {
  return SEEDED_AGENT_ID_REGEX.test(id);
}

function isTrustedCompanyAgent(row: AgentRow): boolean {
  if (hasCanonicalAgentId(row.id)) return true;
  if (hasSeededAgentId(row.id)) return true;
  if (row.openclaw_agent_id?.trim()) return true;
  return false;
}

function companyAgentPreferenceScore(row: AgentRow): number {
  let score = 0;
  if (hasSeededAgentId(row.id)) score += 8;
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
  usageSummary: AgentUsageSummary;
};

type ActiveExecutionEvidenceRow = {
  id: string;
  agent_id: string;
  task_id: string;
  provider: string;
  status: "pending" | "running";
  session_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  task_title: string | null;
  project_id: string | null;
  project_slug: string | null;
  project_name: string | null;
};

type ActiveHeartbeatEvidenceRow = {
  id: string;
  agent_id: string;
  status: "queued" | "running";
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

const EXECUTION_STATUS_STALE_MS = 30 * 60 * 1000;
const HEARTBEAT_STATUS_STALE_MS = 5 * 60 * 1000;

function latestEvidenceTimestamp(
  ...values: Array<string | null | undefined>
): number | null {
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isFreshEvidence(timestampMs: number | null, maxAgeMs: number): boolean {
  if (timestampMs === null) return false;
  return Date.now() - timestampMs <= maxAgeMs;
}

function buildInClause(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function loadActiveExecutionEvidence(
  db: ReturnType<typeof getOrchestrationDb>,
  agentIds: string[],
): Map<string, ActiveExecutionEvidenceRow> {
  if (agentIds.length === 0) return new Map();

  const rows = db
    .prepare(
      `SELECT
         er.id,
         er.agent_id,
         er.task_id,
         er.provider,
         er.status,
         er.session_id,
         er.started_at,
         er.completed_at,
         er.created_at,
         er.updated_at,
         er.error_message,
         t.title AS task_title,
         p.id AS project_id,
         p.slug AS project_slug,
         p.name AS project_name
       FROM execution_runs er
       LEFT JOIN tasks t ON t.id = er.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE er.agent_id IN (${buildInClause(agentIds.length)})
         AND er.status IN ('pending', 'running')
         AND (
           er.provider <> 'openclaw'
           OR NULLIF(trim(COALESCE(er.session_id, '')), '') IS NOT NULL
         )
       ORDER BY COALESCE(er.updated_at, er.started_at, er.created_at) DESC, er.created_at DESC`
    )
    .all(...agentIds) as ActiveExecutionEvidenceRow[];

  const map = new Map<string, ActiveExecutionEvidenceRow>();
  for (const row of rows) {
    if (map.has(row.agent_id)) continue;
    const fresh = isFreshEvidence(
      latestEvidenceTimestamp(row.updated_at, row.started_at, row.created_at),
      EXECUTION_STATUS_STALE_MS,
    );
    if (!fresh) continue;
    map.set(row.agent_id, row);
  }
  return map;
}

function loadActiveHeartbeatEvidence(
  db: ReturnType<typeof getOrchestrationDb>,
  agentIds: string[],
): Map<string, ActiveHeartbeatEvidenceRow> {
  if (agentIds.length === 0) return new Map();

  const rows = db
    .prepare(
      `SELECT
         id,
         agent_id,
         status,
         started_at,
         finished_at,
         created_at,
         updated_at
       FROM heartbeat_runs
       WHERE agent_id IN (${buildInClause(agentIds.length)})
         AND status = 'running'
       ORDER BY COALESCE(updated_at, started_at, created_at) DESC, created_at DESC`
    )
    .all(...agentIds) as ActiveHeartbeatEvidenceRow[];

  const map = new Map<string, ActiveHeartbeatEvidenceRow>();
  for (const row of rows) {
    if (map.has(row.agent_id)) continue;
    const fresh = isFreshEvidence(
      latestEvidenceTimestamp(row.updated_at, row.started_at, row.created_at),
      HEARTBEAT_STATUS_STALE_MS,
    );
    if (!fresh) continue;
    map.set(row.agent_id, row);
  }
  return map;
}

function resolveEffectiveAgentStatus(
  persistedStatus: AgentStatusInput,
  hasFreshExecution: boolean,
  hasFreshHeartbeat: boolean,
): AgentStatusInput {
  // Operator-explicit states beat fresh-evidence overrides. A paused agent
  // stays paused even if a still-running heartbeat_run or execution_run is
  // mid-flight: the operator's Pause click is the source of truth, and
  // letting stale activity re-label the agent "working" makes the button
  // appear broken on the dashboard. Same logic for offline.
  if (persistedStatus === "paused" || persistedStatus === "offline") {
    return persistedStatus;
  }

  if (hasFreshExecution || hasFreshHeartbeat) {
    return "working";
  }

  if (persistedStatus === "error") {
    return persistedStatus;
  }

  return "idle";
}

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

  reconcileScopedTerminalOpenClawTasks({ projectId: projectRow.id }, db);

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
        CASE
          WHEN a.avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || ? || '/agents/' || COALESCE(NULLIF(a.slug, ''), a.id) || '/avatar?size=64'
          ELSE NULL
        END AS avatar_url,
        a.status,
        a.current_task_id,
        t.title AS current_task_title,
        a.model,
        a.adapter_type,
        a.runtime_slug,
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
    .all(projectRow.company_id, projectRow.company_id, projectRow.id) as AgentRow[];

  return {
    agents: dedupeCompanyAgentsByName(
      rows.filter((row) => {
        if (!isTrustedCompanyAgent(row)) return false;
        if (!row.project_id) return false;
        if (includeNonProduction) return true;
        return !isNonProductionAgent({ name: row.name, role: row.role });
      })
    ).map((row) => agentFromRow(row)),
  };
}

export function listCompanyAgents(
  companyIdOrSlug: string,
  options?: { includeNonProduction?: boolean; includeArchived?: boolean }
): { agents: OrchestrationAgent[] } {
  const db = getOrchestrationDb();
  const includeNonProduction = options?.includeNonProduction ?? false;
  const includeArchived = options?.includeArchived ?? false;

  const companyId = resolveCompanyId(db, companyIdOrSlug);
  if (!companyId) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  const companyRow = { id: companyId };

  reconcileScopedTerminalOpenClawTasks({ companyId: companyRow.id }, db);

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
        CASE
          WHEN a.avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || ? || '/agents/' || COALESCE(NULLIF(a.slug, ''), a.id) || '/avatar?size=64'
          ELSE NULL
        END AS avatar_url,
        a.status,
        a.current_task_id,
        t.title AS current_task_title,
        a.model,
        a.adapter_type,
        a.runtime_slug,
        a.openclaw_agent_id,
        a.reporting_to,
        mgr.name AS reporting_to_name,
        hap.id AS hire_approval_id,
        hap.status AS hire_approval_status,
        a.skills_json,
        a.tasks_completed,
        a.total_runtime_minutes,
        a.last_heartbeat,
        a.created_at,
        a.updated_at,
        a.archived_at,
        a.avatar_style_id,
        a.avatar_gender,
        a.avatar_age,
        a.avatar_hair_color,
        a.avatar_hair_length,
        a.avatar_eye_color,
        a.avatar_vibe,
        a.voice_id
       FROM agents a
       LEFT JOIN tasks t ON t.id = a.current_task_id
       LEFT JOIN agents mgr ON mgr.id = a.reporting_to
       LEFT JOIN approvals hap
         ON hap.company_id = a.company_id
        AND hap.type = 'hire_agent'
        AND hap.status IN ('pending', 'revision_requested')
        AND json_extract(hap.payload_json, '$.agentId') = a.id
       WHERE a.company_id = ?
         AND (? = 1 OR a.archived_at IS NULL)
       ORDER BY a.name ASC`
    )
    .all(companyRow.id, companyRow.id, includeArchived ? 1 : 0) as AgentRow[];

  const filteredRows = dedupeCompanyAgentsByName(
    rows
      .filter((row) => {
        if (!isTrustedCompanyAgent(row)) return false;
        if (includeNonProduction) return true;
        return !isNonProductionAgent({ name: row.name, role: row.role });
      })
  );

  const agentIds = filteredRows.map((row) => row.id);
  const activeExecutionByAgent = loadActiveExecutionEvidence(db, agentIds);
  const activeHeartbeatByAgent = loadActiveHeartbeatEvidence(db, agentIds);

  return {
    agents: filteredRows.map((row) => {
      const activeExecution = activeExecutionByAgent.get(row.id);
      const activeHeartbeat = activeHeartbeatByAgent.get(row.id);
      const status = resolveEffectiveAgentStatus(
        row.status,
        Boolean(activeExecution),
        Boolean(activeHeartbeat),
      );

      return agentFromRow(row, {
        status,
        currentTask: activeExecution?.task_title ?? undefined,
      });
    }),
  };
}

export function syncCompanyAgentsFromOpenClaw(input: {
  companyIdOrSlug: string;
  agents: OpenClawAgentSnapshot[];
  allowNonDefaultCompanyImport?: boolean;
}): { synced: number; inserted: number; updated: number; skipped: number } {
  const db = getOrchestrationDb();
  // Resolve via direct match or slug alias.
  const resolvedId = resolveCompanyId(db, input.companyIdOrSlug);
  const companyRow = resolvedId
    ? (db.prepare("SELECT id, slug FROM companies WHERE id = ? AND archived_at IS NULL").get(resolvedId) as { id: string; slug: string } | undefined)
    : undefined;

  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  if (!input.allowNonDefaultCompanyImport && companyRow.id !== DEFAULT_COMPANY_ID) {
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
        runtime_slug,
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
        (id, company_id, project_id, name, slug, runtime_slug, emoji, role, personality, avatar_url, status, model, openclaw_agent_id, skills_json, created_at, updated_at)
       VALUES
        (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
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
        runtime_slug = COALESCE(runtime_slug, ?),
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
            runtime_slug: string | null;
            openclaw_agent_id: string | null;
          }
        | undefined;

      const role = existing?.role?.trim() || "Runtime Agent";
      const emoji = normalizeAgentSymbol(rawAgent.emoji?.trim() || existing?.emoji, role);
      const personality = existing?.personality ?? "";
      const model = rawAgent.model?.trim() || existing?.model || "unknown";
      const status = openClawStatusToAgentStatus(rawAgent.status?.trim() ?? "offline");
      const runtimeSlug =
        existing?.runtime_slug?.trim() ||
        ensureUniqueAgentRuntimeSlug(db, companyRow.id, normalizedName);

      if (existing) {
        updateAgent.run(
          normalizedName,
          emoji,
          role,
          personality,
          status,
          model,
          runtimeSlug,
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
        runtimeSlug,
        emoji,
        role,
        personality,
        null,
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
         AND (id = ? OR slug = ? OR company_code = ?)
       LIMIT 1`
    )
    .get(input.companyIdOrSlug, input.companyIdOrSlug, input.companyIdOrSlug) as
    | {
        id: string;
        slug: string;
        name: string;
      }
    | undefined;

  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const loadAgentRow = () =>
    db
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
          CASE
            WHEN a.avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || ? || '/agents/' || COALESCE(NULLIF(a.slug, ''), a.id) || '/avatar'
            ELSE NULL
          END AS avatar_url,
          a.status,
          a.current_task_id,
          t.title AS current_task_title,
          a.model,
          a.adapter_type,
          a.runtime_slug,
          a.openclaw_agent_id,
          a.reporting_to,
          a.skills_json,
          a.tasks_completed,
          a.total_runtime_minutes,
          a.last_heartbeat,
          a.created_at,
          a.updated_at,
          a.avatar_style_id,
          a.avatar_gender,
          a.avatar_age,
          a.avatar_hair_color,
          a.avatar_hair_length,
          a.avatar_eye_color,
          a.avatar_vibe,
          a.voice_id
         FROM agents a
         LEFT JOIN tasks t ON t.id = a.current_task_id
         WHERE a.archived_at IS NULL
           AND a.company_id = ?
           AND (a.id = ? OR lower(a.name) = lower(?) OR lower(a.slug) = lower(?))

         ORDER BY CASE WHEN a.id = ? THEN 0 ELSE 1 END, a.updated_at DESC
         LIMIT 1`
      )
      .get(companyRow.id, companyRow.id, input.agentId, input.agentId, input.agentId, input.agentId) as AgentRow | undefined;

  let agentRow = loadAgentRow();

  if (!agentRow) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }

  reconcileScopedTerminalOpenClawTasks(
    { companyId: companyRow.id, agentId: agentRow.id },
    db,
  );
  agentRow = loadAgentRow();

  if (!agentRow) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }

  const activeExecutionByAgent = loadActiveExecutionEvidence(db, [agentRow.id]);
  const activeHeartbeatByAgent = loadActiveHeartbeatEvidence(db, [agentRow.id]);
  const activeExecution = activeExecutionByAgent.get(agentRow.id);
  const activeHeartbeat = activeHeartbeatByAgent.get(agentRow.id);
  const effectiveStatus = resolveEffectiveAgentStatus(
    agentRow.status,
    Boolean(activeExecution),
    Boolean(activeHeartbeat),
  );
  const heartbeatProvider = normalizeProfileRunProvider(agentRow);

  const currentTasks = db
    .prepare(
      `SELECT
        t.id,
        t.task_key,
        t.title,
        t.status,
        t.priority,
        t.type,
        t.updated_at,
        p.id AS project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        p.color AS project_color,
        s.id AS sprint_id,
        s.name AS sprint_name,
        s.status AS sprint_status,
        s.start_date AS sprint_start_date,
        s.end_date AS sprint_end_date,
        s.owner AS sprint_owner,
        parent_s.id AS company_goal_id,
        parent_s.name AS company_goal_name,
        parent_s.status AS company_goal_status,
        goal_project.name AS company_goal_project_name,
        goal_project.color AS company_goal_project_color,
        (
          SELECT COUNT(*)
          FROM tasks sprint_tasks
          WHERE sprint_tasks.sprint_id = s.id
            AND sprint_tasks.archived_at IS NULL
        ) AS sprint_task_count,
        (
          SELECT COUNT(*)
          FROM tasks sprint_tasks
          WHERE sprint_tasks.sprint_id = s.id
            AND sprint_tasks.archived_at IS NULL
            AND sprint_tasks.status = 'done'
        ) AS sprint_done_count
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
       LEFT JOIN projects goal_project ON goal_project.id = parent_s.project_id
       WHERE t.archived_at IS NULL
         AND p.archived_at IS NULL
         AND t.assignee_agent_id = ?
         AND t.status IN ('backlog','to-do','in_progress','review','blocked','done')
       ORDER BY t.updated_at DESC
       LIMIT 50`
    )
    .all(agentRow.id) as Array<{
    id: string;
    task_key: string | null;
    title: string;
    status: "backlog" | "to-do" | "in_progress" | "review" | "done" | "blocked";
    priority: "critical" | "high" | "medium" | "low";
    type: "feature" | "bug" | "maintenance" | "research" | "infrastructure" | "directive";
    updated_at: string;
    project_id: string;
    project_slug: string;
    project_name: string;
    project_color: string | null;
    sprint_id: string | null;
    sprint_name: string | null;
    sprint_status: "planning" | "active" | "completed" | null;
    sprint_start_date: string | null;
    sprint_end_date: string | null;
    sprint_owner: string | null;
    company_goal_id: string | null;
    company_goal_name: string | null;
    company_goal_status: "planning" | "active" | "completed" | null;
    company_goal_project_name: string | null;
    company_goal_project_color: string | null;
    sprint_task_count: number | null;
    sprint_done_count: number | null;
  }>;

  // UNION execution_runs + heartbeat_runs to show the full run history.
  // execution_runs are created by the orchestration runtime adapters.
  // heartbeat_runs are created by the OpenClaw heartbeat engine and represent
  // the actual agent activity cycles. Without this union, agents using the
  // heartbeat engine (adapter_type=openclaw) show only sparse/stale entries.
  const executionHistory = db
    .prepare(
      `SELECT * FROM (
        /* execution_runs — runtime-created runs */
        SELECT
          er.id,
          er.task_id,
          er.provider,
          er.runner_provider,
          er.runner_model,
          CASE WHEN er.status = 'completed' THEN 'succeeded' ELSE er.status END AS status,
          er.session_id,
          er.started_at,
          er.completed_at AS finished_at,
          er.created_at,
          er.duration_ms,
          er.error_message,
          er.token_usage_json,
          t.title AS task_title,
          t.task_key,
          p.id AS project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          hb_link.invocation_source AS hb_invocation_source,
          wr_link.source AS wr_source,
          wr_link.reason AS wr_reason,
          'execution_run' AS run_source
        FROM execution_runs er
        INNER JOIN tasks t ON t.id = er.task_id
        INNER JOIN projects p ON p.id = t.project_id
        LEFT JOIN heartbeat_runs hb_link ON hb_link.session_id_after = er.session_id
          AND hb_link.agent_id = er.agent_id
        LEFT JOIN agent_wakeup_requests wr_link ON wr_link.id = hb_link.wakeup_request_id
        WHERE er.agent_id = ?
          AND p.company_id = ?
          AND p.archived_at IS NULL
          AND t.archived_at IS NULL

        UNION ALL

        /* heartbeat_runs — engine-level activity cycles (OpenClaw heartbeat) */
        SELECT
          hb.id,
          NULL AS task_id,
          ? AS provider,
          NULL AS runner_provider,
          NULL AS runner_model,
          hb.status,
          hb.session_id_after AS session_id,
          hb.started_at,
          hb.finished_at,
          hb.created_at,
          CASE
            WHEN hb.started_at IS NOT NULL AND hb.finished_at IS NOT NULL
            THEN CAST((julianday(hb.finished_at) - julianday(hb.started_at)) * 86400000 AS INTEGER)
            ELSE NULL
          END AS duration_ms,
          hb.error AS error_message,
          hb.usage_json AS token_usage_json,
          NULL AS task_title,
          NULL AS task_key,
          NULL AS project_id,
          NULL AS project_slug,
          NULL AS project_name,
          hb.invocation_source AS hb_invocation_source,
          wr.source AS wr_source,
          wr.reason AS wr_reason,
          'heartbeat_run' AS run_source
        FROM heartbeat_runs hb
        LEFT JOIN agent_wakeup_requests wr ON wr.id = hb.wakeup_request_id
        WHERE hb.agent_id = ?
          AND hb.company_id = ?
      )
      ORDER BY COALESCE(started_at, created_at) DESC, created_at DESC
      LIMIT ?`
    )
    .all(agentRow.id, companyRow.id, heartbeatProvider, agentRow.id, companyRow.id, executionLimit) as Array<{
    id: string;
    task_id: string | null;
    provider: string;
    runner_provider: string | null;
    runner_model: string | null;
    status: string;
    session_id: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    duration_ms: number | null;
    error_message: string | null;
    token_usage_json: string | null;
    task_title: string | null;
    task_key: string | null;
    project_id: string | null;
    project_slug: string | null;
    project_name: string | null;
    hb_invocation_source: string | null;
    wr_source: string | null;
    wr_reason: string | null;
    run_source: "execution_run" | "heartbeat_run";
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
    from_status: "backlog" | "to-do" | "in_progress" | "review" | "done" | "blocked" | null;
    to_status: "backlog" | "to-do" | "in_progress" | "review" | "done" | "blocked" | null;
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

  const mappedRuns: AgentProfileExecutionRun[] = executionHistory.map((row) => {
    const usage = parseRunUsage(row.token_usage_json);
    // Derive trigger type from heartbeat invocation_source or wakeup_request source
    const triggerSource = row.hb_invocation_source ?? row.wr_source ?? undefined;
    let triggerType: string | undefined;
    if (triggerSource === "timer") triggerType = "Timer";
    else if (triggerSource === "issue_assigned") triggerType = "Assignment";
    else if (triggerSource === "routine") triggerType = "Automation";
    else if (triggerSource === "wakeup_request" || triggerSource === "on_demand" || triggerSource === "explicit") triggerType = "Automation";
    else if (triggerSource === "kickoff") triggerType = "Kickoff";
    else if (triggerSource === "api") triggerType = "API";

    return {
      id: row.id,
      taskId: row.task_id ?? "",
      taskTitle: row.task_title ?? (row.run_source === "heartbeat_run" ? "Heartbeat cycle" : "Untitled Task"),
      taskKey: row.task_key ?? undefined,
      projectId: row.project_id ?? "",
      projectSlug: row.project_slug ?? "",
      projectName: row.project_name ?? "",
      provider: row.provider as AgentProfileExecutionRun["provider"],
      runnerProvider: row.runner_provider ?? undefined,
      runnerModel: row.runner_model ?? undefined,
      status: row.status as AgentProfileExecutionRun["status"],
      sessionId: row.session_id ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.finished_at ?? undefined,
      createdAt: row.created_at,
      durationMs: row.duration_ms ?? undefined,
      errorMessage: row.error_message ?? undefined,
      inputTokens: usage.inputTokens || undefined,
      outputTokens: usage.outputTokens || undefined,
      cacheReadTokens: usage.cacheReadTokens || undefined,
      totalCostUsd: usage.totalCostUsd || undefined,
      triggerType,
      triggerReason: row.wr_reason ?? undefined,
    };
  });

  const usageRows = db
    .prepare(
      `SELECT status, duration_ms, token_usage_json AS usage_json
       FROM execution_runs
       WHERE agent_id = ?

       UNION ALL

       SELECT
         status,
         CASE
           WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
           THEN CAST((julianday(finished_at) - julianday(started_at)) * 86400000 AS INTEGER)
           ELSE NULL
         END AS duration_ms,
         usage_json
       FROM heartbeat_runs
       WHERE agent_id = ?`,
    )
    .all(agentRow.id, agentRow.id) as Array<{
    status: string;
    duration_ms: number | null;
    usage_json: string | null;
  }>;

  const usageSummary = usageRows.reduce<AgentUsageSummary>((summary, row) => {
    const usage = parseRunUsage(row.usage_json);
    summary.totalRuns += 1;
    if (row.status === "completed" || row.status === "succeeded") summary.completedRuns += 1;
    if (row.status === "failed" || row.status === "timed_out") summary.failedRuns += 1;
    summary.totalDurationMs += Math.max(0, Number(row.duration_ms ?? 0));
    summary.inputTokens += usage.inputTokens;
    summary.outputTokens += usage.outputTokens;
    summary.cacheReadTokens += usage.cacheReadTokens;
    summary.totalCostUsd += usage.totalCostUsd;
    return summary;
  }, {
    totalRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    totalDurationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalCostUsd: 0,
  });

  const liveSession = activeExecution
    ? {
        id: activeExecution.id,
        taskId: activeExecution.task_id,
        taskTitle: activeExecution.task_title ?? "Untitled Task",
        projectId: activeExecution.project_id ?? "",
        projectSlug: activeExecution.project_slug ?? "",
        projectName: activeExecution.project_name ?? "",
        provider: activeExecution.provider as AgentProfileExecutionRun["provider"],
        status: activeExecution.status,
        sessionId: activeExecution.session_id ?? undefined,
        startedAt: activeExecution.started_at ?? undefined,
        completedAt: activeExecution.completed_at ?? undefined,
        createdAt: activeExecution.created_at,
        errorMessage: activeExecution.error_message ?? undefined,
      }
    : undefined;

  return {
    company: {
      id: companyRow.id,
      slug: companyRow.slug,
      name: companyRow.name,
    },
    agent: agentFromRow(agentRow, {
      status: effectiveStatus,
      currentTask: activeExecution?.task_title ?? undefined,
    }),
    currentTasks: currentTasks.map((task) => ({
      id: task.id,
      key: task.task_key || null,
      title: task.title,
      projectId: task.project_id,
      projectSlug: task.project_slug,
      projectName: task.project_name,
      projectColor: task.project_color ?? undefined,
      status: toApiStatus(task.status),
      priority: toApiPriority(task.priority),
      type: toApiType(task.type),
      updatedAt: task.updated_at,
      sprintId: task.sprint_id ?? undefined,
      sprintName: task.sprint_name ?? undefined,
      sprintStatus: task.sprint_status ? toApiSprintStatus(task.sprint_status) : undefined,
      sprintStartDate: task.sprint_start_date ?? undefined,
      sprintEndDate: task.sprint_end_date ?? undefined,
      sprintOwner: task.sprint_owner ?? undefined,
      sprintTaskCount: Number(task.sprint_task_count ?? 0),
      sprintDoneCount: Number(task.sprint_done_count ?? 0),
      companyGoalId: task.company_goal_id ?? undefined,
      companyGoalName: task.company_goal_name ?? undefined,
      companyGoalStatus: task.company_goal_status ? toApiSprintStatus(task.company_goal_status) : undefined,
      companyGoalProjectName: task.company_goal_project_name ?? undefined,
      companyGoalProjectColor: task.company_goal_project_color ?? undefined,
    })),
    recentActivity: activityCombined,
    executionHistory: mappedRuns,
    liveSession,
    usageSummary,
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
      `SELECT
         id,
         name,
         CASE
           WHEN avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || company_id || '/agents/' || COALESCE(NULLIF(slug, ''), id) || '/avatar?size=64'
           ELSE NULL
         END AS avatar_url,
         company_id
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
  openclawAgentId?: string;
  reportingTo?: string;
  avatarStyleId?: string;
  avatarGender?: string;
  avatarAge?: number;
  avatarHairColor?: string;
  avatarHairLength?: string;
  avatarEyeColor?: string;
  avatarVibe?: string;
  voiceId?: string;
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
  const avatarUrl = input.avatarUrl?.trim() || null;
  const agentSymbol = normalizeAgentSymbol(input.emoji, input.role);
  const adapterType = input.openclawAgentId
    ? "openclaw"
    : "manual";
  const companyId = project.company_id;
  const agentSlug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const runtimeSlug = ensureUniqueAgentRuntimeSlug(db, companyId, input.name);
  const company = db
    .prepare("SELECT name FROM companies WHERE id = ? AND archived_at IS NULL")
    .get(companyId) as { name: string } | undefined;
  const reportingAgent = input.reportingTo
    ? db
        .prepare("SELECT name FROM agents WHERE id = ? AND company_id = ? AND archived_at IS NULL")
        .get(input.reportingTo, companyId) as { name: string } | undefined
    : undefined;
  const dossier = generateAgentDossier({
    name: input.name,
    role: input.role,
    companyName: company?.name ?? "HiveRunner",
    projectName: project.name,
    projectSlug: project.slug,
    reportsTo: reportingAgent?.name ?? "Unassigned",
    emoji: agentSymbol,
    personality: input.personality,
    capabilities: input.skills,
    avatarStyleId: input.avatarStyleId,
    avatarGender: input.avatarGender,
    avatarAge: input.avatarAge,
    avatarHairColor: input.avatarHairColor,
    avatarHairLength: input.avatarHairLength,
    avatarEyeColor: input.avatarEyeColor,
    avatarVibe: input.avatarVibe,
    voiceId: input.voiceId,
  });

  const createAgentTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, slug, emoji, role, personality, avatar_url,
         avatar_style_id, avatar_gender, avatar_age, avatar_hair_color, avatar_hair_length,
         avatar_eye_color, avatar_vibe, voice_id, status, current_task_id, model,
         adapter_type, runtime_slug, openclaw_agent_id, reporting_to, skills_json, tasks_completed, total_runtime_minutes,
         last_heartbeat, created_at, updated_at, archived_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, NULL)`
    ).run(
      agentId,
      companyId,
      project.id,
      input.name,
      agentSlug,
      agentSymbol,
      input.role,
      dossier.personality,
      avatarUrl,
      dossier.avatar.styleId,
      dossier.avatar.gender,
      dossier.avatar.age,
      dossier.avatar.hairColor,
      dossier.avatar.hairLength,
      dossier.avatar.eyeColor,
      dossier.avatar.vibe,
      dossier.voice.voiceId,
      input.status,
      input.model ?? null,
      adapterType,
      runtimeSlug,
      input.openclawAgentId ?? null,
      input.reportingTo ?? null,
      JSON.stringify(input.skills),
      now,
      now
    );

    // Seed agent_runtime_state eagerly so readers don't race against the
    // engine's lazy getOrCreateRuntimeState. Same column set and defaults
    // as engine.ts:431 so the lazy path stays a no-op for future agents.
    db.prepare(
      `INSERT INTO agent_runtime_state
        (agent_id, company_id, adapter_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(agentId, companyId, adapterType, now, now);

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

  upsertCompanyRuntime({
    companyIdOrSlug: project.company_id,
    agentId,
    provider: adapterType,
    runtimeSlug: runtimeSlug,
    displayName: `${input.name} runtime`,
    runtimeKind: adapterType === "manual" ? "manual" : "cli",
    scope: "agent",
    command:
      adapterType === "openclaw"
        ? "openclaw"
        : null,
    status: adapterType === "manual" ? "disabled" : "unknown",
    workspaceRoot: null,
    metadata: {
      source: "createProjectAgent",
      openclawAgentId: input.openclawAgentId ?? null,
      model: input.model ?? null,
    },
  });

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
  const agentSymbol = normalizeAgentSymbol(agent.emoji, agent.role);

  const tx = db.transaction(() => {
    db.prepare("UPDATE agents SET avatar_url = NULL, emoji = ?, updated_at = ? WHERE id = ?").run(
      agentSymbol,
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
  progressComment?: string;
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
      `SELECT id, company_id, project_id, status, current_task_id, total_runtime_minutes
       FROM agents
       WHERE id = ? AND archived_at IS NULL`
    )
    .get(input.agentId) as
    | {
        id: string;
        company_id: string;
        project_id: string | null;
        status: AgentStatusInput;
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
  const nextStatus =
    source !== "manual" && (existing.status === "paused" || existing.status === "offline")
      ? existing.status
      : input.status ?? (nextTaskId ? "working" : "idle");

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

  const progressComment = input.progressComment?.trim();
  if (progressComment) {
    if (!nextTaskId) {
      throw new OrchestrationApiError(
        400,
        "progress_comment_requires_task",
        "progressComment requires a current task"
      );
    }

    createTaskComment({
      taskId: nextTaskId,
      body: progressComment,
      type: "comment",
      authorAgentId: existing.id,
      source: source === "openclaw" ? "openclaw" : "mission_control",
      externalRef:
        source === "openclaw"
          ? `heartbeat:${existing.id}:${observedAt}:${progressComment}`
          : undefined,
      createdAt: observedAt,
    });
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

export type FireCompanyAgentCascade = {
  tasksReassigned: number;
  titlesRewritten: number;
  descriptionsRewritten: number;
  reportsToUpdated: number;
  sessionsCleared: number;
  failedRunsReset: number;
};

export type FireCompanyAgentResult = {
  archivedAgent: OrchestrationAgent;
  replacement: OrchestrationAgent | null;
  cascade: FireCompanyAgentCascade;
  archivedAt: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteNameInText(text: string, fromName: string, toName: string): string {
  if (!text || !fromName) return text;
  const trimmed = fromName.trim();
  if (!trimmed) return text;
  // JS `\b` is ASCII-only, so "José" would match inside "Joséphine" (the
  // é→p transition sits on an ASCII word boundary). Lookaround against
  // \p{L}/\p{N}/_ treats any Unicode letter or digit as a word char, which
  // prevents substring corruption for accented, non-Latin, or ideographic names.
  const pattern = new RegExp(
    `(?<=^|[^\\p{L}\\p{N}_])${escapeRegExp(trimmed)}(?=$|[^\\p{L}\\p{N}_])`,
    "gu"
  );
  return text.replace(pattern, () => toName);
}

function applyDepartureCascadeTx(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    departedName: string;
    departedAgentId: string | null;
    companyId: string;
    replacementId: string | null;
    replacementLabel: string;
    archivedAt: string;
  }
): FireCompanyAgentCascade {
  const cascade: FireCompanyAgentCascade = {
    tasksReassigned: 0,
    titlesRewritten: 0,
    descriptionsRewritten: 0,
    reportsToUpdated: 0,
    sessionsCleared: 0,
    failedRunsReset: 0,
  };

  // 1. Reassign open tasks where the departed agent was assignee. Only meaningful
  //    if the agent row still existed and had assignments pointing at its id.
  if (input.departedAgentId) {
    const reassignResult = db
      .prepare(
        `UPDATE tasks
         SET assignee_agent_id = ?, updated_at = ?
         WHERE assignee_agent_id = ? AND archived_at IS NULL`
      )
      .run(input.replacementId, input.archivedAt, input.departedAgentId);
    cascade.tasksReassigned = reassignResult.changes;
  }

  // 2. Word-boundary rewrite of the departed name in task titles/descriptions
  //    across the company. Comments are intentionally left alone as historical record.
  const likePattern = `%${input.departedName}%`;
  const taskRows = db
    .prepare(
      `SELECT t.id, t.title, t.description
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE p.company_id = ?
         AND t.archived_at IS NULL
         AND (t.title LIKE ? OR t.description LIKE ?)`
    )
    .all(input.companyId, likePattern, likePattern) as Array<{
      id: string;
      title: string;
      description: string | null;
    }>;

  const updateTaskStmt = db.prepare(
    `UPDATE tasks SET title = ?, description = ?, updated_at = ? WHERE id = ?`
  );

  for (const t of taskRows) {
    const newTitle = rewriteNameInText(t.title, input.departedName, input.replacementLabel);
    const newDescription = rewriteNameInText(
      t.description ?? "",
      input.departedName,
      input.replacementLabel
    );
    const titleChanged = newTitle !== t.title;
    const descChanged = newDescription !== (t.description ?? "");
    if (!titleChanged && !descChanged) continue;
    updateTaskStmt.run(
      newTitle,
      descChanged ? newDescription : t.description,
      input.archivedAt,
      t.id
    );
    if (titleChanged) cascade.titlesRewritten += 1;
    if (descChanged) cascade.descriptionsRewritten += 1;
  }

  // 3. Reporting-to cascade.
  if (input.departedAgentId) {
    const reportsResult = db
      .prepare(
        `UPDATE agents
         SET reporting_to = ?, updated_at = ?
         WHERE reporting_to = ? AND archived_at IS NULL`
      )
      .run(input.replacementId, input.archivedAt, input.departedAgentId);
    cascade.reportsToUpdated = reportsResult.changes;
  }

  // 4. Clear in-flight task sessions for all agents in the company.
  const sessionsResult = db
    .prepare(
      `DELETE FROM agent_task_sessions
       WHERE company_id = ?`
    )
    .run(input.companyId);
  cascade.sessionsCleared = sessionsResult.changes;

  // 4b. Force fresh OpenClaw sessions by nulling the per-agent runtime session_id.
  //     Without this, agents resume the session they were in pre-fire, which may
  //     have ended mid-turn (the MC loop stops consuming on fire) and produce
  //     empty assistant output on the next wake. A null session_id makes the
  //     adapter create a new session from scratch.
  db.prepare(
    `UPDATE agent_runtime_state
     SET session_id = NULL, updated_at = ?
     WHERE company_id = ?`
  ).run(input.archivedAt, input.companyId);

  // 5. Reset agents stuck in insufficient_progress_passive_report_only.
  const runsResult = db
    .prepare(
      `UPDATE heartbeat_runs
       SET status = 'cancelled', error = 'reset_after_agent_fire', updated_at = ?
       WHERE company_id = ? AND status = 'failed'
         AND error = 'insufficient_progress_passive_report_only'`
    )
    .run(input.archivedAt, input.companyId);
  cascade.failedRunsReset = runsResult.changes;

  return cascade;
}

function resolveReplacement(
  db: ReturnType<typeof getOrchestrationDb>,
  input: { replacementAgentId?: string; companyId: string; departedAgentId: string | null }
): { id: string; name: string; company_id: string; role: string } | null {
  if (!input.replacementAgentId) return null;
  if (input.departedAgentId && input.replacementAgentId === input.departedAgentId) {
    throw new OrchestrationApiError(
      400,
      "replacement_invalid",
      "replacementAgentId must differ from the agent being fired"
    );
  }
  const repRow = db
    .prepare(
      `SELECT id, name, company_id, role
       FROM agents
       WHERE id = ? AND archived_at IS NULL LIMIT 1`
    )
    .get(input.replacementAgentId) as
    | { id: string; name: string; company_id: string; role: string }
    | undefined;
  if (!repRow) {
    throw new OrchestrationApiError(
      400,
      "replacement_not_found",
      "Replacement agent not found or archived"
    );
  }
  if (repRow.company_id !== input.companyId) {
    throw new OrchestrationApiError(
      400,
      "replacement_company_mismatch",
      "Replacement agent must be in the same company"
    );
  }
  return repRow;
}

export function fireCompanyAgent(input: {
  agentId: string;
  replacementAgentId?: string;
  replacementFallback?: string;
}): FireCompanyAgentResult {
  const db = getOrchestrationDb();

  const agent = db
    .prepare(
      `SELECT id, name, role, company_id, archived_at
       FROM agents
       WHERE id = ? LIMIT 1`
    )
    .get(input.agentId) as
    | { id: string; name: string; role: string; company_id: string; archived_at: string | null }
    | undefined;

  if (!agent) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }
  if (agent.archived_at) {
    throw new OrchestrationApiError(409, "agent_already_archived", "Agent is already archived");
  }

  const replacement = resolveReplacement(db, {
    replacementAgentId: input.replacementAgentId,
    companyId: agent.company_id,
    departedAgentId: agent.id,
  });

  const replacementLabel =
    replacement?.name ?? input.replacementFallback?.trim() ?? "the team";
  const archivedAt = new Date().toISOString();

  let cascade!: FireCompanyAgentCascade;

  const tx = db.transaction(() => {
    cascade = applyDepartureCascadeTx(db, {
      departedName: agent.name,
      departedAgentId: agent.id,
      companyId: agent.company_id,
      replacementId: replacement?.id ?? null,
      replacementLabel,
      archivedAt,
    });

    db.prepare(
      `UPDATE agents
       SET archived_at = ?, updated_at = ?, status = 'offline'
       WHERE id = ?`
    ).run(archivedAt, archivedAt, agent.id);
    disableAgentRuntimesForArchivedAgent({
      agentId: agent.id,
      archivedAt,
      reason: "agent_archived",
    });
  });

  tx();

  const archivedRow = loadAgentRowIncludingArchived(db, agent.id);
  if (!archivedRow) {
    throw new OrchestrationApiError(
      500,
      "agent_fire_failed",
      "Agent archived but reload failed"
    );
  }

  const replacementRow = replacement ? agentById(db, replacement.id) : null;

  return {
    archivedAgent: agentFromRow(archivedRow),
    replacement: replacementRow ? agentFromRow(replacementRow) : null,
    cascade,
    archivedAt,
  };
}

export const archiveCompanyAgent = fireCompanyAgent;

export type RestoreCompanyAgentResult = {
  agent: OrchestrationAgent;
  restoredAt: string;
};

export function restoreCompanyAgent(input: { agentId: string }): RestoreCompanyAgentResult {
  const db = getOrchestrationDb();
  const row = loadAgentRowIncludingArchived(db, input.agentId);
  if (!row) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }

  const current = db
    .prepare(`SELECT archived_at FROM agents WHERE id = ? LIMIT 1`)
    .get(input.agentId) as { archived_at: string | null } | undefined;
  if (!current?.archived_at) {
    throw new OrchestrationApiError(409, "agent_not_archived", "Agent is not archived");
  }

  const restoredAt = new Date().toISOString();
  db.prepare(
    `UPDATE agents
     SET archived_at = NULL, status = 'idle', updated_at = ?
     WHERE id = ?`
  ).run(restoredAt, input.agentId);

  const restoredRow = agentById(db, input.agentId);
  if (!restoredRow) {
    throw new OrchestrationApiError(500, "agent_restore_failed", "Agent restored but reload failed");
  }

  return {
    agent: agentFromRow(restoredRow),
    restoredAt,
  };
}

type AgentWorkspaceDeleteResult = {
  path: string;
  existed: boolean;
  deleted: boolean;
};

export type HardDeleteCompanyAgentResult = {
  agentId: string;
  agentName: string;
  companyId: string;
  workspace: {
    companyRoot: string | null;
    agentPath: AgentWorkspaceDeleteResult | null;
  };
  openclawAgents: {
    queued: string[];
  };
  cascade: FireCompanyAgentCascade;
  detachedCounts: {
    assignedTasks: number;
    authoredComments: number;
    taskEvents: number;
    requestedApprovals: number;
    approvalComments: number;
    executionRuns: number;
    agentRuntimes: number;
    auditEvents: number;
    costEvents: number;
    routines: number;
  };
  deletedCounts: {
    wakeupRequests: number;
    taskSessions: number;
    runtimeState: number;
    heartbeatRuns: number;
    heartbeatRunEvents: number;
    agentRows: number;
  };
};

function slugifyAgentWorkspacePart(value: string): string {
  return value
    .replace(/'/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function deleteAgentWorkspacePath(
  companyWorkspaceRoot: string | null,
  agentSlug: string | null,
): AgentWorkspaceDeleteResult | null {
  if (!companyWorkspaceRoot || !agentSlug) return null;

  const root = path.resolve(companyWorkspaceRoot);
  const agentPath = resolveCompanyAgentWorkspacePath(root, agentSlug);
  if (!agentPath) return null;
  const resolvedAgentPath = path.resolve(agentPath);
  if (!isPathContained(root, resolvedAgentPath)) {
    throw new OrchestrationApiError(
      400,
      "unsafe_agent_workspace_path",
      `Refusing to delete agent workspace outside company workspace: ${resolvedAgentPath}`
    );
  }

  const existed = fs.existsSync(resolvedAgentPath);
  if (!existed) {
    return { path: resolvedAgentPath, existed: false, deleted: true };
  }

  fs.rmSync(resolvedAgentPath, { recursive: true, force: true });
  const deleted = !fs.existsSync(resolvedAgentPath);
  if (!deleted) {
    throw new OrchestrationApiError(
      500,
      "agent_workspace_delete_failed",
      `Failed to delete agent workspace: ${resolvedAgentPath}`
    );
  }

  return { path: resolvedAgentPath, existed: true, deleted: true };
}

function countByAgent(db: ReturnType<typeof getOrchestrationDb>, sql: string, agentId: string): number {
  return Number((db.prepare(sql).get(agentId) as { count?: number } | undefined)?.count ?? 0);
}

export function hardDeleteCompanyAgent(input: {
  agentId: string;
  replacementAgentId?: string;
  replacementFallback?: string;
}): HardDeleteCompanyAgentResult {
  const db = getOrchestrationDb();

  const agent = db
    .prepare(
      `SELECT id, name, role, company_id, slug, runtime_slug, openclaw_agent_id, archived_at
       FROM agents
       WHERE id = ? LIMIT 1`
    )
    .get(input.agentId) as
    | {
        id: string;
        name: string;
        role: string;
        company_id: string;
        slug: string | null;
        runtime_slug: string | null;
        openclaw_agent_id: string | null;
        archived_at: string | null;
      }
    | undefined;

  if (!agent) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }

  const companyRow = db
    .prepare(`SELECT workspace_root FROM companies WHERE id = ? LIMIT 1`)
    .get(agent.company_id) as { workspace_root: string | null } | undefined;
  const companyWorkspaceRoot = companyRow?.workspace_root?.trim()
    ? path.resolve(companyRow.workspace_root)
    : null;
  const agentWorkspaceSlug =
    agent.runtime_slug?.trim() ||
    agent.slug?.trim() ||
    slugifyAgentWorkspacePart(agent.name) ||
    null;

  const replacement = resolveReplacement(db, {
    replacementAgentId: input.replacementAgentId,
    companyId: agent.company_id,
    departedAgentId: agent.id,
  });
  const replacementLabel =
    replacement?.name ?? input.replacementFallback?.trim() ?? "the team";
  const appliedAt = new Date().toISOString();

  const detachedCounts = {
    assignedTasks: countByAgent(db, `SELECT COUNT(*) AS count FROM tasks WHERE assignee_agent_id = ?`, agent.id),
    authoredComments: countByAgent(db, `SELECT COUNT(*) AS count FROM comments WHERE author_agent_id = ?`, agent.id),
    taskEvents: countByAgent(db, `SELECT COUNT(*) AS count FROM task_events WHERE agent_id = ?`, agent.id),
    requestedApprovals: countByAgent(db, `SELECT COUNT(*) AS count FROM approvals WHERE requested_by_agent_id = ?`, agent.id),
    approvalComments: countByAgent(db, `SELECT COUNT(*) AS count FROM approval_comments WHERE author_agent_id = ?`, agent.id),
    executionRuns: countByAgent(db, `SELECT COUNT(*) AS count FROM execution_runs WHERE agent_id = ?`, agent.id),
    agentRuntimes: countByAgent(db, `SELECT COUNT(*) AS count FROM agent_runtimes WHERE agent_id = ?`, agent.id),
    auditEvents: countByAgent(db, `SELECT COUNT(*) AS count FROM company_audit_events WHERE agent_id = ?`, agent.id),
    costEvents: countByAgent(db, `SELECT COUNT(*) AS count FROM cost_events WHERE agent_id = ?`, agent.id),
    routines: countByAgent(db, `SELECT COUNT(*) AS count FROM routines WHERE assignee_agent_id = ?`, agent.id),
  };

  const deletedCounts = {
    wakeupRequests: countByAgent(db, `SELECT COUNT(*) AS count FROM agent_wakeup_requests WHERE agent_id = ?`, agent.id),
    taskSessions: countByAgent(db, `SELECT COUNT(*) AS count FROM agent_task_sessions WHERE agent_id = ?`, agent.id),
    runtimeState: countByAgent(db, `SELECT COUNT(*) AS count FROM agent_runtime_state WHERE agent_id = ?`, agent.id),
    heartbeatRuns: countByAgent(db, `SELECT COUNT(*) AS count FROM heartbeat_runs WHERE agent_id = ?`, agent.id),
    heartbeatRunEvents: countByAgent(db, `SELECT COUNT(*) AS count FROM heartbeat_run_events WHERE agent_id = ?`, agent.id),
    agentRows: 1,
  };

  const workspaceResult = deleteAgentWorkspacePath(companyWorkspaceRoot, agentWorkspaceSlug);

  let cascade!: FireCompanyAgentCascade;
  const tx = db.transaction(() => {
    cascade = applyDepartureCascadeTx(db, {
      departedName: agent.name,
      departedAgentId: agent.id,
      companyId: agent.company_id,
      replacementId: replacement?.id ?? null,
      replacementLabel,
      archivedAt: appliedAt,
    });

    db.prepare(`DELETE FROM agent_runtimes WHERE agent_id = ?`).run(agent.id);
    db.prepare(`DELETE FROM agents WHERE id = ?`).run(agent.id);
  });

  tx();

  return {
    agentId: agent.id,
    agentName: agent.name,
    companyId: agent.company_id,
    workspace: {
      companyRoot: companyWorkspaceRoot,
      agentPath: workspaceResult,
    },
    openclawAgents: {
      queued: agent.openclaw_agent_id?.trim() ? [agent.openclaw_agent_id.trim()] : [],
    },
    cascade,
    detachedCounts,
    deletedCounts,
  };
}

export type CleanupDepartedAgentResult = {
  companyId: string;
  departedName: string;
  replacement: OrchestrationAgent | null;
  cascade: FireCompanyAgentCascade;
  appliedAt: string;
};

export function cleanupDepartedAgentReferences(input: {
  companyId: string;
  departedName: string;
  replacementAgentId?: string;
  replacementFallback?: string;
}): CleanupDepartedAgentResult {
  const db = getOrchestrationDb();

  const trimmedName = input.departedName.trim();
  if (!trimmedName) {
    throw new OrchestrationApiError(
      400,
      "departed_name_required",
      "departedName must be a non-empty string"
    );
  }

  const company = resolveCompanyId(db, input.companyId);
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const activeConflict = db
    .prepare(
      `SELECT id FROM agents
       WHERE company_id = ? AND archived_at IS NULL AND LOWER(name) = LOWER(?) LIMIT 1`
    )
    .get(company, trimmedName) as { id: string } | undefined;
  if (activeConflict) {
    throw new OrchestrationApiError(
      409,
      "departed_agent_still_active",
      "An active agent with that name still exists in the company; fire that agent directly via DELETE /api/orchestration/agents/:id"
    );
  }

  const replacement = resolveReplacement(db, {
    replacementAgentId: input.replacementAgentId,
    companyId: company,
    departedAgentId: null,
  });

  const replacementLabel =
    replacement?.name ?? input.replacementFallback?.trim() ?? "the team";
  const appliedAt = new Date().toISOString();

  let cascade!: FireCompanyAgentCascade;

  const tx = db.transaction(() => {
    cascade = applyDepartureCascadeTx(db, {
      departedName: trimmedName,
      departedAgentId: null,
      companyId: company,
      replacementId: replacement?.id ?? null,
      replacementLabel,
      archivedAt: appliedAt,
    });
  });

  tx();

  const replacementRow = replacement ? agentById(db, replacement.id) : null;

  return {
    companyId: company,
    departedName: trimmedName,
    replacement: replacementRow ? agentFromRow(replacementRow) : null,
    cascade,
    appliedAt,
  };
}

function loadAgentRowIncludingArchived(
  db: ReturnType<typeof getOrchestrationDb>,
  agentId: string
): AgentRow | undefined {
  return db
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
        a.runtime_slug,
        a.openclaw_agent_id,
        a.reporting_to,
        mgr.name AS reporting_to_name,
        hap.id AS hire_approval_id,
        hap.status AS hire_approval_status,
        a.skills_json,
        a.tasks_completed,
        a.total_runtime_minutes,
        a.last_heartbeat,
        a.created_at,
        a.updated_at
       FROM agents a
       LEFT JOIN tasks t ON t.id = a.current_task_id
       LEFT JOIN agents mgr ON mgr.id = a.reporting_to
       LEFT JOIN approvals hap
         ON hap.company_id = a.company_id
        AND hap.type = 'hire_agent'
        AND hap.status IN ('pending', 'revision_requested')
        AND json_extract(hap.payload_json, '$.agentId') = a.id
       WHERE a.id = ?`
    )
    .get(agentId) as AgentRow | undefined;
}
