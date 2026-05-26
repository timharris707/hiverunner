import type Database from "better-sqlite3";

import { emitHarnessWarningComment } from "@/lib/orchestration/engine/harness-warning";
import { PUBLIC_HUMAN_LABEL } from "@/lib/public-identity";
import { getTaskRefForActionKey, mergeExecutionRunMetadata, parseJson, resetNoopCounterForActionTask } from "@/lib/orchestration/engine/persistence";
import {
  buildMemoryUtilizationMatchedUseMetadataPatch,
  type MemoryUtilizationMatchedUseOutputDocument,
} from "@/lib/orchestration/memory-utilization-receipts";
import {
  EMPTY_ASSISTANT_OUTPUT_ERROR,
  SWEEP_UNASSIGNED_NO_ACTION_ERROR,
  SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX,
  type ActionResults,
} from "@/lib/orchestration/engine/run-continuation";
import {
  actionFingerprint,
  autoStartUnblockedDependentTasks,
  closureDeferralMessage,
  executeMcAction,
  emitRunEvent,
  enqueueHireOnlyDelegationContinuation,
  focusedTaskClosureDeferralReason,
  getActionTarget,
  importCommentOnTask,
  parseActionsFromText,
  shouldDeferDependentAutoStartForAction,
  type ExecuteMcActionInput,
  type McAction,
  type McActionExecutionOutcome,
} from "@/lib/orchestration/engine/action-dispatcher";

const NO_REPLY_SENTINEL = "NO_REPLY";

type AssistantTextImportInput = {
  assistantTexts: string[];
  agentId: string;
  agentName: string;
  companyId: string;
  taskKey: string;
  wakeReason?: string;
  runId: string;
  executionRunId?: string | null;
  db: Database.Database;
  source?: string;
  telemetry?: Record<string, unknown>;
};

function emptyActionResults(): ActionResults {
  return {
    messagesImported: 0,
    actionsFound: 0,
    actionsExecuted: 0,
    actionsSkippedDedup: 0,
    actionsDeferred: 0,
    tasksCreated: [],
    approvalsCreated: [],
    reportsImported: 0,
    errors: [],
  };
}

function adapterAssistantTexts(usage: Record<string, unknown> | null | undefined): string[] {
  const texts: string[] = [];
  for (const key of ["resultText", "assistantSummary"]) {
    const value = usage?.[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed && !texts.includes(trimmed)) texts.push(trimmed);
  }
  return texts;
}

export function adapterActionTexts(usage: Record<string, unknown> | null | undefined): string[] {
  const texts = adapterAssistantTexts(usage);
  for (const key of ["stdoutTail", "stderrTail"]) {
    const value = usage?.[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.includes("```mc-action") && !texts.includes(trimmed)) {
      texts.push(trimmed);
    }
  }
  return texts;
}

function isNoReplyPlainText(text: string): boolean {
  return text.trim().toUpperCase() === NO_REPLY_SENTINEL;
}

function isUnassignedTriageWake(wakeReason: unknown): boolean {
  return String(wakeReason ?? "").trim().toLowerCase() === "sweep_unassigned_to_ceo";
}

function formatParseErrorHarnessWarning(input: {
  agentName: string;
  runId: string;
  parseErrors: string[];
}): string {
  const count = input.parseErrors.length;
  const errors = input.parseErrors
    .map((error) => {
      const positionMatch = error.match(/\bposition\s+\d+\b/i);
      const positionSuffix = positionMatch ? ` (${positionMatch[0]})` : "";
      return `- "${error}"${positionSuffix}`;
    })
    .join("\n");

  return [
    `[HARNESS_WARNING] Agent ${input.agentName} emitted ${count} mc-action block${count === 1 ? "" : "s"} that failed to parse during run ${input.runId}. Most often caused by an unescaped quote, backtick, or newline inside a multi-line \`body\` string.`,
    "",
    "Errors:",
    errors,
    "",
    "The agent's intended actions were dropped. Re-emit with shorter / less-escaped content.",
  ].join("\n");
}

