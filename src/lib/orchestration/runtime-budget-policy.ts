import { createHash } from "crypto";
import type Database from "better-sqlite3";

import { createApproval } from "@/lib/orchestration/service/approval";

export type RuntimeBudgetAction = "continue" | "ask_operator" | "stop_queue";

export type RuntimeBudgetPolicy = {
  enabled: boolean;
  action: RuntimeBudgetAction;
  windowHours: number;
  maxFreshInputTokens: number | null;
  maxTotalTokens: number | null;
  maxCostCents: number | null;
  maxPromptEstimatedTokens: number | null;
};

export type RuntimeBudgetExceededThreshold = {
  metric: "fresh_input_tokens" | "total_tokens" | "cost_cents" | "prompt_estimated_tokens";
  actual: number;
  limit: number;
};

export type RuntimeBudgetAdmission =
  | {
      allowed: true;
      policy: RuntimeBudgetPolicy;
      totals: RuntimeBudgetWindowTotals;
      exceeded: [];
      approvalId: string | null;
      message: null;
    }
  | {
      allowed: false;
      policy: RuntimeBudgetPolicy;
      totals: RuntimeBudgetWindowTotals;
      exceeded: RuntimeBudgetExceededThreshold[];
      approvalId: string | null;
      message: string;
    };

export type RuntimeBudgetAdmissionInput = {
  db: Database.Database;
  companyId: string;
  agentId?: string | null;
  taskId?: string | null;
  heartbeatRunId?: string | null;
  provider?: string | null;
  model?: string | null;
  laneKey?: string | null;
  promptEstimatedTokens?: number | null;
  now?: string;
};

export type RuntimeBudgetWindowTotals = {
  freshInputTokens: number;
  totalTokens: number;
  costCents: number;
  windowStartedAt: string;
};

const DEFAULT_POLICY: RuntimeBudgetPolicy = {
  enabled: false,
  action: "continue",
  windowHours: 24,
  maxFreshInputTokens: null,
  maxTotalTokens: null,
  maxCostCents: null,
  maxPromptEstimatedTokens: null,
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nonNegativeLimit(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

function normalizeAction(value: unknown): RuntimeBudgetAction {
  if (value === "ask_operator" || value === "ask" || value === "approval_required") return "ask_operator";
  if (value === "stop_queue" || value === "stop") return "stop_queue";
  return "continue";
}

function companySettingsJsonColumnExists(db: Database.Database): boolean {
  return (db.prepare("PRAGMA table_info(companies)").all() as Array<{ name: string }>)
    .some((column) => column.name === "settings_json");
}

export function normalizeRuntimeBudgetPolicy(settings: Record<string, unknown>): RuntimeBudgetPolicy {
  const governance = asRecord(settings.governance);
  const runtime = asRecord(governance.runtime);
  const budget = asRecord(runtime.budgetThresholds ?? runtime.budget);
  const maxFreshInputTokens = nonNegativeLimit(
    budget.maxFreshInputTokens ?? budget.max_fresh_input_tokens ?? budget.freshInputTokens,
  );
  const maxTotalTokens = nonNegativeLimit(
    budget.maxTotalTokens ?? budget.max_total_tokens ?? budget.totalTokens,
  );
  const maxCostCents = nonNegativeLimit(
    budget.maxCostCents ?? budget.max_cost_cents ?? budget.costCents,
  );
  const maxPromptEstimatedTokens = nonNegativeLimit(
    budget.maxPromptEstimatedTokens ??
      budget.max_prompt_estimated_tokens ??
      budget.maxPromptTokens ??
      budget.max_prompt_tokens,
  );
  const windowHours = finiteNumber(budget.windowHours ?? budget.window_hours);
  const hasThreshold =
    maxFreshInputTokens !== null ||
    maxTotalTokens !== null ||
    maxCostCents !== null ||
    maxPromptEstimatedTokens !== null;

  return {
    enabled: typeof budget.enabled === "boolean" ? budget.enabled : hasThreshold,
    action: normalizeAction(budget.action ?? budget.mode ?? budget.exceededAction),
    windowHours: windowHours !== null && windowHours > 0 ? windowHours : DEFAULT_POLICY.windowHours,
    maxFreshInputTokens,
    maxTotalTokens,
    maxCostCents,
    maxPromptEstimatedTokens,
  };
}

function loadCompanyRuntimeBudgetPolicy(db: Database.Database, companyId: string): RuntimeBudgetPolicy {
  if (!companySettingsJsonColumnExists(db)) return DEFAULT_POLICY;
  const row = db
    .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
    .get(companyId) as { settings_json: string | null } | undefined;
  return row ? normalizeRuntimeBudgetPolicy(parseJsonRecord(row.settings_json)) : DEFAULT_POLICY;
}

function runtimeUsageLedgerExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_usage_ledger'")
    .get() as { name: string } | undefined;
  return row?.name === "runtime_usage_ledger";
}

function windowStart(now: string, hours: number): string {
  const nowMs = new Date(now).getTime();
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(safeNow - hours * 60 * 60 * 1000).toISOString();
}

function loadWindowTotals(
  db: Database.Database,
  companyId: string,
  policy: RuntimeBudgetPolicy,
  now: string,
): RuntimeBudgetWindowTotals {
  const windowStartedAt = windowStart(now, policy.windowHours);
  if (!runtimeUsageLedgerExists(db)) {
    return { freshInputTokens: 0, totalTokens: 0, costCents: 0, windowStartedAt };
  }
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(fresh_input_tokens), 0) AS fresh_input_tokens,
         COALESCE(SUM(total_tokens), 0) AS total_tokens,
         COALESCE(SUM(cost_cents), 0) AS cost_cents
       FROM runtime_usage_ledger
       WHERE company_id = ?
         AND occurred_at >= ?`,
    )
    .get(companyId, windowStartedAt) as {
      fresh_input_tokens: number;
      total_tokens: number;
      cost_cents: number;
    };
  return {
    freshInputTokens: Number(row.fresh_input_tokens) || 0,
    totalTokens: Number(row.total_tokens) || 0,
    costCents: Number(row.cost_cents) || 0,
    windowStartedAt,
  };
}

function exceededThresholds(
  policy: RuntimeBudgetPolicy,
  totals: RuntimeBudgetWindowTotals,
  input: RuntimeBudgetAdmissionInput,
): RuntimeBudgetExceededThreshold[] {
  const exceeded: RuntimeBudgetExceededThreshold[] = [];
  if (policy.maxFreshInputTokens !== null && totals.freshInputTokens >= policy.maxFreshInputTokens) {
    exceeded.push({ metric: "fresh_input_tokens", actual: totals.freshInputTokens, limit: policy.maxFreshInputTokens });
  }
  if (policy.maxTotalTokens !== null && totals.totalTokens >= policy.maxTotalTokens) {
    exceeded.push({ metric: "total_tokens", actual: totals.totalTokens, limit: policy.maxTotalTokens });
  }
  if (policy.maxCostCents !== null && totals.costCents >= policy.maxCostCents) {
    exceeded.push({ metric: "cost_cents", actual: totals.costCents, limit: policy.maxCostCents });
  }
  const promptEstimatedTokens =
    typeof input.promptEstimatedTokens === "number" && Number.isFinite(input.promptEstimatedTokens)
      ? Math.max(0, Math.round(input.promptEstimatedTokens))
      : null;
  if (
    policy.maxPromptEstimatedTokens !== null &&
    promptEstimatedTokens !== null &&
    promptEstimatedTokens >= policy.maxPromptEstimatedTokens
  ) {
    exceeded.push({
      metric: "prompt_estimated_tokens",
      actual: promptEstimatedTokens,
      limit: policy.maxPromptEstimatedTokens,
    });
  }
  return exceeded;
}

function fingerprint(input: RuntimeBudgetAdmissionInput, policy: RuntimeBudgetPolicy, exceeded: RuntimeBudgetExceededThreshold[]): string {
  return createHash("sha256")
    .update(JSON.stringify({
      companyId: input.companyId,
      taskId: input.taskId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      laneKey: input.laneKey ?? null,
      policy,
      exceeded: exceeded.map((item) => item.metric).sort(),
    }))
    .digest("hex");
}

function findExistingBudgetApproval(
  db: Database.Database,
  input: RuntimeBudgetAdmissionInput,
  budgetFingerprint: string,
): { id: string; status: string } | null {
  if (!input.taskId || input.taskId === "__heartbeat__") return null;
  const row = db
    .prepare(
      `SELECT id, status
       FROM approvals
       WHERE company_id = ?
         AND type = 'budget_override_required'
         AND linked_task_id = ?
         AND json_extract(payload_json, '$.fingerprint') = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(input.companyId, input.taskId, budgetFingerprint) as { id: string; status: string } | undefined;
  return row ?? null;
}

