import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  executeMcAction,
  type McAction,
  type McActionExecutionOutcome,
} from "@/lib/orchestration/engine/action-dispatcher";
import {
  incrementRuntimeActionLedgerReplayCount,
  requireRuntimeActionLedgerEntry,
} from "@/lib/orchestration/runtime-action-ledger";

type RuntimeActionLedgerReplayRow = {
  id: string;
  company_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  task_key: string | null;
  heartbeat_run_id: string | null;
  execution_run_id: string | null;
  action_type: string | null;
  action_target: string | null;
  action_json: string;
  raw_block: string | null;
  raw_json: string | null;
  raw_start_offset: number | null;
  raw_end_offset: number | null;
  status: string;
};

export type RuntimeActionLedgerReplayResult = {
  actionLedgerId: string;
  replayLedgerId: string;
  dryRun: boolean;
  actionType: string;
  actionTarget: string | null;
  status: "ready" | "executed" | "failed" | "pending_approval" | "skipped_duplicate";
  outcome?: McActionExecutionOutcome;
};

function parseActionJson(value: string): McAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new OrchestrationApiError(400, "invalid_action_json", error instanceof Error ? error.message : String(error));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { action?: unknown }).action !== "string") {
    throw new OrchestrationApiError(400, "action_not_replayable", "Ledger row does not contain a replayable mc-action payload.");
  }
  return parsed as McAction;
}

function replayStatusForOutcome(outcome: McActionExecutionOutcome): RuntimeActionLedgerReplayResult["status"] {
  if (outcome.kind === "created_approval") return "pending_approval";
  if (outcome.kind === "failed") return "failed";
  if (outcome.kind === "skipped_duplicate") return "skipped_duplicate";
  return "executed";
}

function ledgerStatusForOutcome(outcome: McActionExecutionOutcome): "pending_approval" | "executed" | "failed" | "skipped_duplicate" {
  if (outcome.kind === "created_approval") return "pending_approval";
  if (outcome.kind === "failed") return "failed";
  if (outcome.kind === "skipped_duplicate") return "skipped_duplicate";
  return "executed";
}

function getReplayRow(db: Database.Database, actionLedgerId: string): RuntimeActionLedgerReplayRow {
  const row = db
    .prepare(
      `SELECT id, company_id, agent_id, task_id, task_key, heartbeat_run_id, execution_run_id,
              action_type, action_target, action_json, raw_block, raw_json,
              raw_start_offset, raw_end_offset, status
       FROM runtime_action_ledger
       WHERE id = ?
       LIMIT 1`,
    )
    .get(actionLedgerId) as RuntimeActionLedgerReplayRow | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "action_ledger_not_found", "Action ledger row not found.");
  }
  return row;
}

function resolveReplayContext(db: Database.Database, row: RuntimeActionLedgerReplayRow) {
  const task = row.task_id || row.task_key
    ? db
      .prepare("SELECT id, task_key, company_id FROM tasks WHERE id = ? OR task_key = ? LIMIT 1")
      .get(row.task_id ?? "", row.task_key ?? "") as { id: string; task_key: string | null; company_id: string } | undefined
    : undefined;
  const companyId = row.company_id ?? task?.company_id ?? null;
  if (!companyId) {
    throw new OrchestrationApiError(400, "company_required", "Action ledger row cannot be replayed without a company id.");
  }
  if (!row.agent_id) {
    throw new OrchestrationApiError(400, "agent_required", "Action ledger row cannot be replayed without an agent id.");
  }
  const agent = db
    .prepare("SELECT id, name FROM agents WHERE id = ? LIMIT 1")
    .get(row.agent_id) as { id: string; name: string | null } | undefined;
  if (!agent) {
    throw new OrchestrationApiError(400, "agent_not_found", "Action ledger row references an agent that no longer exists.");
  }
  const taskKey = task?.task_key ?? row.task_key ?? task?.id ?? null;
  if (!taskKey) {
    throw new OrchestrationApiError(400, "task_required", "Action ledger row cannot be replayed without a task key.");
  }
  return {
    agentId: agent.id,
    agentName: agent.name ?? "Agent",
    companyId,
    taskId: task?.id ?? row.task_id,
    taskKey,
  };
}

export async function replayRuntimeActionLedgerEntry(
  input: { actionLedgerId: string; dryRun?: boolean },
  db: Database.Database = getOrchestrationDb(),
): Promise<RuntimeActionLedgerReplayResult> {
  const actionLedgerId = input.actionLedgerId.trim();
  if (!actionLedgerId) {
    throw new OrchestrationApiError(400, "action_ledger_id_required", "actionLedgerId is required.");
  }
  const row = getReplayRow(db, actionLedgerId);
  if (row.status === "parse_failed") {
    throw new OrchestrationApiError(400, "action_not_replayable", "Parse-failed action rows cannot be replayed.");
  }
  const action = parseActionJson(row.action_json);
  const context = resolveReplayContext(db, row);
  const idempotencyKey = `manual:replay:${row.id}:${randomUUID()}`;
  const actionType = action.action;
  const actionTarget = row.action_target ?? null;
  const replayLedgerId = requireRuntimeActionLedgerEntry(db, {
    source: "manual",
    status: input.dryRun ? "observed" : "parsed",
    idempotencyKey,
    companyId: context.companyId,
    agentId: context.agentId,
    taskId: context.taskId ?? null,
    taskKey: context.taskKey,
    action,
    actionType,
    actionTarget,
    rawBlock: row.raw_block,
    rawJson: row.raw_json,
    rawStartOffset: row.raw_start_offset,
    rawEndOffset: row.raw_end_offset,
    replayOfActionLedgerId: row.id,
    statusReason: input.dryRun ? "replay_dry_run" : "reserved_for_replay",
  });

  if (input.dryRun) {
    return {
      actionLedgerId: row.id,
      replayLedgerId,
      dryRun: true,
      actionType,
      actionTarget,
      status: "ready",
    };
  }

  const startedAt = Date.now();
  const outcome = await executeMcAction(
    action,
    {
      agentId: context.agentId,
      agentName: context.agentName,
      companyId: context.companyId,
      taskKey: context.taskKey,
      runId: `action-replay:${row.id}`,
    },
    db,
  );
  requireRuntimeActionLedgerEntry(db, {
    source: "manual",
    status: ledgerStatusForOutcome(outcome),
    idempotencyKey,
    companyId: context.companyId,
    agentId: context.agentId,
    taskId: context.taskId ?? null,
    taskKey: context.taskKey,
    action,
    actionType,
    actionTarget,
    rawBlock: row.raw_block,
    rawJson: row.raw_json,
    rawStartOffset: row.raw_start_offset,
    rawEndOffset: row.raw_end_offset,
    replayOfActionLedgerId: row.id,
    approvalId: outcome.kind === "created_approval" ? outcome.approvalId : null,
    outcome: outcome as unknown as Record<string, unknown>,
    statusReason: outcome.kind === "failed" ? outcome.reason : outcome.kind,
    durationMs: Date.now() - startedAt,
  });
  incrementRuntimeActionLedgerReplayCount(db, row.id);

  return {
    actionLedgerId: row.id,
    replayLedgerId,
    dryRun: false,
    actionType,
    actionTarget,
    status: replayStatusForOutcome(outcome),
    outcome,
  };
}