function emitParseErrorHarnessWarning(input: {
  db: Database.Database;
  taskKey: string;
  agentId: string;
  agentName: string;
  runId: string;
  parseErrors: string[];
  results: ActionResults;
}): void {
  if (input.parseErrors.length === 0) return;
  input.results.hadDroppedActions = true;
  try {
    emitHarnessWarningComment({
      db: input.db,
      taskId: input.taskKey,
      agentId: input.agentId,
      runId: input.runId,
      severity: "warning",
      body: formatParseErrorHarnessWarning({
        agentName: input.agentName,
        runId: input.runId,
        parseErrors: input.parseErrors,
      }),
    });
  } catch (err) {
    input.results.errors.push(`Harness parse warning comment failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const stored = input.db
      .prepare("SELECT result_json FROM heartbeat_runs WHERE id = ? LIMIT 1")
      .get(input.runId) as { result_json: string | null } | undefined;
    const current = stored?.result_json ? JSON.parse(stored.result_json) as Record<string, unknown> : {};
    input.db.prepare("UPDATE heartbeat_runs SET result_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify({ ...current, hadDroppedActions: true }),
      new Date().toISOString(),
      input.runId,
    );
  } catch {
    // The final run-result write also carries hadDroppedActions; this early
    // update is best-effort for tests and live surfaces that read immediately.
  }
}

function validateSweepUnassignedActionScope(
  action: McAction,
  focusedTaskId: string,
  db: Database.Database,
): string | null {
  if (action.action === "update_task") {
    if (!action.taskKey) {
      return `${SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX} update_task requires taskKey for unassigned triage wake.`;
    }

    const targetTask = getTaskRefForActionKey(db, action.taskKey);
    if (!targetTask || targetTask.id !== focusedTaskId) {
      return `${SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX} update_task on unassigned triage must target the current task.`;
    }

    const requestedStatus = action.status?.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!action.assignee && !requestedStatus) {
      return `${SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX} update_task must include assignee or status during unassigned triage.`;
    }
    if (requestedStatus && requestedStatus !== "backlog") {
      return `${SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX} update_task status is limited to backlog in unassigned triage wake.`;
    }
    return null;
  }

  if (action.action === "hire_agent") {
    return null;
  }

  return `${SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX} action '${action.action}' is not allowed in unassigned triage wake.`;
}

function outputDocumentsForMatchedMemoryUse(input: {
  plainTexts: string[];
  actions: McAction[];
}): MemoryUtilizationMatchedUseOutputDocument[] {
  const outputs: MemoryUtilizationMatchedUseOutputDocument[] = [];
  input.plainTexts.forEach((text, index) => {
    outputs.push({
      id: `assistant-plain-text-${index + 1}`,
      kind: "assistant_plain_text",
      text,
    });
  });

  input.actions.forEach((action, index) => {
    if (action.action === "add_comment") {
      outputs.push({
        id: `action-${index + 1}-add-comment`,
        kind: "task_comment",
        text: action.body,
      });
    } else if (action.action === "report") {
      outputs.push({
        id: `action-${index + 1}-report`,
        kind: "task_report",
        text: action.summary,
      });
    } else if (action.action === "update_task" && action.comment) {
      outputs.push({
        id: `action-${index + 1}-status-comment`,
        kind: "status_comment",
        text: action.comment,
      });
    } else if (
      (action.action === "record_validation_evidence" || action.action === "record_success_evidence") &&
      action.resultText
    ) {
      outputs.push({
        id: `action-${index + 1}-goal-evidence`,
        kind: "goal_evidence",
        text: action.resultText,
      });
    } else if (action.action === "mark_goal_complete") {
      outputs.push({
        id: `action-${index + 1}-goal-completion`,
        kind: "goal_completion",
        text: action.reason,
      });
    }
  });

  return outputs;
}

function storeMatchedMemoryUseEvaluation(input: {
  executionRunId?: string | null;
  outputs: MemoryUtilizationMatchedUseOutputDocument[];
  db: Database.Database;
  results: ActionResults;
}): void {
  const executionRunId = input.executionRunId?.trim();
  if (!executionRunId) return;
  const row = input.db
    .prepare("SELECT metadata_json FROM execution_runs WHERE id = ? LIMIT 1")
    .get(executionRunId) as { metadata_json: string | null } | undefined;
  if (!row) return;

  try {
    const { patch } = buildMemoryUtilizationMatchedUseMetadataPatch({
      metadata: parseJson(row.metadata_json),
      outputs: input.outputs,
      evaluatedAt: new Date().toISOString(),
    });
    mergeExecutionRunMetadata(input.db, executionRunId, patch);
  } catch (err) {
    input.results.errors.push(`Matched memory-use evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function executeParsedMcActions(input: {
  actions: McAction[];
  results: ActionResults;
  agentId: string;
  agentName: string;
  companyId: string;
  taskKey: string;
  runId: string;
  executionRunId?: string | null;
  db: Database.Database;
  source?: string;
  telemetry?: Record<string, unknown>;
}): Promise<void> {
  const executedFingerprints = new Set<string>();
  const actionExecutionStart = Date.now();
  const perActionDetail: Array<{ action: string; target: string; status: string; durationMs: number }> = [];
  let hireOnlyDelegationContinuationQueued = false;
  const deferredDependentStarts: Array<{ taskId: string; taskKey: string }> = [];

  for (const action of input.actions) {
    const fingerprint = actionFingerprint(action);
    if (executedFingerprints.has(fingerprint)) {
      input.results.errors.push(`Duplicate action skipped: ${action.action} (${fingerprint.slice(0, 50)})`);
      continue;
    }
    executedFingerprints.add(fingerprint);

    const actionStart = Date.now();
    const actionTarget = getActionTarget(action);
    try {
      let executeInput: ExecuteMcActionInput = input;
      if (action.action === "update_task") {
        const closureDeferralReason = focusedTaskClosureDeferralReason({
          action,
          allActions: input.actions,
          focusedTaskId: input.taskKey,
          db: input.db,
        });
        if (closureDeferralReason) {
          if (closureDeferralReason === "hire_only_delegation" && !hireOnlyDelegationContinuationQueued) {
            enqueueHireOnlyDelegationContinuation({
              agentId: input.agentId,
              companyId: input.companyId,
              runId: input.runId,
              db: input.db,
            });
            hireOnlyDelegationContinuationQueued = true;
          }
          const message = closureDeferralMessage(closureDeferralReason);
          input.results.actionsDeferred++;
          perActionDetail.push({ action: action.action, target: actionTarget, status: "deferred", durationMs: Date.now() - actionStart });
          emitRunEvent(
            input.runId,
            input.agentId,
            "action_skipped",
            `Deferred ${action.taskKey} -> ${action.status}: ${message}.`,
            input.db,
          );
          continue;
        }

        executeInput = {
          ...input,
          deferDependentAutoStart: shouldDeferDependentAutoStartForAction({
            action,
            allActions: input.actions,
            focusedTaskId: input.taskKey,
            db: input.db,
          }),
        };
      }

      const outcome = await executeMcAction(action, executeInput, input.db);
      if (outcome.kind === "failed") {
        input.results.errors.push(`${action.action}: ${outcome.reason}`);
        perActionDetail.push({ action: action.action, target: actionTarget, status: "error", durationMs: Date.now() - actionStart });
        emitRunEvent(input.runId, input.agentId, "action_error", `${action.action}: ${outcome.reason}`, input.db);
        continue;
      }

      if (outcome.kind === "skipped_duplicate") {
        input.results.actionsSkippedDedup++;
        perActionDetail.push({ action: action.action, target: actionTarget, status: "skipped", durationMs: Date.now() - actionStart });
        emitRunEvent(input.runId, input.agentId, "action_skipped", `Skipped duplicate ${action.action}`, input.db);
        continue;
      }

      if (outcome.kind === "created_task") {
        input.results.tasksCreated.push(outcome.taskId);
      } else if (outcome.kind === "created_approval") {
        input.results.approvalsCreated.push(outcome.approvalId);
      } else if (outcome.kind === "reported") {
        input.results.reportsImported++;
      } else if (outcome.kind === "updated_task" && outcome.dependentAutostartDeferred && outcome.taskId && action.action === "update_task") {
        deferredDependentStarts.push({ taskId: outcome.taskId, taskKey: action.taskKey });
      } else if (
        outcome.kind === "registered_artifact" ||
        outcome.kind === "proposed_sprint_plan" ||
        outcome.kind === "proposed_goal_completion" ||
        outcome.kind === "recorded_goal_evidence"
      ) {
        resetNoopCounterForActionTask(input.db, action.action === "register_artifact" ? action.taskKey : input.taskKey);
      }

      input.results.actionsExecuted++;
      perActionDetail.push({ action: action.action, target: actionTarget, status: "executed", durationMs: Date.now() - actionStart });
      emitRunEvent(input.runId, input.agentId, "action_executed", actionExecutionSummary(action, outcome), input.db);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      input.results.errors.push(`Action ${action.action} failed: ${msg}`);
      perActionDetail.push({ action: action.action, target: actionTarget, status: "error", durationMs: Date.now() - actionStart });
      emitRunEvent(input.runId, input.agentId, "action_error", `${action.action} failed: ${msg.slice(0, 100)}`, input.db);
    }
  }

  for (const deferred of deferredDependentStarts) {
    const unblocked = autoStartUnblockedDependentTasks({
      completedTaskId: deferred.taskId,
      companyId: input.companyId,
      sourceAgentId: input.agentId,
      runId: input.runId,
      db: input.db,
    });
    if (unblocked > 0) {
      emitRunEvent(
        input.runId,
        input.agentId,
        "action_executed",
        `Queued ${unblocked} dependent task${unblocked === 1 ? "" : "s"} after sibling remediation actions for ${deferred.taskKey}.`,
        input.db,
      );
    }
  }

  if (
    input.actions.some((action) => action.action === "hire_agent") &&
    !input.actions.some((action) => action.action === "create_task") &&
    !hireOnlyDelegationContinuationQueued
  ) {
    enqueueHireOnlyDelegationContinuation({
      agentId: input.agentId,
      companyId: input.companyId,
      runId: input.runId,
      db: input.db,
    });
    input.results.errors.push("hire_agent actions executed without create_task delegation; queued continuation");
    emitRunEvent(
      input.runId,
      input.agentId,
      "action_skipped",
      "Hire-only delegation detected; queued a continuation so the CEO creates scoped worker tasks.",
      input.db,
    );
  }

  const actionExecutionMs = Date.now() - actionExecutionStart;
  (input.results as Record<string, unknown>).actionExecutionMs = actionExecutionMs;
  (input.results as Record<string, unknown>).perActionDetail = perActionDetail;
  if (input.telemetry) {
    input.telemetry.actionExecutionMs = actionExecutionMs;
  }

  emitRunEvent(
    input.runId,
    input.agentId,
    "actions_complete",
    `Done: ${input.results.actionsExecuted} executed, ${input.results.actionsSkippedDedup} skipped, ${input.results.actionsDeferred} deferred, ${input.results.errors.length} errors (${actionExecutionMs}ms)`,
    input.db,
  );

  const failedActionDetails = perActionDetail.filter((detail) => detail.status === "error");
  if (failedActionDetails.length > 0 && input.taskKey !== "__heartbeat__") {
    const failedActions = failedActionDetails.map((detail) => detail.action).join(", ");
    try {
      emitHarnessWarningComment({
        db: input.db,
        taskId: input.taskKey,
        agentId: input.agentId,
        runId: input.runId,
        severity: "warning",
        body: `[HARNESS_WARNING] Dropped ${failedActionDetails.length} mc-actions from this run due to dispatch error: ${failedActions}`,
      });
    } catch (err) {
      input.results.errors.push(`Harness warning comment failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function actionExecutionSummary(action: McAction, outcome: McActionExecutionOutcome): string {
  switch (outcome.kind) {
    case "created_task":
      return `Created task: ${action.action === "create_task" ? action.title.slice(0, 80) : outcome.taskId}`;
    case "created_approval":
      return action.action === "hire_agent"
        ? `Requested hire: ${action.name} (${action.role})`
        : `Created approval ${outcome.approvalId}`;
    case "hired_agent":
      return action.action === "hire_agent"
        ? `Hired agent: ${action.name} (${action.role})`
        : `Hired agent ${outcome.agentId}`;
    case "reported":
      return `Imported report: ${action.action === "report" ? action.summary.slice(0, 80) : "report"}`;
    case "updated_task":
      return action.action === "update_task"
        ? `Updated task ${action.taskKey}${action.status ? ` -> ${action.status}` : ""}`
        : "Updated task";
    case "added_comment":
      return `Comment on ${action.action === "add_comment" ? action.taskKey : "task"}`;
    case "recorded_skill_use":
      return action.action === "use_skill"
        ? `${outcome.inserted ? "Recorded" : "Already recorded"} skill use: ${action.skill}`
        : "Recorded skill use";
    case "recorded_memory_receipt":
      return `Recorded memory utilization receipt (${outcome.claimCount} claim${outcome.claimCount === 1 ? "" : "s"})`;
    case "reviewed_candidate":
      return action.action === "review_candidate"
        ? `Reviewed ${action.targetType} candidate ${action.targetId} -> ${action.decision}`
        : "Reviewed candidate";
    case "registered_artifact":
      return action.action === "register_artifact"
        ? `Registered artifact on ${action.taskKey} (${action.kind ?? "unknown kind"})`
        : "Registered artifact";
    case "proposed_sprint_plan":
      return `Proposed sprint plan draft ${outcome.draftId}`;
    case "proposed_goal_completion":
      return `Proposed goal completion ${outcome.draftId}`;
    case "recorded_goal_evidence":
      return action.action === "record_validation_evidence" || action.action === "record_success_evidence"
        ? `Recorded goal-contract evidence ${action.itemId}`
        : "Recorded goal-contract evidence";
    case "proposed_memory":
      return `Memory candidate ${outcome.candidateId} queued for review (routed to ${outcome.routedTo ?? PUBLIC_HUMAN_LABEL})`;
    case "skipped_duplicate":
      return `Skipped duplicate ${action.action}`;
    case "failed":
      return `${action.action}: ${outcome.reason}`;
  }
}

export async function importAssistantTextAndExecuteActions(input: AssistantTextImportInput): Promise<ActionResults> {
  return importAssistantTextsAndExecuteActions(input, {
    emptyOutputSource: input.source ?? "adapter",
    emptyOutputEventDetail: "FATAL: Adapter completed with no assistant text output.",
    messageLabel: "adapter message",
  });
}

export async function importAssistantTextsAndExecuteActions(
  input: AssistantTextImportInput,
  options: {
    emptyOutputSource?: string;
    emptyOutputEventDetail?: string;
    messageLabel?: string;
  } = {},
): Promise<ActionResults> {
  const results = emptyActionResults();

  const assistantTexts = input.assistantTexts.map((text) => text.trim()).filter(Boolean);
  if (assistantTexts.length === 0) {
    results.fatalError = EMPTY_ASSISTANT_OUTPUT_ERROR;
    results.errors.push(EMPTY_ASSISTANT_OUTPUT_ERROR);
    if (input.telemetry) {
      input.telemetry.emptyAssistantOutput = true;
      input.telemetry.emptyOutputFailure = {
        reason: EMPTY_ASSISTANT_OUTPUT_ERROR,
        source: options.emptyOutputSource ?? input.source ?? "adapter",
      };
    }
    emitRunEvent(
      input.runId,
      input.agentId,
      "error",
      options.emptyOutputEventDetail ?? "FATAL: Adapter completed with no assistant text output.",
      input.db,
    );
    return results;
  }

  results.messagesImported = assistantTexts.length;

  const allActions: McAction[] = [];
  const allPlainText: string[] = [];
  const allParseErrors: string[] = [];
  let noReplySentinelsSkipped = 0;
  const isUnassignedTriage = isUnassignedTriageWake(input.wakeReason);

  for (const text of assistantTexts) {
    const { actions, plainText, parseErrors } = parseActionsFromText(text);
    for (const action of actions) {
      if (isUnassignedTriage) {
        const violation = validateSweepUnassignedActionScope(action, input.taskKey, input.db);
        if (violation) {
          results.errors.push(violation);
          continue;
        }
      }
      allActions.push(action);
    }
    const trimmedPlainText = plainText.trim();
    if (trimmedPlainText) {
      if (isNoReplyPlainText(trimmedPlainText)) {
        noReplySentinelsSkipped += 1;
      } else {
        allPlainText.push(trimmedPlainText);
      }
    }
    results.errors.push(...parseErrors);
    allParseErrors.push(...parseErrors);
  }

  emitParseErrorHarnessWarning({
    db: input.db,
    taskKey: input.taskKey,
    agentId: input.agentId,
    agentName: input.agentName,
    runId: input.runId,
    parseErrors: allParseErrors,
    results,
  });

  results.actionsFound = allActions.length;
  const totalAssistantChars = assistantTexts.reduce((sum, text) => sum + text.length, 0);
  (results as Record<string, unknown>).assistantTextLength = totalAssistantChars;
  (results as Record<string, unknown>).plainTextLength = allPlainText.reduce((sum, text) => sum + text.length, 0);

  if (isUnassignedTriage && allActions.length === 0) {
    results.errors.push(SWEEP_UNASSIGNED_NO_ACTION_ERROR);
  }

  const messageLabel = options.messageLabel ?? "adapter message";
  emitRunEvent(
    input.runId,
    input.agentId,
    "parsing_complete",
    `Parsed ${assistantTexts.length} ${messageLabel}${assistantTexts.length !== 1 ? "s" : ""}, found ${allActions.length} action${allActions.length !== 1 ? "s" : ""} (${totalAssistantChars} chars)`,
    input.db,
  );

  if (noReplySentinelsSkipped > 0) {
    (results as Record<string, unknown>).noReplySentinelsSkipped = noReplySentinelsSkipped;
    emitRunEvent(
      input.runId,
      input.agentId,
      "action_skipped",
      `Skipped ${noReplySentinelsSkipped} ${NO_REPLY_SENTINEL} sentinel${noReplySentinelsSkipped === 1 ? "" : "s"} from report import`,
      input.db,
    );
  }

  if (!isUnassignedTriage && allPlainText.length > 0 && allActions.length === 0) {
    try {
      const reportBody = allPlainText.join("\n\n---\n\n").slice(0, 9000);
      importCommentOnTask(input.taskKey, input.agentId, reportBody, "status_update", input.runId, input.db, input.source);
      results.reportsImported++;
    } catch (err) {
      results.errors.push(`Plain text import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await executeParsedMcActions({ actions: allActions, results, ...input });
  storeMatchedMemoryUseEvaluation({
    executionRunId: input.executionRunId,
    outputs: outputDocumentsForMatchedMemoryUse({ plainTexts: allPlainText, actions: allActions }),
    db: input.db,
    results,
  });

  return results;
}
