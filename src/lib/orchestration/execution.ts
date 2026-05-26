import { execFile } from "child_process";
import { promisify } from "util";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { reconcileTerminalOpenClawTaskState } from "@/lib/orchestration/openclaw-reconciliation";
import { getTaskBridgeRecord, listTaskExternalCommentRefs, setTaskExecutionMode } from "@/lib/orchestration/bridge/store";
import type { BridgeRuntimeProvider, BridgeTaskRecord } from "@/lib/orchestration/bridge/types";
import { getOrchestrationExecutionProvider } from "@/lib/orchestration/execution-provider";
import { resolveExecutionRoute } from "@/lib/orchestration/execution-route-resolver";
import {
  enqueueWakeup,
  executeMcAction,
  parseActionsFromText,
  type McActionExecutionOutcome,
} from "@/lib/orchestration/engine/engine";
import { emitHarnessWarningComment } from "@/lib/orchestration/engine/harness-warning";
import { cleanupRunArtifacts } from "@/lib/orchestration/execution/cleanup";
import { getExecutionAdapter } from "@/lib/orchestration/execution/adapters";
import { buildTaskGoalContextSection } from "@/lib/orchestration/goal-context";
import { createTaskComment, getTask, moveTask } from "@/lib/orchestration/service";
import { canAutonomouslyExecuteCompany } from "@/lib/orchestration/service/dev-execution-test-mode";
import type { TaskStatusInput } from "@/lib/orchestration/contracts";
import type { TaskStatus } from "@/lib/orchestration/types";

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
  goal_context: string | null;
  agent_id: string;
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

function pausedAssigneeSkipReason(status: string | undefined): "assignee_paused" | "assignee_offline" | null {
  if (status === "paused") return "assignee_paused";
  if (status === "offline") return "assignee_offline";
  return null;
}

export type TriggerTaskExecutionResult = {
  taskId: string;
  mode: BridgeRuntimeProvider;
  queued: boolean;
  status: "queued" | "running" | "skipped";
  runId?: string;
  sessionId?: string;
  reason?: string;
};

export type TriggerTaskNudgeResult = TriggerTaskExecutionResult;

export type PollTaskExecutionResult = {
  taskId: string;
  mode: BridgeRuntimeProvider;
  runId?: string;
  agentId?: string;
  sessionId?: string;
  polledAt: string;
  status: {
    state: "running" | "completed" | "failed" | "cancelled" | "unknown" | "skipped";
    terminal: boolean;
    reason?: string;
    raw?: string;
  };
  comments: {
    imported: number;
    skippedDuplicates: number;
    lastImportedEventId?: string;
  };
  actions: {
    found: number;
    executed: number;
    skippedDuplicates: number;
    failed: number;
    tasksCreated: string[];
    approvalsCreated: string[];
    errors: string[];
  };
  transition: {
    attempted: boolean;
    from?: TaskStatus;
    to?: TaskStatus;
    changed: boolean;
    skipped: boolean;
    skipReason?: string;
  };
  task: ReturnType<typeof getTask>["task"];
};

export type CancelTaskExecutionResult = {
  taskId: string;
  mode: BridgeRuntimeProvider;
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
    from?: TaskStatus;
    to?: TaskStatus;
    changed: boolean;
    skipped: boolean;
    skipReason?: string;
  };
  task: ReturnType<typeof getTask>["task"];
};

type ExecutionProvider = Exclude<BridgeRuntimeProvider, "manual">;
type ExecutionRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type ExecutionRunRow = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  provider: ExecutionProvider;
  execution_engine: BridgeTaskRecord["executionEngine"] | null;
  runner_provider: string | null;
  runner_model: string | null;
  model_lane: string | null;
  fallback_used: number;
  fallback_index: number | null;
  fallback_from_provider: string | null;
  route_attempts_json: string;
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
  process_pid: number | null;
  failure_class: string | null;
};

type ExecutionRunRecord = {
  id: string;
  taskId?: string | null;
  agentId?: string;
  provider: ExecutionProvider;
  executionEngine?: BridgeTaskRecord["executionEngine"] | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
  modelLane?: string | null;
  fallbackUsed: boolean;
  fallbackIndex?: number | null;
  fallbackFromProvider?: string | null;
  routeAttempts: unknown[];
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
  processPid?: number | null;
  failureClass?: string | null;
};

