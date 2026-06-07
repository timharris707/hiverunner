import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";

import type { McAction } from "@/lib/orchestration/engine/action-dispatcher";

export type RuntimeActionLedgerSource = "heartbeat_import" | "legacy_execution_poll" | "overseer" | "manual";
export type RuntimeActionLedgerStatus =
  | "parsed"
  | "parse_failed"
  | "observed"
  | "pending_approval"
  | "executed"
  | "deferred"
  | "failed"
  | "skipped_duplicate";

export type RuntimeActionLedgerInput = {
  source: RuntimeActionLedgerSource;
  status: RuntimeActionLedgerStatus;
  idempotencyKey?: string;
  companyId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  taskKey?: string | null;
  heartbeatRunId?: string | null;
  executionRunId?: string | null;
  overseerSessionId?: string | null;
  overseerTurnId?: string | null;
  overseerMessageId?: string | null;
  approvalId?: string | null;
  messageIndex?: number | null;
  blockIndex?: number | null;
  action?: McAction | null;
  actionType?: string | null;
  actionTarget?: string | null;
  statusReason?: string | null;
  parseError?: string | null;
  rawBlock?: string | null;
  outcome?: Record<string, unknown> | null;
  durationMs?: number | null;
};

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cleanText(value: string | null | undefined, maxLength: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function nonNegativeInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function inferActionTarget(action: McAction | null | undefined): string | null {
  if (!action) return null;
  const record = action as Record<string, unknown>;
  for (const key of ["taskKey", "taskId", "companyGoalId", "itemId", "targetId", "name", "skill", "title"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  }
  return null;
}

function actionFingerprint(input: RuntimeActionLedgerInput): string {
  if (input.action) return sha256(stableJson(input.action));
  const fallback = input.rawBlock ?? input.parseError ?? input.actionType ?? randomUUID();
  return sha256(fallback);
}

function defaultIdempotencyKey(input: RuntimeActionLedgerInput, fingerprint: string): string {
  const parts = [
    input.source,
    input.companyId ?? "",
    input.agentId ?? "",
    input.taskId ?? "",
    input.taskKey ?? "",
    input.heartbeatRunId ?? "",
    input.executionRunId ?? "",
    input.overseerSessionId ?? "",
    input.overseerTurnId ?? "",
    input.overseerMessageId ?? "",
    String(input.messageIndex ?? 0),
    String(input.blockIndex ?? 0),
    fingerprint,
  ];
  return sha256(parts.join("\u001f"));
}

export function recordRuntimeActionLedgerEntry(
  db: Database.Database,
  input: RuntimeActionLedgerInput,
): string | null {
  try {
    if (!hasTable(db, "runtime_action_ledger")) return null;
    const id = randomUUID();
    const fingerprint = actionFingerprint(input);
    const idempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey(input, fingerprint);
    const now = new Date().toISOString();
    const actionJson = input.action ? stableJson(input.action) : "{}";
    const outcomeJson = stableJson(input.outcome ?? {});
    const actionType = input.actionType ?? input.action?.action ?? null;
    const actionTarget = input.actionTarget ?? inferActionTarget(input.action);

    db.prepare(
      `INSERT INTO runtime_action_ledger
         (id, idempotency_key, company_id, agent_id, task_id, task_key,
          heartbeat_run_id, execution_run_id, overseer_session_id, overseer_turn_id,
          overseer_message_id, approval_id, source, message_index, block_index,
          action_type, action_target, action_fingerprint, status, status_reason,
          parse_error, action_json, raw_block, outcome_json, duration_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO UPDATE SET
         company_id = COALESCE(excluded.company_id, runtime_action_ledger.company_id),
         agent_id = COALESCE(excluded.agent_id, runtime_action_ledger.agent_id),
         task_id = COALESCE(excluded.task_id, runtime_action_ledger.task_id),
         task_key = COALESCE(excluded.task_key, runtime_action_ledger.task_key),
         heartbeat_run_id = COALESCE(excluded.heartbeat_run_id, runtime_action_ledger.heartbeat_run_id),
         execution_run_id = COALESCE(excluded.execution_run_id, runtime_action_ledger.execution_run_id),
         overseer_session_id = COALESCE(excluded.overseer_session_id, runtime_action_ledger.overseer_session_id),
         overseer_turn_id = COALESCE(excluded.overseer_turn_id, runtime_action_ledger.overseer_turn_id),
         overseer_message_id = COALESCE(excluded.overseer_message_id, runtime_action_ledger.overseer_message_id),
         approval_id = COALESCE(excluded.approval_id, runtime_action_ledger.approval_id),
         action_type = COALESCE(excluded.action_type, runtime_action_ledger.action_type),
         action_target = COALESCE(excluded.action_target, runtime_action_ledger.action_target),
         status = excluded.status,
         status_reason = COALESCE(excluded.status_reason, runtime_action_ledger.status_reason),
         parse_error = COALESCE(excluded.parse_error, runtime_action_ledger.parse_error),
         action_json = excluded.action_json,
         raw_block = COALESCE(excluded.raw_block, runtime_action_ledger.raw_block),
         outcome_json = excluded.outcome_json,
         duration_ms = COALESCE(excluded.duration_ms, runtime_action_ledger.duration_ms),
         updated_at = excluded.updated_at`,
    ).run(
      id,
      idempotencyKey,
      input.companyId ?? null,
      input.agentId ?? null,
      input.taskId ?? null,
      input.taskKey ?? null,
      input.heartbeatRunId ?? null,
      input.executionRunId ?? null,
      input.overseerSessionId ?? null,
      input.overseerTurnId ?? null,
      input.overseerMessageId ?? null,
      input.approvalId ?? null,
      input.source,
      input.messageIndex ?? null,
      input.blockIndex ?? 0,
      cleanText(actionType, 120),
      cleanText(actionTarget, 240),
      fingerprint,
      input.status,
      cleanText(input.statusReason, 1000),
      cleanText(input.parseError, 1000),
      actionJson,
      cleanText(input.rawBlock, 8000),
      outcomeJson,
      nonNegativeInteger(input.durationMs),
      now,
      now,
    );
    return id;
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[runtime-action-ledger] failed to record action ledger entry", err);
    }
    return null;
  }
}