function budgetMessage(policy: RuntimeBudgetPolicy, totals: RuntimeBudgetWindowTotals, exceeded: RuntimeBudgetExceededThreshold[]): string {
  const details = exceeded
    .map((item) => `${item.metric} ${item.actual}/${item.limit}`)
    .join(", ");
  return `Runtime budget threshold exceeded over ${policy.windowHours}h window (${details}). Window starts ${totals.windowStartedAt}.`;
}

export function evaluateRuntimeBudgetAdmission(input: RuntimeBudgetAdmissionInput): RuntimeBudgetAdmission {
  const now = input.now ?? new Date().toISOString();
  const policy = loadCompanyRuntimeBudgetPolicy(input.db, input.companyId);
  const totals = loadWindowTotals(input.db, input.companyId, policy, now);
  if (!policy.enabled || policy.action === "continue") {
    return { allowed: true, policy, totals, exceeded: [], approvalId: null, message: null };
  }
  const exceeded = exceededThresholds(policy, totals, input);
  if (exceeded.length === 0) {
    return { allowed: true, policy, totals, exceeded: [], approvalId: null, message: null };
  }

  const message = budgetMessage(policy, totals, exceeded);
  if (policy.action === "stop_queue") {
    return { allowed: false, policy, totals, exceeded, approvalId: null, message };
  }

  const budgetFingerprint = fingerprint(input, policy, exceeded);
  const existing = findExistingBudgetApproval(input.db, input, budgetFingerprint);
  if (existing?.status === "approved") {
    return { allowed: true, policy, totals, exceeded: [], approvalId: existing.id, message: null };
  }
  if (existing && (existing.status === "pending" || existing.status === "revision_requested")) {
    return { allowed: false, policy, totals, exceeded, approvalId: existing.id, message };
  }

  const { approval } = createApproval({
    companyIdOrSlug: input.companyId,
    type: "budget_override_required",
    requestedByAgentId: input.agentId ?? undefined,
    linkedTaskId: input.taskId && input.taskId !== "__heartbeat__" ? input.taskId : undefined,
    db: input.db,
    payload: {
      fingerprint: budgetFingerprint,
      summary: "Runtime budget override required",
      reason: message,
      provider: input.provider ?? null,
      model: input.model ?? null,
      laneKey: input.laneKey ?? null,
      heartbeatRunId: input.heartbeatRunId ?? null,
      policy,
      totals,
      exceeded,
    },
  });
  return { allowed: false, policy, totals, exceeded, approvalId: approval.id, message };
}