function executionProviderForTask(task: BridgeTaskRecord, db = getOrchestrationDb()): BridgeRuntimeProvider {
  const route = resolveExecutionRoute({ companyId: task.companyId, task }, db);
  if (route.executionEngine === "manual") return "manual";
  // The route resolver owns the orchestration engine and lane metadata, then
  // derives the concrete runner provider/model from the assigned agent profile.
  if (route.executionEngine === "symphony") return "symphony";
  return route.primary.runtimeProvider ?? getOrchestrationExecutionProvider();
}

function isExecutionRunProvider(provider: BridgeRuntimeProvider): provider is ExecutionProvider {
  return (
    provider === "openclaw" ||
    provider === "codex" ||
    provider === "anthropic" ||
    provider === "hermes" ||
    provider === "gemini" ||
    provider === "symphony"
  );
}

function executionRunIdFromUsage(run: ExecutionRunRecord): string | undefined {
  return (
    asString(run.tokenUsage.openclawRunId) ??
    asString(run.tokenUsage.heartbeatRunId)
  );
}

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

function parseJsonArrayRecords(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapExecutionRunRow(row: ExecutionRunRow): ExecutionRunRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id ?? undefined,
    provider: row.provider,
    executionEngine: row.execution_engine ?? undefined,
    runnerProvider: row.runner_provider ?? undefined,
    runnerModel: row.runner_model ?? undefined,
    modelLane: row.model_lane ?? undefined,
    fallbackUsed: row.fallback_used === 1,
    fallbackIndex: row.fallback_index,
    fallbackFromProvider: row.fallback_from_provider,
    routeAttempts: parseJsonArrayRecords(row.route_attempts_json),
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
    processPid: row.process_pid ?? null,
    failureClass: row.failure_class ?? null,
  };
}

function emptyExecutionStats(): Pick<PollTaskExecutionResult, "comments" | "actions"> {
  return {
    comments: {
      imported: 0,
      skippedDuplicates: 0,
    },
    actions: {
      found: 0,
      executed: 0,
      skippedDuplicates: 0,
      failed: 0,
      tasksCreated: [],
      approvalsCreated: [],
      errors: [],
    },
  };
}

function mapGenericExecutionRunState(run: ExecutionRunRecord): PollTaskExecutionResult["status"] {
  if (run.status === "pending" || run.status === "running") {
    return {
      state: "running",
      terminal: false,
      raw: run.status,
    };
  }
  if (run.status === "failed") {
    return {
      state: "failed",
      terminal: true,
      raw: run.status,
      reason: run.errorMessage,
    };
  }
  if (run.status === "cancelled") {
    return {
      state: "cancelled",
      terminal: true,
      raw: run.status,
      reason: run.errorMessage,
    };
  }
  return {
    state: "completed",
    terminal: true,
    raw: run.status,
    reason: run.errorMessage,
  };
}

function genericExecutionSource(provider: ExecutionProvider): "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony" {
  return provider;
}

function providerDisplayName(provider: ExecutionProvider): string {
  if (provider === "anthropic") return "Claude Code";
  if (provider === "codex") return "Codex";
  if (provider === "gemini") return "Gemini";
  if (provider === "hermes") return "HERMES";
  if (provider === "openclaw") return "OpenClaw";
  if (provider === "symphony") return "External runner";
  return provider;
}

function ensureGenericExecutionTerminalComment(run: ExecutionRunRecord): void {
  if (!run.taskId || (run.status !== "failed" && run.status !== "cancelled")) return;
  if (shouldSuppressNeverStartedCancellationComment(run)) return;
  const label = providerDisplayName(run.provider);
  const verb = run.status === "failed" ? "failed" : "was cancelled";
  const detail = run.errorMessage?.trim();
  createTaskComment({
    taskId: run.taskId,
    type: "comment",
    authorUserId: `${run.provider}:execution`,
    source: genericExecutionSource(run.provider),
    externalRef: `${run.provider}:execution:${run.id}:${run.status}`,
    body: [
      `${label} execution ${verb}.`,
      ...(detail ? ["", detail] : []),
    ].join("\n"),
  });
}

function shouldSuppressNeverStartedCancellationComment(run: ExecutionRunRecord): boolean {
  if (run.status !== "cancelled" || run.startedAt) return false;

  const detail = run.errorMessage?.trim() ?? "";
  const looksLikeQueueCleanup =
    detail.includes("execution run was not started") ||
    detail.startsWith("Cancelled: task reached a terminal status before this execution run started");

  if (!looksLikeQueueCleanup) return false;

  try {
    const current = run.taskId ? getTask(run.taskId).task : null;
    return current?.status === "done" || current?.status === "blocked" || current?.status === "cancelled";
  } catch {
    return false;
  }
}

