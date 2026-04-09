import { execFile } from "child_process";
import { promisify } from "util";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { triggerTaskAssignmentHeartbeat, triggerTaskAssigneeNudge } from "@/lib/orchestration/bridge/sync";
import { getTaskBridgeRecord, listTaskExternalCommentRefs, setTaskExecutionMode } from "@/lib/orchestration/bridge/store";
import { getOrchestrationExecutionProvider } from "@/lib/orchestration/execution-provider";
import { enqueueWakeup } from "@/lib/orchestration/engine/engine";
import { createTaskComment, getTask, moveTask } from "@/lib/orchestration/service";
import type { TaskStatusInput } from "@/lib/orchestration/contracts";

const execFileAsync = promisify(execFile);
const SYSTEM_PROMPT_MAX_CHARS = 10_000;
const DESCRIPTION_MAX_CHARS = 12_000;
const ACCEPTANCE_MAX_CHARS = 8_000;
const OPENCLAW_COMMENT_SOURCE = "openclaw" as const;
const OPENCLAW_SYSTEM_ACTOR = "openclaw:execution";
const OPENCLAW_IMPORTED_COMMENT_MAX_CHARS = 9_000;

type TaskExecutionContextRow = {
  task_id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  type: "feature" | "bug" | "research" | "infrastructure" | "directive";
  labels_json: string;
  project_name: string;
  project_description: string;
  project_slug: string;
  sprint_name: string | null;
  sprint_goal: string | null;
  agent_name: string;
  agent_role: string;
  agent_personality: string;
  openclaw_agent_id: string | null;
};

type OpenClawSessionCreateResult = {
  ok?: boolean;
  key: string;
  sessionId: string;
};

type OpenClawSessionSendResult = {
  runId?: string;
  status?: string;
};

type OpenClawHistoryEvent = {
  id: string;
  body: string;
  createdAt: string;
  role?: string;
  status?: string;
};

type TaskPromptSections = {
  summary: string;
  acceptanceCriteria: string[];
};

export type TriggerTaskExecutionResult = {
  taskId: string;
  mode: "openclaw" | "paperclip";
  queued: boolean;
  status: "queued" | "running" | "skipped";
  runId?: string;
  sessionId?: string;
  reason?: string;
};

export type TriggerTaskNudgeResult = TriggerTaskExecutionResult;

export type PollTaskExecutionResult = {
  taskId: string;
  mode: "openclaw" | "paperclip" | "manual";
  runId?: string;
  agentId?: string;
  sessionId?: string;
  polledAt: string;
  status: {
    state: "running" | "completed" | "unknown" | "skipped";
    terminal: boolean;
    reason?: string;
    raw?: string;
  };
  comments: {
    imported: number;
    skippedDuplicates: number;
    lastImportedEventId?: string;
  };
  transition: {
    attempted: boolean;
    from?: TaskStatusInput;
    to?: TaskStatusInput;
    changed: boolean;
    skipped: boolean;
    skipReason?: string;
  };
  task: ReturnType<typeof getTask>["task"];
};

export type CancelTaskExecutionResult = {
  taskId: string;
  mode: "openclaw" | "paperclip" | "manual";
  sessionId?: string;
  cancelled: {
    attempted: boolean;
    acknowledged: boolean;
    status: "cancelled" | "skipped";
    reason?: string;
    raw?: string;
  };
  transition: {
    attempted: boolean;
    from?: TaskStatusInput;
    to?: TaskStatusInput;
    changed: boolean;
    skipped: boolean;
    skipReason?: string;
  };
  task: ReturnType<typeof getTask>["task"];
};

type ExecutionProvider = "openclaw" | "paperclip" | "codex";
type ExecutionRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type ExecutionRunRow = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  provider: ExecutionProvider;
  session_id: string | null;
  status: ExecutionRunStatus;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  token_usage_json: string;
  duration_ms: number | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

type ExecutionRunRecord = {
  id: string;
  taskId?: string | null;
  agentId?: string;
  provider: ExecutionProvider;
  sessionId?: string;
  status: ExecutionRunStatus;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  tokenUsage: Record<string, unknown>;
  durationMs?: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
};

function isExecutionRunIdempotencyConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const sqliteCode = (error as { code?: string }).code;
  if (sqliteCode !== "SQLITE_CONSTRAINT" && sqliteCode !== "SQLITE_CONSTRAINT_UNIQUE") {
    return false;
  }
  return /execution_runs\.idempotency_key|idx_execution_runs_idempotency_key/i.test(error.message);
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapExecutionRunRow(row: ExecutionRunRow): ExecutionRunRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id ?? undefined,
    provider: row.provider,
    sessionId: row.session_id ?? undefined,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    tokenUsage: parseJsonRecord(row.token_usage_json),
    durationMs: typeof row.duration_ms === "number" ? row.duration_ms : undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createExecutionRun(
  input: {
    taskId?: string | null;
    agentId?: string;
    provider: ExecutionProvider;
    status?: ExecutionRunStatus;
    sessionId?: string;
    startedAt?: string;
    completedAt?: string;
    errorMessage?: string;
    tokenUsage?: Record<string, unknown>;
    durationMs?: number;
    idempotencyKey?: string;
  },
  db = getOrchestrationDb()
): ExecutionRunRecord {
  const now = new Date().toISOString();
  const id = randomUUID();
  const status = input.status ?? "pending";
  db.prepare(
    `INSERT INTO execution_runs
      (id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message, token_usage_json, duration_ms, idempotency_key, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.taskId ?? null,
    input.agentId ?? null,
    input.provider,
    input.sessionId ?? null,
    status,
    input.startedAt ?? null,
    input.completedAt ?? null,
    input.errorMessage ?? null,
    JSON.stringify(input.tokenUsage ?? {}),
    typeof input.durationMs === "number" ? Math.trunc(input.durationMs) : null,
    input.idempotencyKey ?? null,
    now,
    now
  );

  return getExecutionRunById(id, db);
}

function createExecutionRunWithIdempotencyRecovery(
  input: Parameters<typeof createExecutionRun>[0],
  db = getOrchestrationDb()
): { run: ExecutionRunRecord; reused: boolean } {
  try {
    return { run: createExecutionRun(input, db), reused: false };
  } catch (error) {
    if (!input.idempotencyKey || !isExecutionRunIdempotencyConstraintError(error)) {
      throw error;
    }

    const existingRun = getExecutionRunByIdempotencyKey(input.idempotencyKey, db);
    if (!existingRun) {
      throw error;
    }
    if (existingRun.taskId !== input.taskId) {
      throw new OrchestrationApiError(
        409,
        "idempotency_key_conflict",
        "idempotencyKey is already in use for a different task"
      );
    }
    return { run: existingRun, reused: true };
  }
}

function getExecutionRunById(runId: string, db = getOrchestrationDb()): ExecutionRunRecord {
  const row = db
    .prepare(
      `SELECT
         id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message,
         token_usage_json, duration_ms, idempotency_key, created_at, updated_at
       FROM execution_runs
       WHERE id = ?
       LIMIT 1`
    )
    .get(runId) as ExecutionRunRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "execution_run_not_found", "Execution run not found");
  }

  return mapExecutionRunRow(row);
}

function getExecutionRunByIdempotencyKey(
  idempotencyKey: string,
  db = getOrchestrationDb()
): ExecutionRunRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message,
         token_usage_json, duration_ms, idempotency_key, created_at, updated_at
       FROM execution_runs
       WHERE idempotency_key = ?
       LIMIT 1`
    )
    .get(idempotencyKey) as ExecutionRunRow | undefined;
  return row ? mapExecutionRunRow(row) : undefined;
}

