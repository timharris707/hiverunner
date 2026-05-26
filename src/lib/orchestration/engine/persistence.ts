/**
 * Engine-scoped DB helpers extracted from engine.ts.
 *
 * Owns the small, focused DB primitives the engine uses to read/write
 * agent_task_sessions, agent_runtime_state, execution_runs metadata, and
 * task lookup/no-op bookkeeping. Each function keeps the signature it had
 * when it lived in engine.ts, so callers (including tests) are unaffected.
 *
 * Scope intentionally narrow: no migrations, no schema changes, no broader
 * db.ts cleanup. This module is a stable import target for downstream
 * extractions of action-dispatcher, prompt-builder, etc.
 */

import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";

/* ── Public types ── */

export interface TaskSession {
  id: string;
  agentId: string;
  companyId: string;
  adapterType: string;
  taskKey: string;
  sessionParams: Record<string, unknown>;
  sessionDisplayId: string | null;
  lastRunId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeState {
  agentId: string;
  companyId: string;
  adapterType: string;
  sessionId: string | null;
  state: Record<string, unknown>;
  lastRunId: string | null;
  lastRunStatus: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  lastError: string | null;
}

/* ── JSON / record helpers ── */

export function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function mergeExecutionRunMetadata(
  db: Database.Database,
  executionRunId: string,
  patch: Record<string, unknown>,
): void {
  const row = db
    .prepare("SELECT metadata_json FROM execution_runs WHERE id = ? LIMIT 1")
    .get(executionRunId) as { metadata_json: string | null } | undefined;
  const metadata = parseJson(row?.metadata_json);
  db.prepare(
    `UPDATE execution_runs SET metadata_json = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify({ ...metadata, ...patch }), new Date().toISOString(), executionRunId);
}

export function stringFromRecord(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/* ── Row mappers (private) ── */

type TaskSessionRow = {
  id: string;
  agent_id: string;
  company_id: string;
  adapter_type: string;
  task_key: string;
  session_params_json: string;
  session_display_id: string | null;
  last_run_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type RuntimeStateRow = {
  agent_id: string;
  company_id: string;
  adapter_type: string;
  session_id: string | null;
  state_json: string;
  last_run_id: string | null;
  last_run_status: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_cents: number;
  last_error: string | null;
};

function mapTaskSessionRow(row: TaskSessionRow): TaskSession {
  return {
    id: row.id,
    agentId: row.agent_id,
    companyId: row.company_id,
    adapterType: row.adapter_type,
    taskKey: row.task_key,
    sessionParams: parseJson(row.session_params_json),
    sessionDisplayId: row.session_display_id,
    lastRunId: row.last_run_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRuntimeStateRow(row: RuntimeStateRow): RuntimeState {
  return {
    agentId: row.agent_id,
    companyId: row.company_id,
    adapterType: row.adapter_type,
    sessionId: row.session_id,
    state: parseJson(row.state_json),
    lastRunId: row.last_run_id,
    lastRunStatus: row.last_run_status,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCostCents: row.total_cost_cents,
    lastError: row.last_error,
  };
}

/* ── Session management ── */

export function getOrCreateTaskSession(
  input: {
    agentId: string;
    companyId: string;
    adapterType?: string;
    taskKey: string;
  },
  db = getOrchestrationDb()
): TaskSession {
  const adapter = input.adapterType ?? "manual";
  const existing = db
    .prepare(
      `SELECT id, agent_id, company_id, adapter_type, task_key,
              session_params_json, session_display_id, last_run_id, last_error,
              created_at, updated_at
       FROM agent_task_sessions
       WHERE company_id = ? AND agent_id = ? AND adapter_type = ? AND task_key = ?
       LIMIT 1`
    )
    .get(input.companyId, input.agentId, adapter, input.taskKey) as TaskSessionRow | undefined;

  if (existing) return mapTaskSessionRow(existing);

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_task_sessions
       (id, agent_id, company_id, adapter_type, task_key, session_params_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`
  ).run(id, input.agentId, input.companyId, adapter, input.taskKey, now, now);

  return {
    id,
    agentId: input.agentId,
    companyId: input.companyId,
    adapterType: adapter,
    taskKey: input.taskKey,
    sessionParams: {},
    sessionDisplayId: null,
    lastRunId: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTaskSession(
  sessionId: string,
  patch: {
    sessionParams?: Record<string, unknown>;
    sessionDisplayId?: string;
    lastRunId?: string;
    lastError?: string | null;
  },
  db = getOrchestrationDb()
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_task_sessions
     SET session_params_json = COALESCE(?, session_params_json),
         session_display_id = COALESCE(?, session_display_id),
         last_run_id = COALESCE(?, last_run_id),
         last_error = COALESCE(?, last_error),
         updated_at = ?
     WHERE id = ?`
  ).run(
    patch.sessionParams ? JSON.stringify(patch.sessionParams) : null,
    patch.sessionDisplayId ?? null,
    patch.lastRunId ?? null,
    patch.lastError === undefined ? null : patch.lastError,
    now,
    sessionId
  );
}

/* ── Runtime state ── */

// Fallback initializer — NOT the primary seed path. createProjectAgent
// inserts the agent_runtime_state row inside its creation transaction, so
// under normal flow this function returns the existing row on the first
// engine tick. The INSERT branch below exists only for legacy agents that
// pre-date the eager seed (fix 49c122e3) and for any code paths that still
// bypass createProjectAgent. Do not rely on the INSERT never running; do
// rely on this function being idempotent.
export function getOrCreateRuntimeState(
  agentId: string,
  companyId: string,
  db = getOrchestrationDb(),
  adapterType = "manual",
): RuntimeState {
  const existing = db
    .prepare(
      `SELECT agent_id, company_id, adapter_type, session_id, state_json,
              last_run_id, last_run_status,
              total_input_tokens, total_output_tokens, total_cost_cents,
              last_error
       FROM agent_runtime_state
       WHERE agent_id = ?
       LIMIT 1`
    )
    .get(agentId) as RuntimeStateRow | undefined;

  if (existing) return mapRuntimeStateRow(existing);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_runtime_state
       (agent_id, company_id, adapter_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(agentId, companyId, adapterType, now, now);

  return {
    agentId,
    companyId,
    adapterType,
    sessionId: null,
    state: {},
    lastRunId: null,
    lastRunStatus: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostCents: 0,
    lastError: null,
  };
}

// Null the agent's runtime session_id so the next wake opens a fresh
// session. Adapter-agnostic: the signal "start clean" is generic; each
// adapter interprets it in its own way. Failures here are logged but
// never re-thrown — a bookkeeping hiccup shouldn't destabilize the
// caller's error path.
export function resetAgentRuntimeSessionForSelfHeal(
  db: Database.Database,
  agentId: string,
  reason: string,
): void {
  try {
    db.prepare(
      `UPDATE agent_runtime_state
       SET session_id = NULL, updated_at = ?
       WHERE agent_id = ?`,
    ).run(new Date().toISOString(), agentId);
  } catch (err) {
    console.warn(
      `[engine:runtime] failed to null session_id for ${agentId} (${reason}):`,
      err,
    );
  }
}

export function updateRuntimeState(
  agentId: string,
  patch: {
    sessionId?: string | null;
    lastRunId?: string;
    lastRunStatus?: string;
    inputTokensDelta?: number;
    outputTokensDelta?: number;
    costCentsDelta?: number;
    lastError?: string | null;
  },
  db = getOrchestrationDb()
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_runtime_state
     SET session_id = COALESCE(?, session_id),
         last_run_id = COALESCE(?, last_run_id),
         last_run_status = COALESCE(?, last_run_status),
         total_input_tokens = total_input_tokens + COALESCE(?, 0),
         total_output_tokens = total_output_tokens + COALESCE(?, 0),
         total_cost_cents = total_cost_cents + COALESCE(?, 0),
         last_error = CASE WHEN ? IS NOT NULL THEN ? ELSE last_error END,
         updated_at = ?
     WHERE agent_id = ?`
  ).run(
    patch.sessionId === undefined ? null : patch.sessionId,
    patch.lastRunId ?? null,
    patch.lastRunStatus ?? null,
    patch.inputTokensDelta ?? null,
    patch.outputTokensDelta ?? null,
    patch.costCentsDelta ?? null,
    patch.lastError === undefined ? null : "set",
    patch.lastError === undefined ? null : patch.lastError,
    now,
    agentId
  );
}

/* ── Task lookups / no-op bookkeeping ── */

export function getTaskRefForActionKey(
  db: Database.Database,
  actionTaskKey: string,
): { id: string; taskKey: string | null } | null {
  const trimmed = actionTaskKey.trim();
  if (!trimmed) return null;
  const row = db
    .prepare(
      `SELECT id, task_key
       FROM tasks
       WHERE (id = ? OR task_key = ?)
         AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(trimmed, trimmed) as { id: string; task_key: string | null } | undefined;
  return row ? { id: row.id, taskKey: row.task_key ?? null } : null;
}

export function resetNoopCounterForActionTask(
  db: Database.Database,
  taskKey: string,
): void {
  const task = getTaskRefForActionKey(db, taskKey);
  if (!task) return;
  db.prepare("UPDATE tasks SET consecutive_noop_wakes = 0, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), task.id);
}