function reconcileGenericFailedExecutionTask(run: ExecutionRunRecord): PollTaskExecutionResult["transition"] | null {
  if (!run.taskId || run.status !== "failed") return null;
  const current = getTask(run.taskId).task;
  if (current.status !== "in-progress") return null;

  const label = providerDisplayName(run.provider);
  const detail = run.errorMessage?.trim();
  if (detail === "no_op_resubmission") {
    emitHarnessWarningComment({
      db: getOrchestrationDb(),
      taskId: run.taskId,
      agentId: run.agentId ?? "system",
      runId: run.id,
      severity: "warning",
      body:
        `[HARNESS_WARNING] ${label} rejected a review resubmission for this task as no_op_resubmission. ` +
        "The task stayed in progress so the assignee can address the review gaps instead of being blocked by a runner-failure wrapper.",
    });
    return {
      attempted: true,
      from: "in-progress",
      to: "blocked",
      changed: false,
      skipped: true,
      skipReason: "no_op_resubmission_left_in_progress",
    };
  }
  try {
    moveTask({
      taskId: run.taskId,
      status: "blocked",
      actorUserId: `${run.provider}:execution`,
      blockedReason: detail ? `${label} execution failed: ${detail}` : `${label} execution failed.`,
    });
    return {
      attempted: true,
      from: "in-progress",
      to: "blocked",
      changed: true,
      skipped: false,
    };
  } catch (error) {
    return {
      attempted: true,
      from: current.status,
      to: "blocked",
      changed: false,
      skipped: true,
      skipReason: error instanceof OrchestrationApiError ? error.code : "failed_execution_block_transition_failed",
    };
  }
}