function getLatestExecutionRunForTask(
  taskId: string,
  options?: {
    provider?: ExecutionProvider;
    statuses?: ExecutionRunStatus[];
  },
  db = getOrchestrationDb()
): ExecutionRunRecord | undefined {
  const clauses = ["task_id = ?"];
  const params: unknown[] = [taskId];

  if (options?.provider) {
    clauses.push("provider = ?");
    params.push(options.provider);
  }

  if (options?.statuses?.length) {
    clauses.push(`status IN (${options.statuses.map(() => "?").join(", ")})`);
    params.push(...options.statuses);
  }

  const row = db
    .prepare(
      `SELECT
         id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message,
         token_usage_json, duration_ms, idempotency_key, created_at, updated_at
       FROM execution_runs
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(...params) as ExecutionRunRow | undefined;

  return row ? mapExecutionRunRow(row) : undefined;
}

function updateExecutionRun(
  runId: string,
  patch: {
    status?: ExecutionRunStatus;
    sessionId?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    errorMessage?: string | null;
    tokenUsage?: Record<string, unknown>;
    durationMs?: number | null;
  },
  db = getOrchestrationDb()
): ExecutionRunRecord {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE execution_runs
     SET status = COALESCE(?, status),
         session_id = COALESCE(?, session_id),
         started_at = COALESCE(?, started_at),
         completed_at = COALESCE(?, completed_at),
         error_message = COALESCE(?, error_message),
         token_usage_json = COALESCE(?, token_usage_json),
         duration_ms = COALESCE(?, duration_ms),
         updated_at = ?
     WHERE id = ?`
  ).run(
    patch.status ?? null,
    patch.sessionId === undefined ? null : patch.sessionId,
    patch.startedAt === undefined ? null : patch.startedAt,
    patch.completedAt === undefined ? null : patch.completedAt,
    patch.errorMessage === undefined ? null : patch.errorMessage,
    patch.tokenUsage === undefined ? null : JSON.stringify(patch.tokenUsage),
    patch.durationMs === undefined ? null : patch.durationMs,
    now,
    runId
  );

  return getExecutionRunById(runId, db);
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => String(entry)).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated by Mission Control]`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const joined = value.map((entry) => textFromUnknown(entry)).filter(Boolean).join("\n");
    return joined.trim() || undefined;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const candidate =
    textFromUnknown(record.text) ??
    textFromUnknown(record.message) ??
    textFromUnknown(record.body) ??
    textFromUnknown(record.content) ??
    textFromUnknown(record.output) ??
    textFromUnknown(record.delta);

  return candidate?.trim() || undefined;
}

function toIsoTimestamp(input: unknown, fallback: string): string {
  const raw = asString(input);
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

function normalizeStatusToken(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  return raw.toLowerCase().replace(/[\s-]+/g, "_");
}

function isTerminalStatus(status: string | undefined): boolean {
  if (!status) return false;
  return [
    "done",
    "completed",
    "finished",
    "success",
    "succeeded",
    "failed",
    "failure",
    "error",
    "cancelled",
    "canceled",
    "stopped",
    "terminated",
  ].includes(status);
}

function mapOpenClawTerminalStateToRunStatus(state: string | undefined): ExecutionRunStatus {
  if (!state) return "completed";
  if (["failed", "failure", "error"].includes(state)) {
    return "failed";
  }
  if (["cancelled", "canceled", "stopped", "terminated"].includes(state)) {
    return "cancelled";
  }
  return "completed";
}

function mapRunToTriggerStatus(run: ExecutionRunRecord): "queued" | "running" | "skipped" {
  if (run.status === "running") {
    return "running";
  }
  if (run.status === "pending") {
    return "queued";
  }
  return "skipped";
}

function mapRunToPollState(run: ExecutionRunRecord): "running" | "completed" | "unknown" | "skipped" {
  if (run.status === "running" || run.status === "pending") {
    return "running";
  }
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    return "completed";
  }
  return "unknown";
}

function eventBody(role: string | undefined, body: string): string {
  const prefix = role ? `OpenClaw (${role}) update:` : "OpenClaw update:";
  const clipped = clip(body.trim(), OPENCLAW_IMPORTED_COMMENT_MAX_CHARS);
  return `${prefix}\n\n${clipped}`;
}

function historyEventId(sessionId: string, index: number, body: string, createdAt: string): string {
  const digest = createHash("sha1")
    .update(`${sessionId}|${index}|${createdAt}|${body}`)
    .digest("hex")
    .slice(0, 16);
  return `openclaw:${sessionId}:${digest}`;
}

function pickHistoryArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const keys = ["history", "entries", "events", "messages", "output", "items"];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function parseOpenClawHistory(payload: unknown, sessionId: string): {
  events: OpenClawHistoryEvent[];
  state?: string;
  terminal: boolean;
} {
  const record = asRecord(payload);
  const now = new Date().toISOString();
  const rawState =
    normalizeStatusToken(record?.status) ??
    normalizeStatusToken(record?.state) ??
    normalizeStatusToken(record?.result);

  const explicitDone =
    asBoolean(record?.done) ??
    asBoolean(record?.completed) ??
    asBoolean(record?.isComplete) ??
    false;

  const events: OpenClawHistoryEvent[] = [];
  const entries = pickHistoryArray(payload);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const entryRecord = asRecord(entry);
    if (!entryRecord) {
      const text = textFromUnknown(entry);
      if (!text) continue;
      const createdAt = now;
      events.push({
        id: historyEventId(sessionId, index, text, createdAt),
        body: text,
        createdAt,
      });
      continue;
    }

    const body =
      textFromUnknown(entryRecord.body) ??
      textFromUnknown(entryRecord.text) ??
      textFromUnknown(entryRecord.message) ??
      textFromUnknown(entryRecord.content) ??
      textFromUnknown(entryRecord.output);

    if (!body) {
      continue;
    }

    const createdAt = toIsoTimestamp(
      entryRecord.createdAt ??
        entryRecord.created_at ??
        entryRecord.timestamp ??
        entryRecord.ts ??
        entryRecord.time,
      now
    );
    const role =
      asString(entryRecord.role) ??
      asString(entryRecord.author) ??
      asString(entryRecord.actor) ??
      asString(entryRecord.source);
    const status =
      normalizeStatusToken(entryRecord.status) ??
      normalizeStatusToken(entryRecord.state) ??
      normalizeStatusToken(entryRecord.type);
    const id =
      asString(entryRecord.id) ??
      asString(entryRecord.eventId) ??
      asString(entryRecord.messageId) ??
      asString(entryRecord.entryId) ??
      historyEventId(sessionId, index, body, createdAt);

    events.push({
      id,
      body,
      createdAt,
      role,
      status,
    });
  }

  const eventTerminal = events.some((entry) => isTerminalStatus(entry.status));
  return {
    events,
    state: rawState,
    terminal: explicitDone || isTerminalStatus(rawState) || eventTerminal,
  };
}

function extractAcceptanceCriteria(description: string): TaskPromptSections {
  const normalized = normalizeWhitespace(description);
  if (!normalized) {
    return { summary: "", acceptanceCriteria: [] };
  }

  const lines = normalized.split("\n");
  let inAcceptance = false;
  const acceptance: string[] = [];
  const summaryLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{1,6}\s*acceptance criteria\b/i.test(line)) {
      inAcceptance = true;
      continue;
    }
    if (inAcceptance && /^#{1,6}\s+\S+/.test(line)) {
      inAcceptance = false;
    }
    if (inAcceptance) {
      const stripped = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim();
      if (stripped) {
        acceptance.push(stripped);
      }
      continue;
    }
    summaryLines.push(rawLine);
  }

  return {
    summary: normalizeWhitespace(summaryLines.join("\n")),
    acceptanceCriteria: acceptance,
  };
}

function readAgentSoul(agentId: string): string | undefined {
  const base = process.env.OPENCLAW_DIR
    ? path.resolve(process.env.OPENCLAW_DIR)
    : path.join(os.homedir(), ".openclaw");
  const soulPath = path.join(base, "agents", agentId, "SOUL.md");
  if (!fs.existsSync(soulPath)) {
    return undefined;
  }
  try {
    return clip(normalizeWhitespace(fs.readFileSync(soulPath, "utf8")), SYSTEM_PROMPT_MAX_CHARS);
  } catch {
    return undefined;
  }
}

function buildTaskPrompt(row: TaskExecutionContextRow): string {
  const labels = parseJsonArray(row.labels_json);
  const parsed = extractAcceptanceCriteria(row.description ?? "");
  const summary = clip(parsed.summary, DESCRIPTION_MAX_CHARS);
  const acceptanceCriteria =
    parsed.acceptanceCriteria.length > 0
      ? parsed.acceptanceCriteria
      : ["No explicit acceptance criteria provided in task description."];

  const soul = row.openclaw_agent_id ? readAgentSoul(row.openclaw_agent_id) : undefined;

  const sections: string[] = [
    "Mission Control Task Assignment",
    "",
    `Task ID: ${row.task_id}`,
    `Task Title: ${row.title}`,
    `Priority: ${row.priority}`,
    `Type: ${row.type}`,
    `Project: ${row.project_name} (${row.project_slug})`,
    `Assigned Agent: ${row.agent_name} (${row.agent_role})`,
  ];

  if (labels.length > 0) {
    sections.push(`Labels: ${labels.join(", ")}`);
  }

  if (row.sprint_name) {
    sections.push(`Sprint: ${row.sprint_name}`);
  }
  if (row.sprint_goal) {
    sections.push(`Sprint Goal: ${row.sprint_goal}`);
  }

  sections.push("");
  sections.push("Project Context:");
  sections.push(clip(normalizeWhitespace(row.project_description || "No project description provided."), DESCRIPTION_MAX_CHARS));
  sections.push("");
  sections.push("Task Description:");
  sections.push(summary || "No task description provided.");
  sections.push("");
  sections.push("Acceptance Criteria:");
  for (const criterion of acceptanceCriteria) {
    sections.push(`- ${criterion}`);
  }

  sections.push("");
  sections.push("Execution Requirements:");
  sections.push("- Implement the task in the project workspace with clean, reviewable changes.");
  sections.push("- Run relevant validation/tests for touched code.");
  sections.push("- Summarize what changed, test evidence, and any risks/blockers.");

  if (soul) {
    sections.push("");
    sections.push("Agent Identity (SOUL.md):");
    sections.push(clip(soul, SYSTEM_PROMPT_MAX_CHARS));
  } else {
    sections.push("");
    sections.push("Agent Identity:");
    sections.push(`Role: ${row.agent_role}`);
    sections.push(`Personality: ${row.agent_personality || "Not specified."}`);
  }

  return sections.join("\n").trim();
}

function getExecutionContext(taskId: string, db = getOrchestrationDb()): TaskExecutionContextRow {
  const row = db
    .prepare(
      `SELECT
         t.id AS task_id,
         t.title,
         t.description,
         t.priority,
         t.type,
         t.labels_json,
         p.name AS project_name,
         p.description AS project_description,
         p.slug AS project_slug,
         s.name AS sprint_name,
         s.goal AS sprint_goal,
         a.name AS agent_name,
         a.role AS agent_role,
         a.personality AS agent_personality,
         a.openclaw_agent_id
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       INNER JOIN agents a ON a.id = t.assignee_agent_id
       WHERE t.id = ? AND t.archived_at IS NULL
       LIMIT 1`
    )
    .get(taskId) as TaskExecutionContextRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  return row;
}

async function callGatewayMethod<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const command = process.env.ORCHESTRATION_OPENCLAW_CLI?.trim() || "openclaw";
  const args = [
    "gateway",
    "call",
    method,
    "--json",
    "--params",
    JSON.stringify(params),
  ];

  try {
    const { stdout } = await execFileAsync(command, args, {
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });
    return JSON.parse(stdout) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OrchestrationApiError(
      502,
      "openclaw_gateway_call_failed",
      `OpenClaw gateway call failed for ${method}: ${message}`
    );
  }
}

async function fetchSessionHistory(sessionId: string): Promise<unknown> {
  try {
    return await callGatewayMethod<unknown>("sessions.history", { sessionId, limit: 200 });
  } catch (error) {
    if (!(error instanceof OrchestrationApiError) || error.code !== "openclaw_gateway_call_failed") {
      throw error;
    }
    return callGatewayMethod<unknown>("sessions_history", { sessionId, limit: 200 });
  }
}

function parseCancelAcknowledged(payload: unknown): { acknowledged: boolean; raw?: string } {
  const record = asRecord(payload);
  const statusToken =
    normalizeStatusToken(record?.status) ??
    normalizeStatusToken(record?.state) ??
    normalizeStatusToken(record?.result);
  const okFlag =
    asBoolean(record?.ok) ??
    asBoolean(record?.cancelled) ??
    asBoolean(record?.canceled) ??
    asBoolean(record?.stopped) ??
    asBoolean(record?.terminated) ??
    false;

  if (okFlag) {
    return { acknowledged: true, raw: statusToken };
  }

  const acknowledgedStatus = statusToken
    ? ["cancelled", "canceled", "stopped", "terminated", "done", "completed", "success"].includes(statusToken)
    : false;
  return { acknowledged: acknowledgedStatus, raw: statusToken };
}

async function cancelOpenClawSession(sessionId: string): Promise<{ acknowledged: boolean; raw?: string }> {
  const methods = [
    "sessions.cancel",
    "sessions_cancel",
    "sessions.stop",
    "sessions_stop",
  ] as const;

  let fallbackError: OrchestrationApiError | null = null;
  for (const method of methods) {
    try {
      const payload = await callGatewayMethod<unknown>(method, { sessionId });
      return parseCancelAcknowledged(payload);
    } catch (error) {
      if (!(error instanceof OrchestrationApiError) || error.code !== "openclaw_gateway_call_failed") {
        throw error;
      }
      fallbackError = error;
    }
  }

  throw (
    fallbackError ??
    new OrchestrationApiError(
      502,
      "openclaw_gateway_call_failed",
      "OpenClaw gateway call failed for session cancellation"
    )
  );
}

async function spawnOpenClawTaskSession(
  taskId: string,
  executionRunId: string,
  db: Database.Database
): Promise<TriggerTaskExecutionResult> {
  const context = getExecutionContext(taskId, db);
  if (!context.openclaw_agent_id) {
    return {
      taskId,
      mode: "openclaw",
      queued: false,
      status: "skipped",
      reason: "openclaw_agent_mapping_missing",
    };
  }

  const prompt = buildTaskPrompt(context);
  const key = `agent:${context.openclaw_agent_id}:mission-control:task:${taskId}`;
  const createPayload = {
    key,
    agentId: context.openclaw_agent_id,
    label: `MC task ${taskId}`,
  };
  const create = await callGatewayMethod<OpenClawSessionCreateResult>("sessions.create", createPayload);

  if (!create?.sessionId) {
    throw new OrchestrationApiError(
      502,
      "openclaw_session_create_invalid",
      "OpenClaw sessions.create did not return a sessionId"
    );
  }

  const sendPayload = {
    key: create.key ?? key,
    message: prompt,
  };
  const send = await callGatewayMethod<OpenClawSessionSendResult>("sessions.send", sendPayload);

  const startedAt = new Date().toISOString();
  const nextStatus: ExecutionRunStatus = send?.status === "started" ? "running" : "pending";
  updateExecutionRun(
    executionRunId,
    {
      status: nextStatus,
      sessionId: create.sessionId,
      startedAt,
      tokenUsage: {
        openclawRunId: send?.runId ?? null,
        openclawStatus: send?.status ?? null,
      },
    },
    db
  );

  setTaskExecutionMode(
    {
      taskId,
      mode: "openclaw",
      executionSessionId: create.sessionId,
    },
    db
  );

  return {
    taskId,
    mode: "openclaw",
    queued: true,
    status: send?.status === "started" ? "running" : "queued",
    runId: send?.runId,
    sessionId: create.sessionId,
    reason: "openclaw_session_started",
  };
}

export async function pollTaskExecutionStatus(taskId: string): Promise<PollTaskExecutionResult> {
  const db = getOrchestrationDb();
  const task = getTaskBridgeRecord(taskId, db);
  const polledAt = new Date().toISOString();

  if (task.executionMode !== "openclaw") {
    return {
      taskId: task.id,
      mode: task.executionMode,
      polledAt,
      status: {
        state: "skipped",
        terminal: false,
        reason: "execution_mode_not_openclaw",
      },
      comments: {
        imported: 0,
        skippedDuplicates: 0,
      },
      transition: {
        attempted: false,
        changed: false,
        skipped: true,
        skipReason: "execution_mode_not_openclaw",
      },
      task: getTask(task.id).task,
    };
  }

  const run = getLatestExecutionRunForTask(
    task.id,
    {
      provider: "openclaw",
    },
    db
  );
  if (!run) {
    return {
      taskId: task.id,
      mode: "openclaw",
      polledAt,
      status: {
        state: "skipped",
        terminal: false,
        reason: "execution_run_missing",
      },
      comments: {
        imported: 0,
        skippedDuplicates: 0,
      },
      transition: {
        attempted: false,
        changed: false,
        skipped: true,
        skipReason: "execution_run_missing",
      },
      task: getTask(task.id).task,
    };
  }

  if (!run.sessionId) {
    return {
      taskId: task.id,
      mode: "openclaw",
      polledAt,
      status: {
        state: "skipped",
        terminal: false,
        reason: "execution_session_missing",
      },
      comments: {
        imported: 0,
        skippedDuplicates: 0,
      },
      transition: {
        attempted: false,
        changed: false,
        skipped: true,
        skipReason: "execution_session_missing",
      },
      task: getTask(task.id).task,
    };
  }

  const payload = await fetchSessionHistory(run.sessionId);
  const parsed = parseOpenClawHistory(payload, run.sessionId);
  const existingRefs = listTaskExternalCommentRefs({
    taskId: task.id,
    source: OPENCLAW_COMMENT_SOURCE,
  });

  let imported = 0;
  let skippedDuplicates = 0;
  let lastImportedEventId: string | undefined;
  for (const event of parsed.events) {
    if (existingRefs.has(event.id)) {
      skippedDuplicates += 1;
      continue;
    }

    createTaskComment({
      taskId: task.id,
      type: "status_update",
      authorUserId: OPENCLAW_SYSTEM_ACTOR,
      source: OPENCLAW_COMMENT_SOURCE,
      externalRef: event.id,
      createdAt: event.createdAt,
      body: eventBody(event.role, event.body),
    });
    existingRefs.add(event.id);
    imported += 1;
    lastImportedEventId = event.id;
  }

  const current = getTask(task.id).task;
  let transition: PollTaskExecutionResult["transition"] = {
    attempted: false,
    from: current.status,
    to: current.status,
    changed: false,
    skipped: false,
  };

  if (parsed.terminal) {
    if (current.status === "in-progress") {
      try {
        moveTask({
          taskId: task.id,
          status: "review",
          actorUserId: OPENCLAW_SYSTEM_ACTOR,
        });
        transition = {
          attempted: true,
          from: "in-progress",
          to: "review",
          changed: true,
          skipped: false,
        };

        const completionRef = `openclaw:session:${run.sessionId}:completed`;
        if (!existingRefs.has(completionRef)) {
          createTaskComment({
            taskId: task.id,
            type: "status_update",
            authorUserId: OPENCLAW_SYSTEM_ACTOR,
            source: OPENCLAW_COMMENT_SOURCE,
            externalRef: completionRef,
            body: [
              `OpenClaw session reached a terminal state${parsed.state ? ` (${parsed.state})` : ""}.`,
              "",
              "Task auto-moved to Review.",
            ].join("\n"),
          });
          existingRefs.add(completionRef);
        }
      } catch (error) {
        const skipReason =
          error instanceof OrchestrationApiError ? error.code : "review_transition_failed";
        transition = {
          attempted: true,
          from: current.status,
          to: "review",
          changed: false,
          skipped: true,
          skipReason,
        };
      }
    } else {
      transition = {
        attempted: false,
        from: current.status,
        to: current.status,
        changed: false,
        skipped: true,
        skipReason: "task_not_in_progress",
      };
    }
  }

  const resolvedRunStatus = parsed.terminal
    ? mapOpenClawTerminalStateToRunStatus(parsed.state)
    : "running";
  const runCompletedAt = parsed.terminal ? new Date().toISOString() : undefined;
  const runDurationMs =
    parsed.terminal && run.startedAt
      ? Math.max(0, Date.parse(runCompletedAt ?? polledAt) - Date.parse(run.startedAt))
      : undefined;

  updateExecutionRun(
    run.id,
    {
      status: resolvedRunStatus,
      completedAt: runCompletedAt,
      durationMs: runDurationMs,
    },
    db
  );

  const updatedTask = getTask(task.id).task;
  return {
    taskId: task.id,
    mode: "openclaw",
    runId: run.id,
    agentId: run.agentId,
    sessionId: run.sessionId,
    polledAt,
    status: {
      state: parsed.terminal ? "completed" : mapRunToPollState(run),
      terminal: parsed.terminal || ["completed", "failed", "cancelled"].includes(resolvedRunStatus),
      raw: parsed.state,
    },
    comments: {
      imported,
      skippedDuplicates,
      lastImportedEventId,
    },
    transition,
    task: updatedTask,
  };
}


export async function triggerTaskNudge(
  input: {
    taskId: string;
    idempotencyKey?: string;
    reason?: string;
    forceFreshSession?: boolean;
  }
): Promise<TriggerTaskNudgeResult> {
  const db = getOrchestrationDb();
  const task = getTaskBridgeRecord(input.taskId, db);
  const executionProvider = getOrchestrationExecutionProvider();
  const mode: TriggerTaskNudgeResult["mode"] =
    executionProvider === "paperclip" ? "paperclip" : "openclaw";

  if (!task.assigneeAgentId) {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: "assignee_required",
    };
  }

  if (executionProvider === "openclaw") {
    if (!task.assigneeOpenclawAgentId) {
      return {
        taskId: task.id,
        mode: "openclaw",
        queued: false,
        status: "skipped",
        reason: "openclaw_agent_mapping_missing",
      };
    }

    const wake = enqueueWakeup(
      {
        agentId: task.assigneeAgentId,
        companyId: task.companyId,
        source: "issue_assigned",
        reason: input.reason ?? "mission_control_task_assignment_nudge",
        payload: {
          taskId: task.id,
          taskStatus: task.status,
          projectId: task.projectId,
          projectName: task.projectName,
          executionMode: task.executionMode,
        },
        idempotencyKey: input.idempotencyKey,
      },
      db
    );

    return {
      taskId: task.id,
      mode: "openclaw",
      queued: true,
      status: wake.status === "coalesced" ? "queued" : wake.status,
      runId: wake.heartbeatRunId || undefined,
      reason: wake.status === "coalesced" ? "idempotency_key_reused" : input.reason,
    };
  }

  const wake = await triggerTaskAssigneeNudge(input);
  return {
    taskId: wake.taskId,
    mode: "paperclip",
    queued: wake.queued,
    status: wake.status,
    runId: wake.runId,
    reason: wake.reason,
  };
}

export async function triggerTaskExecution(
  input: {
    taskId: string;
    idempotencyKey?: string;
    reason?: string;
    forceFreshSession?: boolean;
  }
): Promise<TriggerTaskExecutionResult> {
  const db = getOrchestrationDb();
  const task = getTaskBridgeRecord(input.taskId, db);
  const executionProvider = getOrchestrationExecutionProvider();
  const mode: TriggerTaskExecutionResult["mode"] =
    executionProvider === "paperclip" ? "paperclip" : "openclaw";
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;

  if (task.status !== "in_progress") {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: "task_not_in_progress",
    };
  }

  if (!task.assigneeAgentId) {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: "assignee_required",
    };
  }

  if (normalizedIdempotencyKey) {
    const existingIdempotentRun = getExecutionRunByIdempotencyKey(normalizedIdempotencyKey, db);
    if (existingIdempotentRun) {
      if (existingIdempotentRun.taskId !== task.id) {
        throw new OrchestrationApiError(
          409,
          "idempotency_key_conflict",
          "idempotencyKey is already in use for a different task"
        );
      }
      return {
        taskId: existingIdempotentRun.taskId,
        mode: existingIdempotentRun.provider,
        queued: existingIdempotentRun.status === "pending" || existingIdempotentRun.status === "running",
        status: mapRunToTriggerStatus(existingIdempotentRun),
        sessionId: existingIdempotentRun.sessionId,
        runId: asString(existingIdempotentRun.tokenUsage.openclawRunId),
        reason: "idempotency_key_reused",
      };
    }
  }

  if (executionProvider === "openclaw" && !input.forceFreshSession) {
    const activeOpenclawRun = getLatestExecutionRunForTask(
      task.id,
      {
        provider: "openclaw",
        statuses: ["pending", "running"],
      },
      db
    );
    if (activeOpenclawRun) {
      return {
        taskId: task.id,
        mode: "openclaw",
        queued: false,
        status: "skipped",
        sessionId: activeOpenclawRun.sessionId,
        reason: "openclaw_session_already_attached",
      };
    }
  }

  if (
    executionProvider === "openclaw" &&
    task.executionMode === "openclaw" &&
    task.executionSessionId &&
    !input.forceFreshSession
  ) {
    return {
      taskId: task.id,
      mode: "openclaw",
      queued: false,
      status: "skipped",
      sessionId: task.executionSessionId,
      reason: "openclaw_session_already_attached",
    };
  }

  if (executionProvider === "openclaw") {
    if (!task.assigneeOpenclawAgentId) {
      return {
        taskId: task.id,
        mode: "openclaw",
        queued: false,
        status: "skipped",
        reason: "openclaw_agent_mapping_missing",
      };
    }

    const { run, reused } = createExecutionRunWithIdempotencyRecovery(
      {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        provider: "openclaw",
        status: "pending",
        idempotencyKey: normalizedIdempotencyKey,
      },
      db
    );

    if (reused) {
      return {
        taskId: run.taskId,
        mode: run.provider,
        queued: run.status === "pending" || run.status === "running",
        status: mapRunToTriggerStatus(run),
        sessionId: run.sessionId,
        runId: asString(run.tokenUsage.openclawRunId),
        reason: "idempotency_key_reused",
      };
    }

    // Route execution through the engine tick pipeline instead of spawning
    // a fire-and-forget OpenClaw session directly. The engine tick's
    // executeHeartbeatRun() properly awaits completion and bridges the
    // result back to execution_runs via finishRun(). It finds the
    // execution_run we just created (status='pending') and reuses its ID.
    const wake = enqueueWakeup(
      {
        agentId: task.assigneeAgentId,
        companyId: task.companyId,
        source: "issue_assigned",
        reason: input.reason ?? "task_created_in_progress",
        payload: { taskId: task.id, executionRunId: run.id },
        idempotencyKey: normalizedIdempotencyKey,
      },
      db
    );

    return {
      taskId: task.id,
      mode: "openclaw",
      queued: true,
      status: wake.status === "coalesced" ? "queued" : wake.status,
      runId: wake.heartbeatRunId || undefined,
      reason: wake.status === "coalesced"
        ? "idempotency_key_reused"
        : (input.reason ?? "task_created_in_progress"),
    };
  }

  const { run, reused } = createExecutionRunWithIdempotencyRecovery(
    {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      provider: "paperclip",
      status: "pending",
      idempotencyKey: normalizedIdempotencyKey,
    },
    db
  );

  if (reused) {
    return {
      taskId: run.taskId,
      mode: run.provider,
      queued: run.status === "pending" || run.status === "running",
      status: mapRunToTriggerStatus(run),
      sessionId: run.sessionId,
      runId: asString(run.tokenUsage.paperclipRunId),
      reason: "idempotency_key_reused",
    };
  }

  const heartbeat = await triggerTaskAssignmentHeartbeat(input);
  updateExecutionRun(
    run.id,
    {
      status: heartbeat.status === "running" ? "running" : "pending",
      startedAt: heartbeat.status === "running" ? new Date().toISOString() : undefined,
      tokenUsage: {
        paperclipRunId: heartbeat.runId ?? null,
      },
    },
    db
  );
  return {
    taskId: heartbeat.taskId,
    mode: "paperclip",
    queued: heartbeat.queued,
    status: heartbeat.status,
    runId: heartbeat.runId,
    reason: heartbeat.reason,
  };
}

export async function cancelTaskExecution(input: {
  taskId: string;
  actorUserId?: string;
  note?: string;
  targetStatus?: "on-deck" | "in-progress";
}): Promise<CancelTaskExecutionResult> {
  const db = getOrchestrationDb();
  const task = getTaskBridgeRecord(input.taskId, db);
  const current = getTask(task.id).task;
  const targetStatus = input.targetStatus ?? "on-deck";

  if (task.executionMode !== "openclaw") {
    return {
      taskId: task.id,
      mode: task.executionMode,
      cancelled: {
        attempted: false,
        acknowledged: false,
        status: "skipped",
        reason: "execution_mode_not_openclaw",
      },
      transition: {
        attempted: false,
        from: current.status,
        to: current.status,
        changed: false,
        skipped: true,
        skipReason: "execution_mode_not_openclaw",
      },
      task: current,
    };
  }

  const run =
    getLatestExecutionRunForTask(
      task.id,
      {
        provider: "openclaw",
        statuses: ["pending", "running"],
      },
      db
    ) ??
    getLatestExecutionRunForTask(
      task.id,
      {
        provider: "openclaw",
      },
      db
    );

  if (!run?.sessionId) {
    return {
      taskId: task.id,
      mode: "openclaw",
      cancelled: {
        attempted: false,
        acknowledged: false,
        status: "skipped",
        reason: "execution_session_missing",
      },
      transition: {
        attempted: false,
        from: current.status,
        to: current.status,
        changed: false,
        skipped: true,
        skipReason: "execution_session_missing",
      },
      task: current,
    };
  }

  if (current.status !== "in-progress") {
    return {
      taskId: task.id,
      mode: "openclaw",
      sessionId: run.sessionId,
      cancelled: {
        attempted: false,
        acknowledged: false,
        status: "skipped",
        reason: "task_not_in_progress",
      },
      transition: {
        attempted: false,
        from: current.status,
        to: current.status,
        changed: false,
        skipped: true,
        skipReason: "task_not_in_progress",
      },
      task: current,
    };
  }

  const cancellation = await cancelOpenClawSession(run.sessionId);
  const actorUserId = input.actorUserId?.trim() || "mission-control:execution-cancel";
  const cancellationRef = `openclaw:session:${run.sessionId}:cancelled`;

  const commentLines = [
    `OpenClaw session cancellation requested by Mission Control for session \`${run.sessionId}\`.`,
    "",
    cancellation.acknowledged
      ? "Gateway acknowledged cancellation."
      : "Gateway response did not explicitly confirm cancellation; review OpenClaw session state.",
  ];
  if (input.note?.trim()) {
    commentLines.push("", `Note: ${input.note.trim()}`);
  }
  if (cancellation.acknowledged && targetStatus === "on-deck") {
    commentLines.push("", "Task moved to On Deck for reassignment.");
  } else if (cancellation.acknowledged) {
    commentLines.push("", "Task remains In Progress after cancellation.");
  }

  createTaskComment({
    taskId: task.id,
    type: "status_update",
    authorUserId: actorUserId,
    source: "mission_control",
    externalRef: cancellationRef,
    body: commentLines.join("\n"),
  });

  let transition: CancelTaskExecutionResult["transition"] = {
    attempted: false,
    from: current.status,
    to: current.status,
    changed: false,
    skipped: false,
  };

  if (cancellation.acknowledged) {
    const completedAt = new Date().toISOString();
    updateExecutionRun(
      run.id,
      {
        status: "cancelled",
        completedAt,
        durationMs: run.startedAt
          ? Math.max(0, Date.parse(completedAt) - Date.parse(run.startedAt))
          : undefined,
      },
      db
    );

    setTaskExecutionMode({
      taskId: task.id,
      mode: "openclaw",
      executionSessionId: null,
    });

    if (targetStatus === "on-deck") {
      const moved = moveTask({
        taskId: task.id,
        status: "on-deck",
        actorUserId,
      });
      transition = {
        attempted: true,
        from: moved.transition.from,
        to: moved.transition.to,
        changed: moved.transition.statusChanged,
        skipped: false,
      };
    } else {
      transition = {
        attempted: false,
        from: current.status,
        to: current.status,
        changed: false,
        skipped: true,
        skipReason: "target_status_in_progress",
      };
    }
  } else {
    transition = {
      attempted: false,
      from: current.status,
      to: current.status,
      changed: false,
      skipped: true,
      skipReason: "cancellation_not_acknowledged",
    };
  }

  const updatedTask = getTask(task.id).task;
  return {
    taskId: task.id,
    mode: "openclaw",
    sessionId: run.sessionId,
    cancelled: {
      attempted: true,
      acknowledged: cancellation.acknowledged,
      status: cancellation.acknowledged ? "cancelled" : "skipped",
      reason: cancellation.acknowledged ? undefined : "cancellation_not_acknowledged",
      raw: cancellation.raw,
    },
    transition,
    task: updatedTask,
  };
}
