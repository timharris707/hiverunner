import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

type RuntimeUsageLedgerSourceType = "execution_run" | "overseer_turn" | "manual";

export type RuntimeUsageLedgerInput = {
  sourceType: RuntimeUsageLedgerSourceType;
  idempotencyKey?: string;
  companyId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  executionRunId?: string | null;
  heartbeatRunId?: string | null;
  overseerTurnId?: string | null;
  provider?: string | null;
  model?: string | null;
  usage?: Record<string, unknown> | null;
  budgetSnapshot?: Record<string, unknown> | null;
  occurredAt?: string;
};

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = asFiniteNumber(record[key]);
    if (value !== null) return value;
  }
  return 0;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function normalizeCostCents(usage: Record<string, unknown>): number {
  const directCents = firstNumber(usage, ["costCents", "cost_cents", "estimatedCostCents", "estimated_cost_cents"]);
  if (directCents > 0) return directCents;
  const usd = firstNumber(usage, ["costUsd", "cost_usd", "estimatedCostUsd", "estimated_cost_usd", "cost"]);
  return usd > 0 ? usd * 100 : 0;
}

function defaultIdempotencyKey(input: RuntimeUsageLedgerInput): string {
  if (input.executionRunId) return `execution_run:${input.executionRunId}`;
  if (input.overseerTurnId) return `overseer_turn:${input.overseerTurnId}`;
  if (input.heartbeatRunId) return `heartbeat_run:${input.heartbeatRunId}:${input.sourceType}`;
  return `manual:${randomUUID()}`;
}

export function normalizedRuntimeUsageTotals(usage: Record<string, unknown> | null | undefined): {
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  freshInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
} {
  const record = usage ?? {};
  const inputTokens = nonNegativeInteger(firstNumber(record, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "totalInputTokens",
  ]));
  const cacheReadInputTokens = nonNegativeInteger(firstNumber(record, [
    "cacheReadInputTokens",
    "cache_read_input_tokens",
    "cacheReadTokens",
    "cache_read_tokens",
    "cachedInputTokens",
    "cached_input_tokens",
  ]));
  const cacheWriteInputTokens = nonNegativeInteger(firstNumber(record, [
    "cacheWriteInputTokens",
    "cache_write_input_tokens",
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
    "cacheWriteTokens",
    "cache_write_tokens",
  ]));
  const outputTokens = nonNegativeInteger(firstNumber(record, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
  ]));
  const explicitTotal = nonNegativeInteger(firstNumber(record, [
    "totalTokens",
    "total_tokens",
  ]));
  const totalTokens = explicitTotal > 0 ? explicitTotal : inputTokens + outputTokens;
  const freshInputTokens = Math.max(0, inputTokens - cacheReadInputTokens);
  const costCents = normalizeCostCents(record);

  return {
    inputTokens,
    cacheReadInputTokens,
    cacheWriteInputTokens,
    freshInputTokens,
    outputTokens,
    totalTokens,
    costCents,
  };
}

export function recordRuntimeUsageLedgerEntry(
  db: Database.Database,
  input: RuntimeUsageLedgerInput,
): string | null {
  if (!hasTable(db, "runtime_usage_ledger")) return null;
  const usage = input.usage ?? {};
  const totals = normalizedRuntimeUsageTotals(usage);
  if (
    totals.inputTokens <= 0 &&
    totals.outputTokens <= 0 &&
    totals.cacheReadInputTokens <= 0 &&
    totals.cacheWriteInputTokens <= 0 &&
    totals.costCents <= 0
  ) {
    return null;
  }

  const id = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey(input);
  db.prepare(
    `INSERT OR REPLACE INTO runtime_usage_ledger
       (id, idempotency_key, source_type, company_id, agent_id, task_id,
        execution_run_id, heartbeat_run_id, overseer_turn_id, provider, model,
        input_tokens, cache_read_input_tokens, cache_write_input_tokens,
        fresh_input_tokens, output_tokens, total_tokens, cost_cents,
        usage_json, budget_snapshot_json, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    idempotencyKey,
    input.sourceType,
    input.companyId ?? null,
    input.agentId ?? null,
    input.taskId ?? null,
    input.executionRunId ?? null,
    input.heartbeatRunId ?? null,
    input.overseerTurnId ?? null,
    input.provider ?? null,
    input.model ?? null,
    totals.inputTokens,
    totals.cacheReadInputTokens,
    totals.cacheWriteInputTokens,
    totals.freshInputTokens,
    totals.outputTokens,
    totals.totalTokens,
    totals.costCents,
    JSON.stringify(usage),
    JSON.stringify(input.budgetSnapshot ?? {}),
    input.occurredAt ?? new Date().toISOString(),
    new Date().toISOString(),
  );
  return id;
}