function createExecutionRun(
  input: {
    taskId?: string | null;
    agentId?: string;
    provider: ExecutionProvider;
    executionEngine?: BridgeTaskRecord["executionEngine"] | null;
    runnerProvider?: string | null;
    runnerModel?: string | null;
    modelLane?: string | null;
    fallbackUsed?: boolean;
    fallbackIndex?: number | null;
    fallbackFromProvider?: string | null;
    routeAttempts?: unknown[];
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
      (id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model, model_lane, fallback_used, fallback_index, fallback_from_provider, route_attempts_json, session_id, status, started_at, completed_at, error_message, token_usage_json, duration_ms, idempotency_key, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.taskId ?? null,
    input.agentId ?? null,
    input.provider,
    input.executionEngine ?? null,
    input.runnerProvider ?? input.provider,
    input.runnerModel ?? null,
    input.modelLane ?? null,
    input.fallbackUsed ? 1 : 0,
    typeof input.fallbackIndex === "number" ? input.fallbackIndex : null,
    input.fallbackFromProvider ?? null,
    JSON.stringify(input.routeAttempts ?? []),
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
         id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model,
         model_lane, fallback_used, fallback_index, fallback_from_provider, route_attempts_json,
         session_id, status, started_at, completed_at, error_message,
         token_usage_json, duration_ms, idempotency_key, created_at, updated_at,
         process_pid, failure_class
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
         id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model,
         model_lane, fallback_used, fallback_index, fallback_from_provider, route_attempts_json,
         session_id, status, started_at, completed_at, error_message,
         token_usage_json, duration_ms, idempotency_key, created_at, updated_at,
         process_pid, failure_class
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
         id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model,
         model_lane, fallback_used, fallback_index, fallback_from_provider, route_attempts_json,
         session_id, status, started_at, completed_at, error_message,
         token_usage_json, duration_ms, idempotency_key, created_at, updated_at,
         process_pid, failure_class
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
    runnerProvider?: string | null;
    runnerModel?: string | null;
    modelLane?: string | null;
    fallbackUsed?: boolean;
    fallbackIndex?: number | null;
    fallbackFromProvider?: string | null;
    routeAttempts?: unknown[];
    failureClass?: string | null;
    clearProcessPid?: boolean;
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
         runner_provider = COALESCE(?, runner_provider),
         runner_model = COALESCE(?, runner_model),
         model_lane = COALESCE(?, model_lane),
         fallback_used = COALESCE(?, fallback_used),
         fallback_index = COALESCE(?, fallback_index),
         fallback_from_provider = COALESCE(?, fallback_from_provider),
         route_attempts_json = COALESCE(?, route_attempts_json),
         failure_class = COALESCE(?, failure_class),
         process_pid = CASE WHEN ? THEN NULL ELSE process_pid END,
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
    patch.runnerProvider === undefined ? null : patch.runnerProvider,
    patch.runnerModel === undefined ? null : patch.runnerModel,
    patch.modelLane === undefined ? null : patch.modelLane,
    patch.fallbackUsed === undefined ? null : patch.fallbackUsed ? 1 : 0,
    patch.fallbackIndex === undefined ? null : patch.fallbackIndex,
    patch.fallbackFromProvider === undefined ? null : patch.fallbackFromProvider,
    patch.routeAttempts === undefined ? null : JSON.stringify(patch.routeAttempts),
    patch.failureClass === undefined ? null : patch.failureClass,
    patch.clearProcessPid ? 1 : 0,
    now,
    runId
  );

  return getExecutionRunById(runId, db);
}

function cancelLinkedHeartbeatRun(run: ExecutionRunRecord, completedAt: string, db = getOrchestrationDb()): void {
  const heartbeatRunId = asString(run.tokenUsage.heartbeatRunId);
  const heartbeat = heartbeatRunId
    ? db
        .prepare(
          `SELECT id, wakeup_request_id
           FROM heartbeat_runs
           WHERE id = ?
             AND status IN ('queued', 'running')
           LIMIT 1`
        )
        .get(heartbeatRunId)
    : db
        .prepare(
          `SELECT id, wakeup_request_id
           FROM heartbeat_runs
           WHERE json_extract(context_snapshot_json, '$.executionRunId') = ?
             AND status IN ('queued', 'running')
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(run.id);

  const row = heartbeat as { id: string; wakeup_request_id: string | null } | undefined;
  if (!row) return;

  db.prepare(
    `UPDATE heartbeat_runs
     SET status = 'cancelled',
         finished_at = COALESCE(finished_at, ?),
         error = COALESCE(error, ?),
         updated_at = ?
     WHERE id = ?
       AND status IN ('queued', 'running')`
  ).run(completedAt, "Execution run cancelled by HiveRunner.", completedAt, row.id);

  if (row.wakeup_request_id) {
    db.prepare(
      `UPDATE agent_wakeup_requests
       SET status = 'failed',
           finished_at = COALESCE(finished_at, ?),
           updated_at = ?
       WHERE id = ?
         AND status IN ('queued', 'claimed')`
    ).run(completedAt, completedAt, row.wakeup_request_id);
  }
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
  return `${value.slice(0, maxChars)}\n\n[truncated by HiveRunner]`;
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
    "HiveRunner Task Assignment",
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
  if (row.goal_context) {
    sections.push(row.goal_context);
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
         a.id AS agent_id,
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

  row.goal_context = buildTaskGoalContextSection({
    db,
    taskId,
    agentId: row.agent_id,
  });

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
  // The OpenClaw gateway has no `sessions.history` / `sessions_history` method —
  // prior attempts at both spammed gateway.log with INVALID_REQUEST and spawned
  // two failing subprocesses per poll tick. Use `sessions.list` → find by
  // sessionId → `sessions.get(key)` and synthesize the history shape.
  const listPayload = await callGatewayMethod<
    { sessions?: Array<{ key?: string; sessionId?: string; status?: string | null; startedAt?: string | number | null; endedAt?: string | number | null }> } |
    Array<{ key?: string; sessionId?: string; status?: string | null; startedAt?: string | number | null; endedAt?: string | number | null }>
  >("sessions.list", {});
  const sessions = Array.isArray(listPayload)
    ? listPayload
    : Array.isArray(listPayload?.sessions)
      ? listPayload.sessions
      : [];
  const sessionEntry = sessions.find((entry) => entry.sessionId === sessionId);

  if (!sessionEntry?.key) {
    throw new OrchestrationApiError(
      502,
      "openclaw_gateway_call_failed",
      `OpenClaw gateway call failed for session history lookup: session ${sessionId} not found in sessions.list`
    );
  }

  const sessionPayload = await callGatewayMethod<Record<string, unknown>>("sessions.get", { key: sessionEntry.key });
  const rawMessages = Array.isArray(sessionPayload?.messages) ? sessionPayload.messages : [];
  const fallbackCreatedAt = (() => {
    const raw = sessionEntry.endedAt ?? sessionEntry.startedAt;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return new Date(raw).toISOString();
    }
    if (typeof raw === "string") {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        return new Date(numeric).toISOString();
      }
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    return new Date().toISOString();
  })();
  const assistantMessages = rawMessages.flatMap((entry, index) => {
    const record = asRecord(entry);
    if (!record || record.role !== "assistant") {
      return [];
    }
    return [{
      ...record,
      id: asString(record.id) ?? `sessions.get:${sessionId}:${index}`,
      createdAt:
        asString(record.createdAt) ??
        asString(record.created_at) ??
        asString(record.timestamp) ??
        fallbackCreatedAt,
    }];
  });

  return {
    ...(sessionPayload ?? {}),
    sessionId,
    status:
      normalizeStatusToken(sessionPayload?.status) ??
      normalizeStatusToken(sessionEntry.status) ??
      undefined,
    messages: assistantMessages,
  };
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
  // Session keys are persisted in the external gateway; keep the old namespace
  // so retries attach to existing task sessions instead of creating duplicates.
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
  const executionProvider = executionProviderForTask(task, db);

  if (executionProvider !== "openclaw") {
    const run = isExecutionRunProvider(executionProvider)
      ? getLatestExecutionRunForTask(
          task.id,
          {
            provider: executionProvider,
          },
          db
        )
      : null;

    if (run) {
      ensureGenericExecutionTerminalComment(run);
      const failedTransition = reconcileGenericFailedExecutionTask(run);
      return {
        taskId: task.id,
        mode: executionProvider,
        runId: run.id,
        agentId: run.agentId,
        sessionId: run.sessionId,
        polledAt,
        status: mapGenericExecutionRunState(run),
        ...emptyExecutionStats(),
        transition: failedTransition ?? {
          attempted: false,
          changed: false,
          skipped: true,
          skipReason:
            run.status === "completed"
              ? "execution_run_already_terminal"
              : run.status === "failed"
                ? "execution_run_failed"
                : run.status === "cancelled"
                  ? "execution_run_cancelled"
                  : "non_openclaw_execution_run",
        },
        task: getTask(task.id).task,
      };
    }

    return {
      taskId: task.id,
      mode: executionProvider,
      polledAt,
      status: {
        state: "skipped",
        terminal: false,
        reason: executionProvider === "manual" ? "manual_runtime" : "execution_run_missing",
      },
      ...emptyExecutionStats(),
      transition: {
        attempted: false,
        changed: false,
        skipped: true,
        skipReason: executionProvider === "manual" ? "manual_runtime" : "execution_run_missing",
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
      actions: {
        found: 0,
        executed: 0,
        skippedDuplicates: 0,
        failed: 0,
        tasksCreated: [],
        approvalsCreated: [],
        errors: [],
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
      actions: {
        found: 0,
        executed: 0,
        skippedDuplicates: 0,
        failed: 0,
        tasksCreated: [],
        approvalsCreated: [],
        errors: [],
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

  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    const reconciliation = reconcileTerminalOpenClawTaskState(task.id, db);
    const reconciledTask = getTask(task.id).task;
    return {
      taskId: task.id,
      mode: "openclaw",
      runId: run.id,
      agentId: run.agentId,
      sessionId: run.sessionId,
      polledAt,
      status: {
        state: "completed",
        terminal: true,
        raw: run.status,
      },
      comments: {
        imported: 0,
        skippedDuplicates: 0,
      },
      actions: {
        found: 0,
        executed: 0,
        skippedDuplicates: 0,
        failed: 0,
        tasksCreated: [],
        approvalsCreated: [],
        errors: [],
      },
      transition: {
        attempted: reconciliation.movedToReview,
        from: reconciliation.movedToReview ? "in-progress" : reconciledTask.status,
        to: reconciliation.movedToReview ? "review" : reconciledTask.status,
        changed: reconciliation.movedToReview,
        skipped: !reconciliation.movedToReview,
        skipReason: reconciliation.movedToReview ? undefined : "execution_run_already_terminal",
      },
      task: reconciledTask,
    };
  }

  const payload = await fetchSessionHistory(run.sessionId);
  const parsed = parseOpenClawHistory(payload, run.sessionId);
  const existingRefs = listTaskExternalCommentRefs({
    taskId: task.id,
    source: OPENCLAW_COMMENT_SOURCE,
  });

  // Dual-ingestion note: the engine heartbeat loop also imports assistant
  // output (via OpenClaw CLI jsonl) and executes mc-action blocks. That path
  // and this one can race. Action executors (executeCreateTask, etc.) all
  // dedup at the DB layer (normalized title, name+role, status idempotency,
  // content fingerprint) so cross-path double-execution is safe. The bug
  // this addresses: pre-fix, THIS path stored the assistant's raw output
  // — fences and all — as a status_update comment without parsing mc-action
  // blocks, so agents that delivered work via this path (UI-triggered poll
  // while task detail page is open) had their action JSON dropped on the
  // floor. Example: WEA-211 2026-04-18T21:07Z, 4 fenced action blocks
  // imported as a single raw-body comment, 0 tasks created.
  let imported = 0;
  let skippedDuplicates = 0;
  let lastImportedEventId: string | undefined;
  const actionStats = {
    found: 0,
    executed: 0,
    skippedDuplicates: 0,
    failed: 0,
    tasksCreated: [] as string[],
    approvalsCreated: [] as string[],
    errors: [] as string[],
  };

  for (const event of parsed.events) {
    if (existingRefs.has(event.id)) {
      skippedDuplicates += 1;
      continue;
    }

    const { actions, plainText, parseErrors } = parseActionsFromText(event.body);
    if (parseErrors.length > 0) {
      actionStats.errors.push(...parseErrors);
    }
    actionStats.found += actions.length;

    if (actions.length > 0 && task.assigneeAgentId) {
      for (const action of actions) {
        const outcome = await executeMcAction(
          action,
          {
            agentId: task.assigneeAgentId,
            agentName: task.assigneeAgentName ?? "",
            companyId: task.companyId,
            taskKey: task.id,
            runId: run.id,
          },
          db,
        );
        applyActionOutcome(actionStats, action.action, outcome);
      }
    } else if (actions.length > 0 && !task.assigneeAgentId) {
      actionStats.failed += actions.length;
      actionStats.errors.push(
        `Skipped ${actions.length} mc-action block(s): task has no assignee_agent_id to attribute execution to`,
      );
    }

    const trimmedPlain = plainText.trim();
    const bodyForComment = trimmedPlain.length > 0
      ? eventBody(event.role, trimmedPlain)
      : actions.length > 0
        ? eventBody(
            event.role,
            `Delivered ${actions.length} mc-action block${actions.length === 1 ? "" : "s"} (no narrative text).`,
          )
        : eventBody(event.role, event.body);

    createTaskComment({
      taskId: task.id,
      type: "status_update",
      authorUserId: OPENCLAW_SYSTEM_ACTOR,
      source: OPENCLAW_COMMENT_SOURCE,
      externalRef: event.id,
      createdAt: event.createdAt,
      body: bodyForComment,
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

  if (parsed.terminal) {
    reconcileTerminalOpenClawTaskState(task.id, db);
  }

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
    actions: actionStats,
    transition,
    task: updatedTask,
  };
}

function applyActionOutcome(
  stats: {
    found: number;
    executed: number;
    skippedDuplicates: number;
    failed: number;
    tasksCreated: string[];
    approvalsCreated: string[];
    errors: string[];
  },
  actionType: string,
  outcome: McActionExecutionOutcome,
): void {
  switch (outcome.kind) {
    case "created_task":
      stats.executed += 1;
      stats.tasksCreated.push(outcome.taskId);
      break;
    case "created_approval":
      stats.executed += 1;
      stats.approvalsCreated.push(outcome.approvalId);
      break;
    case "reported":
    case "updated_task":
    case "added_comment":
      stats.executed += 1;
      break;
    case "skipped_duplicate":
      stats.skippedDuplicates += 1;
      break;
    case "failed":
      stats.failed += 1;
      stats.errors.push(`${actionType}: ${outcome.reason}`);
      break;
  }
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
  const route = resolveExecutionRoute({ companyId: task.companyId, task }, db);
  const executionProvider = executionProviderForTask(task, db);
  const mode = executionProvider;

  if (route.executionEngine === "manual") {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: "manual_execution_engine",
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

  const assigneeSkipReason = pausedAssigneeSkipReason(task.assigneeAgentStatus);
  if (assigneeSkipReason) {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: assigneeSkipReason,
    };
  }

  if (executionProvider === "manual") {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: "manual_runtime",
    };
  }

  if (!canAutonomouslyExecuteCompany(task.companyId, db)) {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: "dev_autonomous_test_mode_disabled",
    };
  }

  if (executionProvider === "openclaw" && !task.assigneeOpenclawAgentId) {
    return {
      taskId: task.id,
      mode: "openclaw",
      queued: false,
      status: "skipped",
      reason: "openclaw_agent_mapping_missing",
    };
  }

  if (isExecutionRunProvider(executionProvider)) {
    const runnerProvider = route.primary.runtimeProvider;
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
          executionEngine: route.executionEngine,
          modelLane: route.laneId,
          executionMode: task.executionMode,
          executionProvider,
          runnerProvider,
          runnerModel: route.primary.model,
          activeHiveId: route.activeHiveId,
          activeHiveName: route.activeHiveName,
        },
        idempotencyKey: input.idempotencyKey,
      },
      db
    );

    return {
      taskId: task.id,
      mode,
      queued: true,
      status: wake.status === "coalesced" ? "queued" : wake.status,
      runId: wake.heartbeatRunId || undefined,
      reason: wake.status === "coalesced" ? "idempotency_key_reused" : input.reason,
    };
  }

  return {
    taskId: task.id,
    mode: "manual",
    queued: false,
    status: "skipped",
    reason: "unsupported_runtime_provider",
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
  let task = getTaskBridgeRecord(input.taskId, db);
  let route = resolveExecutionRoute({ companyId: task.companyId, task }, db);
  let executionProvider = executionProviderForTask(task, db);
  const mode = executionProvider;
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;

  if (route.executionEngine === "manual") {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: "manual_execution_engine",
    };
  }

  if (executionProvider === "openclaw") {
    reconcileTerminalOpenClawTaskState(task.id, db);
    task = getTaskBridgeRecord(input.taskId, db);
    route = resolveExecutionRoute({ companyId: task.companyId, task }, db);
    executionProvider = executionProviderForTask(task, db);
  }

  if (task.status !== "in_progress" && task.status !== "review") {
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

  const assigneeSkipReason = pausedAssigneeSkipReason(task.assigneeAgentStatus);
  if (assigneeSkipReason) {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: assigneeSkipReason,
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
        runId: executionRunIdFromUsage(existingIdempotentRun),
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

  if (executionProvider === "manual") {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: "manual_runtime",
    };
  }

  if (!canAutonomouslyExecuteCompany(task.companyId, db)) {
    return {
      taskId: task.id,
      mode,
      queued: false,
      status: "skipped",
      reason: "dev_autonomous_test_mode_disabled",
    };
  }

  if (executionProvider === "openclaw" && !task.assigneeOpenclawAgentId) {
    return {
      taskId: task.id,
      mode: "openclaw",
      queued: false,
      status: "skipped",
      reason: "openclaw_agent_mapping_missing",
    };
  }

  if (isExecutionRunProvider(executionProvider)) {
    const runnerProvider = route.primary.runtimeProvider;
    const { run, reused } = createExecutionRunWithIdempotencyRecovery(
      {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        provider: executionProvider,
        executionEngine: route.executionEngine,
        runnerProvider,
        runnerModel: route.primary.model,
        modelLane: route.laneId,
        status: "pending",
        idempotencyKey: normalizedIdempotencyKey,
      },
      db
    );

    if (reused) {
      return {
        taskId: run.taskId ?? task.id,
        mode: run.provider,
        queued: run.status === "pending" || run.status === "running",
        status: mapRunToTriggerStatus(run),
        sessionId: run.sessionId,
        runId: executionRunIdFromUsage(run),
        reason: "idempotency_key_reused",
      };
    }

    // Route execution through the engine tick pipeline. The execution engine
    // chooses orchestration; the assigned agent profile chooses runner/model.
    const wake = enqueueWakeup(
      {
        agentId: task.assigneeAgentId,
        companyId: task.companyId,
        source: "issue_assigned",
        reason: input.reason ?? "task_created_in_progress",
        payload: {
          taskId: task.id,
          taskStatus: task.status,
          assigneeAgentId: task.assigneeAgentId,
          executionEngine: route.executionEngine,
          modelLane: route.laneId,
          executionRunId: run.id,
          executionProvider,
          runnerProvider,
          runnerModel: route.primary.model,
          activeHiveId: route.activeHiveId,
          activeHiveName: route.activeHiveName,
        },
        idempotencyKey: normalizedIdempotencyKey,
      },
      db
    );

    return {
      taskId: task.id,
      mode,
      queued: true,
      status: wake.status === "coalesced" ? "queued" : wake.status,
      runId: wake.heartbeatRunId || undefined,
      reason: wake.status === "coalesced"
        ? "idempotency_key_reused"
        : (input.reason ?? "task_created_in_progress"),
    };
  }

  return {
    taskId: task.id,
    mode: "manual",
    queued: false,
    status: "skipped",
    reason: "unsupported_runtime_provider",
  };
}

export async function cancelTaskExecution(input: {
  taskId: string;
  actorUserId?: string;
  note?: string;
  targetStatus?: "to-do" | "in-progress";
}): Promise<CancelTaskExecutionResult> {
  const db = getOrchestrationDb();
  const task = getTaskBridgeRecord(input.taskId, db);
  const current = getTask(task.id).task;
  const targetStatus = input.targetStatus ?? "to-do";
  const executionProvider = executionProviderForTask(task, db);
  const run = getLatestExecutionRunForTask(
    task.id,
    {
      statuses: ["pending", "running"],
    },
    db
  ) ?? getLatestExecutionRunForTask(task.id, undefined, db);
  const mode = run?.provider ?? executionProvider;

  if (!run) {
    const reason = executionProvider === "manual"
      ? "manual_runtime"
      : "execution_run_missing";
    return {
      taskId: task.id,
      mode,
      cancelled: {
        attempted: false,
        acknowledged: false,
        status: "skipped",
        reason,
      },
      transition: {
        attempted: false,
        from: current.status,
        to: current.status,
        changed: false,
        skipped: true,
        skipReason: reason,
      },
      task: current,
    };
  }

  if (run.status !== "pending" && run.status !== "running") {
    const reason = "execution_run_already_terminal";
    return {
      taskId: task.id,
      mode,
      sessionId: run.sessionId,
      cancelled: {
        attempted: false,
        acknowledged: false,
        status: "skipped",
        reason,
      },
      transition: {
        attempted: false,
        from: current.status,
        to: current.status,
        changed: false,
        skipped: true,
        skipReason: reason,
      },
      task: current,
    };
  }

  if (current.status !== "in-progress") {
    const reason = "task_not_in_progress";
    return {
      taskId: task.id,
      mode,
      sessionId: run.sessionId,
      cancelled: {
        attempted: false,
        acknowledged: false,
        status: "skipped",
        reason,
      },
      transition: {
        attempted: false,
        from: current.status,
        to: current.status,
        changed: false,
        skipped: true,
        skipReason: reason,
      },
      task: current,
    };
  }

  const adapter = getExecutionAdapter(run.provider);
  const cancellation = adapter.cancel
    ? await adapter.cancel(run.id, run.processPid ?? null, run.sessionId ?? null)
    : {
        killed: false,
        method: "no-op:adapter-cancel-missing",
      };
  const cancellationAcknowledged = !cancellation.error;
  const actorUserId = input.actorUserId?.trim() || "hiverunner:execution-cancel";
  const cancellationRef = `execution:run:${run.id}:cancelled`;

  const commentLines = [
    `${providerDisplayName(run.provider)} cancellation requested by HiveRunner for run \`${run.id}\`.`,
    "",
    cancellationAcknowledged
      ? cancellation.method.startsWith("gateway:")
        ? "Gateway acknowledged cancellation."
        : `Cancellation path completed via \`${cancellation.method}\`.`
      : `Cancellation was not acknowledged via \`${cancellation.method}\`.`,
  ];
  if (cancellation.error) {
    commentLines.push("", `Error: ${cancellation.error}`);
  }
  if (input.note?.trim()) {
    commentLines.push("", `Note: ${input.note.trim()}`);
  }
  if (cancellationAcknowledged && targetStatus === "to-do") {
    commentLines.push("", "Task moved to To-Do for reassignment.");
  } else if (cancellationAcknowledged) {
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

  if (cancellationAcknowledged) {
    const completedAt = new Date().toISOString();
    updateExecutionRun(
      run.id,
      {
        status: "cancelled",
        completedAt,
        failureClass: "cancelled",
        clearProcessPid: true,
        durationMs: run.startedAt
          ? Math.max(0, Date.parse(completedAt) - Date.parse(run.startedAt))
          : undefined,
      },
      db
    );
    cancelLinkedHeartbeatRun(run, completedAt, db);

    cleanupRunArtifacts(run.id).catch(() => {});

    if (task.executionMode === "openclaw" || run.provider === "openclaw") {
      setTaskExecutionMode({
        taskId: task.id,
        mode: "openclaw",
        executionSessionId: null,
      });
    }

    if (targetStatus === "to-do") {
      const moved = moveTask({
        taskId: task.id,
        status: "to-do",
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
    mode,
    sessionId: run.sessionId,
    cancelled: {
      attempted: true,
      acknowledged: cancellationAcknowledged,
      status: cancellationAcknowledged ? "cancelled" : "skipped",
      reason: cancellationAcknowledged ? undefined : "cancellation_not_acknowledged",
      raw: JSON.stringify(cancellation),
    },
    transition,
    task: updatedTask,
  };
}
