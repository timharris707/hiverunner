import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { getExecutionAdapter } from "@/lib/orchestration/execution/adapters";
import { cleanupRunArtifacts } from "@/lib/orchestration/execution/cleanup";
import { reconcileTerminalOpenClawTaskState } from "@/lib/orchestration/openclaw-reconciliation";
import { recordCompanyAuditEvent } from "@/lib/orchestration/service/audit";
import { checkProtectedRuntimeExecution } from "@/lib/orchestration/service/runtime-governance";
import { persistExecutionTranscriptEvents } from "@/lib/orchestration/service/execution-transcript";
import { resolveQueuedHeartbeatClaimCompanyId } from "@/lib/orchestration/service/dev-execution-test-mode";
import { resolveExecutionRoute, executionRouteAttempts, type ResolvedExecutionRoute, type ResolvedExecutionRouteAttempt } from "@/lib/orchestration/execution-route-resolver";
import {
  recordCostEvent,
  usageTokenDeltas,
  applyUsageDeltasToTelemetry,
  ExecutionRunProvider,
} from "./cost-recorder";
export type { ExecutionRunProvider } from "./cost-recorder";
import { getHeartbeatRunTimeoutMs } from "@/lib/orchestration/execution-timeouts";
import { recordRuntimeSkillAvailabilityForRun } from "@/lib/orchestration/skill-effectiveness";
import { normalizeTaskModelLane, resolveTaskModelRouting } from "@/lib/orchestration/task-model-routing";
import { nonExecutableRuntimeReason } from "@/lib/orchestration/runtime-readiness";
import type { TaskExecutionEngine } from "@/lib/orchestration/types";
import {
  getOrCreateRuntimeState,
  getOrCreateTaskSession,
  parseJson,
  stringFromRecord,
  updateRuntimeState,
  updateTaskSession,
} from "@/lib/orchestration/engine/persistence";
import type { TaskSession } from "@/lib/orchestration/engine/persistence";
import {
  executionRunProviderForAdapter,
  normalizeCreateTaskExecutionEngine,
  taskExecutionEngineForRun,
  taskExecutionPolicyForWakeup,
  taskRouteInputForRun,
} from "@/lib/orchestration/engine/execution-router";

export { taskExecutionPolicyForWakeup };

export interface ExecuteHeartbeatResult {
  runId: string;
  agentId: string;
  status: HeartbeatRunStatus;
  sessionId: string | null;
  error: string | null;
  durationMs: number;
}

export interface ExecuteHeartbeatOptions {
  allowPreclaimedRunning?: boolean;
}

type HeartbeatRunRow = {
  id: string;
  agent_id: string;
  company_id: string;
  invocation_source: string;
  trigger_detail: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  wakeup_request_id: string | null;
  session_id_before: string | null;
  session_id_after: string | null;
  usage_json: string;
  result_json: string;
  exit_code: number | null;
  error: string | null;
  context_snapshot_json: string;
  created_at: string;
};

export type AgentRow = {
  id: string;
  name: string;
  role: string;
  personality: string;
  company_id: string;
  openclaw_agent_id: string | null;
  adapter_type: string;
  model: string | null;
  adapter_config_json: string;
  runtime_config_json: string;
  capabilities: string;
  runtime_workspace_root: string | null;
};

type HeartbeatRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

type EnqueueWakeupResult = {
  wakeupRequestId: string;
  heartbeatRunId: string;
  status: "queued" | "coalesced";
};

type ActionResults = {
  messagesImported: number;
  actionsFound: number;
  actionsExecuted: number;
  actionsSkippedDedup: number;
  actionsDeferred: number;
  tasksCreated: string[];
  approvalsCreated: string[];
  reportsImported: number;
  errors: string[];
  hadDroppedActions?: boolean;
  fatalError?: string | null;
};

type HeartbeatManagerDependencies = {
  autoFlipTaskToReviewAfterMissingEndDeclaration: (db: Database.Database, input: { taskId: string; agentId: string; runId: string; runWindowStart: string | null; now: string }) => boolean;
  autoMarkTaskInProgressForExecutionRun: (db: Database.Database, input: { taskId: string; agentId: string; runId: string; executionRunId: string }) => void;
  buildHeartbeatPrompt: (agent: AgentRow, contextSnapshot: Record<string, unknown>, session: TaskSession, db: Database.Database, executionRunId?: string | null) => string;
  checkAndTripCircuitBreaker: (input: { taskId: string; runId: string; agentId: string; runWindowStart: string; now: string }, db: Database.Database) => boolean;
  decideFinishRunContinuation: (taskId: string, runId: string, status: HeartbeatRunStatus, db: Database.Database) => { shouldContinue: boolean; reason?: string };
  enqueueWakeup: (input: { agentId: string; companyId: string; source: "timer" | "issue_assigned" | "routine" | "explicit" | "api" | "kickoff"; reason?: string; triggerDetail?: string; payload?: Record<string, unknown>; idempotencyKey?: string; invocationSource?: "on_demand" | "timer" | "issue_assigned" | "wakeup_request" | "kickoff"; contextSnapshot?: Record<string, unknown> }, db?: Database.Database) => EnqueueWakeupResult;
  importAssistantTextAndExecuteActions: (input: { assistantTexts: string[]; agentId: string; agentName: string; companyId: string; taskKey: string; wakeReason: string; runId: string; executionRunId?: string | null; db: Database.Database; source: string; telemetry: Record<string, unknown> }) => Promise<ActionResults>;
  importSessionOutputAndExecuteActions: (input: { sessionKey: string; sessionId: string; agentId: string; agentName: string; companyId: string; taskKey: string; wakeReason: string; runId: string; executionRunId?: string | null; db: Database.Database; messageCountBefore: number; telemetry: Record<string, unknown> }) => Promise<ActionResults>;
  loadStoredActionResults: (runId: string, db: Database.Database) => ActionResults | null;
  maybeEnqueueNextReadyAssignedTaskForAgent: (input: { agentId: string; companyId: string; completedTaskId: string; currentTaskStatus: string; runId: string; db: Database.Database }) => void;
  maybeResetTaskSessionForFreshAssignment: (agentId: string, companyId: string, taskKey: string, contextSnapshot: Record<string, unknown>, db: Database.Database) => void;
  moveTaskToReviewIfAwaitingApproval: (taskKey: string, agentId: string, runId: string, db: Database.Database) => void;
  getActionResultsTerminalFailure: (actionResults: ActionResults | null | undefined) => string | null;
  isInsufficientProgress: (taskId: string, actionResults: ActionResults, db: Database.Database) => boolean;
  adapterActionTexts: (usage: Record<string, unknown> | null | undefined) => string[];
  persistAdapterFailureDiagnostic: (db: Database.Database, runId: string, result: { error?: string; usage?: Record<string, unknown> | null }) => void;
};

let heartbeatManagerDependencies: HeartbeatManagerDependencies | null = null;

export function configureHeartbeatManagerDependencies(dependencies: HeartbeatManagerDependencies): void {
  heartbeatManagerDependencies = dependencies;
}

function deps(): HeartbeatManagerDependencies {
  if (!heartbeatManagerDependencies) {
    throw new Error("heartbeat_manager_dependencies_not_configured");
  }
  return heartbeatManagerDependencies;
}

function autoFlipTaskToReviewAfterMissingEndDeclaration(...args: Parameters<HeartbeatManagerDependencies["autoFlipTaskToReviewAfterMissingEndDeclaration"]>): boolean { return deps().autoFlipTaskToReviewAfterMissingEndDeclaration(...args); }
function autoMarkTaskInProgressForExecutionRun(...args: Parameters<HeartbeatManagerDependencies["autoMarkTaskInProgressForExecutionRun"]>): void { return deps().autoMarkTaskInProgressForExecutionRun(...args); }
function buildHeartbeatPrompt(...args: Parameters<HeartbeatManagerDependencies["buildHeartbeatPrompt"]>): string { return deps().buildHeartbeatPrompt(...args); }
function checkAndTripCircuitBreaker(...args: Parameters<HeartbeatManagerDependencies["checkAndTripCircuitBreaker"]>): boolean { return deps().checkAndTripCircuitBreaker(...args); }
function decideFinishRunContinuation(...args: Parameters<HeartbeatManagerDependencies["decideFinishRunContinuation"]>): { shouldContinue: boolean; reason?: string } { return deps().decideFinishRunContinuation(...args); }
function enqueueWakeup(...args: Parameters<HeartbeatManagerDependencies["enqueueWakeup"]>): EnqueueWakeupResult { return deps().enqueueWakeup(...args); }
function importAssistantTextAndExecuteActions(...args: Parameters<HeartbeatManagerDependencies["importAssistantTextAndExecuteActions"]>): Promise<ActionResults> { return deps().importAssistantTextAndExecuteActions(...args); }
function importSessionOutputAndExecuteActions(...args: Parameters<HeartbeatManagerDependencies["importSessionOutputAndExecuteActions"]>): Promise<ActionResults> { return deps().importSessionOutputAndExecuteActions(...args); }
function loadStoredActionResults(...args: Parameters<HeartbeatManagerDependencies["loadStoredActionResults"]>): ActionResults | null { return deps().loadStoredActionResults(...args); }
function maybeEnqueueNextReadyAssignedTaskForAgent(...args: Parameters<HeartbeatManagerDependencies["maybeEnqueueNextReadyAssignedTaskForAgent"]>): void { return deps().maybeEnqueueNextReadyAssignedTaskForAgent(...args); }
function maybeResetTaskSessionForFreshAssignment(...args: Parameters<HeartbeatManagerDependencies["maybeResetTaskSessionForFreshAssignment"]>): void { return deps().maybeResetTaskSessionForFreshAssignment(...args); }
function moveTaskToReviewIfAwaitingApproval(...args: Parameters<HeartbeatManagerDependencies["moveTaskToReviewIfAwaitingApproval"]>): void { return deps().moveTaskToReviewIfAwaitingApproval(...args); }
function getActionResultsTerminalFailure(...args: Parameters<HeartbeatManagerDependencies["getActionResultsTerminalFailure"]>): string | null { return deps().getActionResultsTerminalFailure(...args); }
function isInsufficientProgress(...args: Parameters<HeartbeatManagerDependencies["isInsufficientProgress"]>): boolean { return deps().isInsufficientProgress(...args); }
function adapterActionTexts(...args: Parameters<HeartbeatManagerDependencies["adapterActionTexts"]>): string[] { return deps().adapterActionTexts(...args); }
function persistAdapterFailureDiagnostic(...args: Parameters<HeartbeatManagerDependencies["persistAdapterFailureDiagnostic"]>): void { return deps().persistAdapterFailureDiagnostic(...args); }

function emitRunEvent(
  runId: string,
  agentId: string,
  eventType: string,
  detail: string,
  db: Database.Database,
): void {
  try {
    db.prepare(
      `INSERT INTO heartbeat_run_events (id, run_id, agent_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), runId, agentId, eventType, detail, new Date().toISOString());
  } catch {
    // Non-fatal - event emission should never break the run.
  }
}

function staleTaskWakeReason(input: {
  agentId: string;
  contextSnapshot: Record<string, unknown>;
  db: Database.Database;
}): string | null {
  const taskId = stringFromRecord(input.contextSnapshot.taskId);
  const expectedStatus = stringFromRecord(input.contextSnapshot.taskStatus);
  if (!taskId || !expectedStatus) return null;

  const current = input.db
    .prepare(
      `SELECT status, assignee_agent_id, archived_at
       FROM tasks
       WHERE id = ?
       LIMIT 1`,
    )
    .get(taskId) as
      | { status: string; assignee_agent_id: string | null; archived_at: string | null }
      | undefined;

  if (!current || current.archived_at) {
    return `Skipped stale wake: task ${taskId} is no longer active.`;
  }

  if (current.status !== expectedStatus) {
    return `Skipped stale wake: task ${taskId} is now ${current.status}, not ${expectedStatus}.`;
  }

  const expectedAssigneeId = stringFromRecord(input.contextSnapshot.assigneeAgentId);
  if (expectedAssigneeId && current.assignee_agent_id !== expectedAssigneeId) {
    return `Skipped stale wake: task ${taskId} is no longer assigned to the expected reviewer.`;
  }

  if (
    (expectedStatus === "in_progress" || expectedStatus === "to-do") &&
    current.assignee_agent_id &&
    current.assignee_agent_id !== input.agentId
  ) {
    return `Skipped stale wake: task ${taskId} is assigned to another agent.`;
  }

  return null;
}

export function approvalPromptLabel(type: string, payload: Record<string, unknown>, id: string): string {
  if (type === "hire_agent") {
    return `Hire: ${payload.name ?? payload.agentName ?? "?"} (${payload.role ?? "?"})`;
  }
  if (type === "provider_switch") {
    return `Provider switch: ${payload.agentName ?? payload.agentId ?? "agent"} to ${payload.targetProvider ?? "runtime"}`;
  }
  if (type === "protected_runtime_command") {
    return `Protected command: ${payload.command ?? id.slice(0, 8)}`;
  }
  return `${type}: ${id.slice(0, 8)}`;
}


function isTransientExecutionFailure(message: string | null | undefined): boolean {
  const normalized = String(message ?? "").toLowerCase();
  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("network") ||
    normalized.includes("econnrefused") ||
    normalized.includes("enotfound") ||
    normalized.includes("eai_again") ||
    normalized.includes("unreachable") ||
    normalized.includes("usage limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("try again") ||
    normalized.includes("spawn") ||
    normalized.includes("enoent") ||
    /\bfailed with exit code unknown\b/.test(normalized) ||
    /\b5\d\d\b/.test(normalized)
  );
}

export async function executeHeartbeatRun(
  runId: string,
  db = getOrchestrationDb(),
  options: ExecuteHeartbeatOptions = {}
): Promise<ExecuteHeartbeatResult> {

  const startTime = Date.now();

  // Load the run
  const run = db
    .prepare(
      `SELECT id, agent_id, company_id, invocation_source, trigger_detail, status,
              wakeup_request_id, context_snapshot_json
       FROM heartbeat_runs WHERE id = ? LIMIT 1`
    )
    .get(runId) as HeartbeatRunRow | undefined;

  if (!run) {
    throw new OrchestrationApiError(404, "heartbeat_run_not_found", `Heartbeat run ${runId} not found`);
  }

  if (run.status !== "queued" && run.status !== "running") {
    return {
      runId,
      agentId: run.agent_id,
      status: run.status as HeartbeatRunStatus,
      sessionId: null,
      error: `Run is in status '${run.status}', expected queued or running`,
      durationMs: Date.now() - startTime,
    };
  }

  if (run.status === "running" && !options.allowPreclaimedRunning) {
    return {
      runId,
      agentId: run.agent_id,
      status: "running",
      sessionId: null,
      error: "Run is already running; another executor claimed it",
      durationMs: Date.now() - startTime,
    };
  }

  // Claim the run if still queued.
  if (run.status === "queued") {
    const now = new Date().toISOString();
    const claimed = db
      .prepare(`UPDATE heartbeat_runs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`)
      .run(now, now, runId);

    if (claimed.changes === 0) {
      // Another process claimed it between our SELECT and UPDATE
      return {
        runId,
        agentId: run.agent_id,
        status: "running" as HeartbeatRunStatus,
        sessionId: null,
        error: "Run was claimed by another process",
        durationMs: Date.now() - startTime,
      };
    }

    if (run.wakeup_request_id) {
      db.prepare(
        `UPDATE agent_wakeup_requests SET status = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`
      ).run(now, now, run.wakeup_request_id);
    }
  }

  // Load agent
  const agent = db
    .prepare(
      `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
              model, adapter_config_json, runtime_config_json, capabilities,
              (
                SELECT ar.workspace_root
                FROM agent_runtimes ar
                WHERE ar.agent_id = agents.id
                  AND ar.company_id = agents.company_id
                ORDER BY ar.updated_at DESC
                LIMIT 1
              ) AS runtime_workspace_root
       FROM agents WHERE id = ? AND archived_at IS NULL LIMIT 1`
    )
    .get(run.agent_id) as AgentRow | undefined;

  if (!agent) {
    return finishRun(runId, run, "failed", "Agent not found or archived", startTime, db);
  }

  // Resolve context snapshot before choosing the adapter. The task-level
  // execution engine chooses the orchestration layer; the assigned agent
  // profile chooses the concrete runner provider/model.
  const contextSnapshot = parseJson(run.context_snapshot_json);
  const precreatedExecutionRunId =
    typeof contextSnapshot.executionRunId === "string" && contextSnapshot.executionRunId.trim()
      ? contextSnapshot.executionRunId.trim()
      : null;
  const precreatedExecutionRun = precreatedExecutionRunId
    ? db
        .prepare(
          `SELECT provider, execution_engine, runner_provider, runner_model
           FROM execution_runs
           WHERE id = ?
           LIMIT 1`,
        )
        .get(precreatedExecutionRunId) as
          | {
              provider: string | null;
              execution_engine: TaskExecutionEngine | null;
              runner_provider: string | null;
              runner_model: string | null;
            }
          | undefined
    : undefined;
  const precreatedExecutionEngine =
    normalizeCreateTaskExecutionEngine(precreatedExecutionRun?.execution_engine) ??
    (precreatedExecutionRun?.provider === "symphony" ? "symphony" : null);
  if (!normalizeCreateTaskExecutionEngine(contextSnapshot.executionEngine) && precreatedExecutionEngine) {
    contextSnapshot.executionEngine = precreatedExecutionEngine;
  }
  if (
    typeof contextSnapshot.executionProvider !== "string" &&
    typeof precreatedExecutionRun?.provider === "string" &&
    precreatedExecutionRun.provider.trim()
  ) {
    contextSnapshot.executionProvider = precreatedExecutionRun.provider.trim();
  }
  if (
    typeof contextSnapshot.runnerProvider !== "string" &&
    typeof precreatedExecutionRun?.runner_provider === "string" &&
    precreatedExecutionRun.runner_provider.trim()
  ) {
    contextSnapshot.runnerProvider = precreatedExecutionRun.runner_provider.trim();
  }
  const staleWakeReason = staleTaskWakeReason({ agentId: agent.id, contextSnapshot, db });
  if (staleWakeReason) {
    emitRunEvent(runId, agent.id, "stale_wake_skipped", staleWakeReason, db);
    return finishRun(
      runId,
      run,
      "cancelled",
      staleWakeReason,
      startTime,
      db,
      undefined,
      precreatedExecutionRunId,
    );
  }

  // Determine task key before dispatch routing so the active hive lane can be
  // resolved from the current task row instead of legacy wake payload fields.
  const taskKey = resolveTaskKey(contextSnapshot, agent.id, db);
  const taskRouteInput = taskRouteInputForRun({ db, taskKey, contextSnapshot });
  const executionRoute: ResolvedExecutionRoute | null = taskKey !== "__heartbeat__"
    ? resolveExecutionRoute({
        companyId: agent.company_id,
        task: taskRouteInput,
        agent: {
          adapterType: agent.adapter_type,
          model: agent.model,
        },
      }, db)
    : null;
  const routeAttempts = executionRoute ? executionRouteAttempts(executionRoute) : [];
  const primaryRouteAttempt = routeAttempts[0] ?? null;
  const executionEngine = executionRoute?.executionEngine ?? String(contextSnapshot.executionEngine ?? "").trim().toLowerCase();
  const taskModelRouting = resolveTaskModelRouting(
    executionRoute ? normalizeTaskModelLane(executionRoute.laneId) : taskRouteInput.modelLane,
  );
  // Route resolution is authoritative for real tasks: it combines active hive
  // lane selection with explicit task engine overrides, then uses the assigned
  // agent profile as the concrete runner provider/model.
  const adapterType = executionRoute
    ? executionRoute.executionEngine === "symphony"
      ? "symphony"
      : primaryRouteAttempt?.target.runtimeProvider ?? "manual"
    : executionEngine === "symphony"
      ? "symphony"
      : agent.adapter_type?.trim().toLowerCase() || "manual";
  const executionRunProvider = executionRoute
    ? executionRoute.executionEngine === "manual"
      ? null
      : executionRoute.executionEngine === "symphony"
        ? "symphony"
        : primaryRouteAttempt?.target.runtimeProvider ?? null
    : executionRunProviderForAdapter(adapterType);

  const runtimeBlockReason = nonExecutableRuntimeReason(adapterType);
  if (runtimeBlockReason) {
    const message = `Agent ${agent.name} has no executable runtime configured (${runtimeBlockReason}). Attach an external runner, Codex, Anthropic, Gemini, Hermes, or OpenClaw before running this task.`;
    const idleAt = new Date().toISOString();
    db.prepare(
      `UPDATE agents
       SET last_heartbeat = ?,
           status = CASE WHEN status IN ('paused', 'offline') THEN status ELSE 'idle' END,
           updated_at = ?
       WHERE id = ?`,
    ).run(idleAt, idleAt, agent.id);
    getOrCreateRuntimeState(agent.id, agent.company_id, db, adapterType);
    updateRuntimeState(agent.id, {
      lastRunId: runId,
      lastRunStatus: "failed",
      lastError: message,
    }, db);
    emitRunEvent(runId, agent.id, "runtime_not_ready", message, db);
    return finishRun(runId, run, "failed", message, startTime, db);
  }

  if (executionRunProvider) {
    const protectedGate = checkProtectedRuntimeExecution({
      db,
      companyId: agent.company_id,
      agentId: agent.id,
      agentName: agent.name,
      provider: executionRunProvider,
      taskId: taskKey,
      runId,
    });

    if (!protectedGate.allowed) {
      const idleAt = new Date().toISOString();
      db.prepare(
        `UPDATE agents
         SET last_heartbeat = ?,
             status = CASE WHEN status IN ('paused', 'offline') THEN status ELSE 'idle' END,
             updated_at = ?
         WHERE id = ?`,
      ).run(idleAt, idleAt, agent.id);
      getOrCreateRuntimeState(agent.id, agent.company_id, db, adapterType);
      updateRuntimeState(agent.id, {
        lastRunId: runId,
        lastRunStatus: "cancelled",
        lastError: protectedGate.message,
      }, db);
      emitRunEvent(
        runId,
        agent.id,
        "approval_required",
        `Runtime execution paused pending approval ${protectedGate.approvalId}`,
        db,
      );
      return finishRun(
        runId,
        run,
        "cancelled",
        protectedGate.message,
        startTime,
        db,
        undefined,
        precreatedExecutionRunId,
      );
    }
  }

  maybeResetTaskSessionForFreshAssignment(agent.id, agent.company_id, taskKey, contextSnapshot, db);

  // Get or create persistent session
  const session = getOrCreateTaskSession(
    { agentId: agent.id, companyId: agent.company_id, adapterType, taskKey },
    db
  );

  // Get runtime state
  const runtimeState = getOrCreateRuntimeState(agent.id, agent.company_id, db, adapterType);

  // Store session-before
  db.prepare(
    `UPDATE heartbeat_runs SET session_id_before = ?, updated_at = ? WHERE id = ?`
  ).run(runtimeState.sessionId ?? session.sessionParams.sessionId as string ?? null, new Date().toISOString(), runId);

  // If this heartbeat is for a real task (not __heartbeat__), bridge to execution_runs
  // so the existing HiveRunner polling infrastructure can import output.
  let executionRunId: string | null = null;
  const contextExecutionEngine =
    taskExecutionEngineForRun({
      db,
      taskKey,
      routeExecutionEngine: executionRoute?.executionEngine,
      contextExecutionEngine: contextSnapshot.executionEngine,
    }) ??
    executionRoute?.executionEngine ??
    (contextSnapshot.executionEngine === "symphony" ||
    contextSnapshot.executionEngine === "hiverunner" ||
    contextSnapshot.executionEngine === "manual"
      ? contextSnapshot.executionEngine
      : null);
  const contextRunnerProvider =
    primaryRouteAttempt?.target.runtimeProvider ??
    (typeof contextSnapshot.runnerProvider === "string" && contextSnapshot.runnerProvider.trim()
      ? contextSnapshot.runnerProvider.trim()
      : executionRunProvider);
  if (taskKey !== "__heartbeat__" && executionRunProvider) {
    const existingExecRun = db
      .prepare(
        `SELECT id FROM execution_runs
         WHERE task_id = ? AND provider = ? AND status IN ('pending', 'running')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(taskKey, executionRunProvider) as { id: string } | undefined;

    if (!existingExecRun) {
      executionRunId = randomUUID();
      const execNow = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model, model_lane, fallback_used, fallback_index, fallback_from_provider, route_attempts_json, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`
      ).run(
        executionRunId,
        taskKey,
        agent.id,
        executionRunProvider,
        contextExecutionEngine,
        primaryRouteAttempt?.target.runtimeProvider ?? contextRunnerProvider,
        primaryRouteAttempt?.target.model ?? null,
        executionRoute?.laneId ?? taskModelRouting.lane,
        0,
        null,
        null,
        JSON.stringify([]),
        execNow,
        execNow,
        execNow,
      );
      recordCompanyAuditEvent({
        companyId: agent.company_id,
        agentId: agent.id,
        taskId: taskKey,
        eventType: "task.execution.started",
        actorUserId: "engine",
        metadata: {
          executionRunId,
          provider: executionRunProvider,
          heartbeatRunId: runId,
          adapterType,
        },
      }, db);
    } else {
      executionRunId = existingExecRun.id;
      const execNow = new Date().toISOString();
      db.prepare(
        `UPDATE execution_runs
         SET status = 'running',
             started_at = COALESCE(started_at, ?),
             execution_engine = ?,
             runner_provider = COALESCE(runner_provider, ?),
             runner_model = COALESCE(runner_model, ?),
             model_lane = COALESCE(model_lane, ?),
             updated_at = ?
         WHERE id = ?
           AND status = 'pending'`,
      ).run(
        execNow,
        contextExecutionEngine,
        primaryRouteAttempt?.target.runtimeProvider ?? contextRunnerProvider,
        primaryRouteAttempt?.target.model ?? null,
        executionRoute?.laneId ?? taskModelRouting.lane,
        execNow,
        executionRunId,
      );
    }
    if (executionRunId) {
      autoMarkTaskInProgressForExecutionRun(db, {
        taskId: taskKey,
        agentId: agent.id,
        runId,
        executionRunId,
      });
    }
  }

  // Build the execution prompt
  const promptBuildStart = Date.now();
  const prompt = buildHeartbeatPrompt(agent, contextSnapshot, session, db, executionRunId);
  const promptBuildMs = Date.now() - promptBuildStart;

  // ── Telemetry accumulator (usage_json) ──
  const telemetry: Record<string, unknown> = {
    promptChars: prompt.length,
    promptBuildMs,
    sessionReused: false,
    messageCountBefore: 0,
  };

  // Execute via the adapter resolved from agent.adapter_type.
  // Missing or unknown providers use the neutral manual adapter, so OpenClaw
  // is never the implicit fallback for incomplete runtime config.
  // lives under src/lib/orchestration/execution/adapters/.
  emitRunEvent(runId, agent.id, "session_start", `Sending prompt to agent session (${prompt.length} chars)`, db);
  let result: {
    sessionId?: string;
    sessionKey?: string;
    messageCountBefore?: number;
    runnerProvider?: string | null;
    runnerModel?: string | null;
    error?: string;
    usage?: Record<string, unknown>;
  } | undefined;
  let usedRouteAttempt: ResolvedExecutionRouteAttempt | null = primaryRouteAttempt;
  let usedAdapterType = adapterType;
  let usedExecutionRunProvider = executionRunProvider;
  const routeAttemptList: Array<ResolvedExecutionRouteAttempt | null> = executionRoute
    ? routeAttempts
    : [null];
  const routeAttemptAudit: Array<Record<string, unknown>> = [];

  for (let index = 0; index < routeAttemptList.length; index += 1) {
    const attempt = routeAttemptList[index];
    const attemptAdapterType = executionRoute
      ? executionRoute.executionEngine === "symphony"
        ? "symphony"
        : attempt?.target.runtimeProvider ?? "manual"
      : adapterType;
    const attemptProvider = executionRoute
      ? executionRoute.executionEngine === "symphony"
        ? "symphony"
        : attempt?.target.runtimeProvider ?? null
      : executionRunProvider;
    const executionAdapter = getExecutionAdapter(attemptAdapterType);
    const attemptStartedAt = new Date().toISOString();
    try {
      result = await executionAdapter.execute({
        agent,
        prompt,
        session,
        runtimeState,
        taskModelRouting,
        executionRoute,
        executionRouteAttempt: attempt,
        runId,
        executionRunId: executionRunId ?? undefined,
        emitEvent: (eventType, detail) => emitRunEvent(runId, agent.id, eventType, detail, db),
      });
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : String(error),
      };
    }

    usedRouteAttempt = attempt;
    usedAdapterType = attemptAdapterType;
    usedExecutionRunProvider = attemptProvider;
    routeAttemptAudit.push({
      index,
      runtimeProvider: attempt?.target.runtimeProvider ?? attemptAdapterType,
      model: attempt?.target.model ?? null,
      fallbackUsed: Boolean(attempt?.fallbackUsed),
      status: result.error ? "failed" : "succeeded",
      error: result.error ?? null,
      startedAt: attemptStartedAt,
      finishedAt: new Date().toISOString(),
    });

    if (executionRunId) {
      db.prepare(
        `UPDATE execution_runs
         SET runner_provider = ?,
             runner_model = COALESCE(?, runner_model),
             model_lane = COALESCE(?, model_lane),
             fallback_used = ?,
             fallback_index = ?,
             fallback_from_provider = ?,
             route_attempts_json = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(
        attempt?.target.runtimeProvider ?? attemptAdapterType,
        attempt?.target.model ?? null,
        executionRoute?.laneId ?? taskModelRouting.lane,
        attempt?.fallbackUsed ? 1 : 0,
        attempt?.fallbackIndex ?? null,
        attempt?.fallbackFromProvider ?? null,
        JSON.stringify(routeAttemptAudit),
        new Date().toISOString(),
        executionRunId,
      );
    }

    if (!result.error) break;
    const canFallback = index < routeAttemptList.length - 1 && isTransientExecutionFailure(result.error);
    if (!canFallback) break;
    emitRunEvent(
      runId,
      agent.id,
      "execution_fallback",
      `Transient ${attempt?.target.runtimeProvider ?? attemptAdapterType} failure; trying configured fallback.`,
      db,
    );
  }

  if (!result) {
    return finishRun(runId, run, "failed", "No execution route attempts were available.", startTime, db, undefined, executionRunId);
  }

  const resultUsage = result.usage ?? {};
  const resultRunnerProvider =
    typeof result.runnerProvider === "string" && result.runnerProvider.trim()
      ? result.runnerProvider.trim()
      : typeof resultUsage.runnerProvider === "string" && resultUsage.runnerProvider.trim()
        ? resultUsage.runnerProvider.trim()
        : usedRouteAttempt?.target.runtimeProvider ?? usedExecutionRunProvider ?? usedAdapterType;
  const resultRunnerModel =
    typeof result.runnerModel === "string" && result.runnerModel.trim()
      ? result.runnerModel.trim()
      : typeof resultUsage.runnerModel === "string" && resultUsage.runnerModel.trim()
        ? resultUsage.runnerModel.trim()
        : typeof resultUsage.model === "string" && resultUsage.model.trim()
          ? resultUsage.model.trim()
          : null;

  if (executionRunId) {
    db.prepare(
      `UPDATE execution_runs
       SET execution_engine = ?,
           runner_provider = ?,
           runner_model = COALESCE(?, runner_model),
           updated_at = ?
       WHERE id = ?`,
    ).run(
      contextExecutionEngine,
      resultRunnerProvider,
      resultRunnerModel,
      new Date().toISOString(),
      executionRunId,
    );
  }

  if (executionRunId && result.usage) {
    try {
      const { transcriptEvents, ...usageForStorage } = result.usage;
      const transcriptEventCount = persistExecutionTranscriptEvents({
        db,
        executionRunId,
        provider: usedExecutionRunProvider ?? usedAdapterType,
        events: transcriptEvents,
        occurredAt: new Date().toISOString(),
      });
      db.prepare(
      `UPDATE execution_runs
         SET token_usage_json = ?,
             execution_engine = ?,
             runner_provider = ?,
             runner_model = COALESCE(?, runner_model),
             updated_at = ?
         WHERE id = ?`,
      ).run(
        JSON.stringify({
          ...usageForStorage,
          transcriptEventCount,
          heartbeatRunId: runId,
          adapterType: usedAdapterType,
          routeAttemptCount: routeAttemptAudit.length,
          fallbackUsed: Boolean(usedRouteAttempt?.fallbackUsed),
        }),
        contextExecutionEngine,
        resultRunnerProvider,
        resultRunnerModel,
        new Date().toISOString(),
        executionRunId,
      );
      recordRuntimeSkillAvailabilityForRun(db, executionRunId);
      recordCostEvent(
        db,
        agent,
        taskKey,
        executionRunId,
        runId,
        usedExecutionRunProvider ?? usedAdapterType,
        usageForStorage
      );
    } catch (error) {
      console.warn(
        `[engine] failed to persist execution metadata for ${executionRunId}:`,
        error,
      );
    }
  }

  // Capture session telemetry
  if (result.usage) {
    telemetry.adapterUsage = result.usage;
    telemetry.openclawRunId = result.usage.openclawRunId ?? null;
    telemetry.openclawStatus = result.usage.openclawStatus ?? null;
    telemetry.sessionReused = result.usage.sessionReused ?? false;
  }
  telemetry.messageCountBefore = result.messageCountBefore ?? 0;

  // Bridge: update execution_run with session ID so polling can find it
  if (executionRunId && result.sessionId) {
    db.prepare(
      `UPDATE execution_runs SET session_id = ?, status = 'running', updated_at = ? WHERE id = ?`
    ).run(result.sessionId, new Date().toISOString(), executionRunId);

    // Also set the task's execution_session_id so poll knows which session to check.
    // tasks.execution_mode is still the legacy bridge mode field, so only write
    // provider names it currently supports.
    if (executionRunProvider === "openclaw") {
      db.prepare(
        `UPDATE tasks SET execution_mode = ?, execution_session_id = ?, updated_at = ? WHERE id = ?`
      ).run(executionRunProvider, result.sessionId, new Date().toISOString(), taskKey);
    } else {
      db.prepare(
        `UPDATE tasks SET execution_session_id = ?, updated_at = ? WHERE id = ?`
      ).run(result.sessionId, new Date().toISOString(), taskKey);
    }
  }

  // Persist session state. sessionKey is stored alongside sessionId so
  // subsequent wakes resume with the exact key the adapter used for create
  // — the deterministic key was bitten by silent collision during fresh
  // creates after a self-heal. Legacy rows that lack sessionKey fall back
  // to the deterministic form inside the OpenClaw execution adapter.
  if (result.sessionId) {
    updateTaskSession(
      session.id,
      {
        sessionParams: {
          ...session.sessionParams,
          sessionId: result.sessionId,
          ...(result.sessionKey ? { sessionKey: result.sessionKey } : {}),
        },
        lastRunId: runId,
        lastError: result.error ?? null,
      },
      db
    );

    const tokenDeltas = usageTokenDeltas(result.usage);
    updateRuntimeState(
      agent.id,
      {
        sessionId: result.sessionId,
        lastRunId: runId,
        lastRunStatus: result.error ? "failed" : "succeeded",
        inputTokensDelta: tokenDeltas.inputTokensDelta,
        outputTokensDelta: tokenDeltas.outputTokensDelta,
        costCentsDelta: tokenDeltas.costCentsDelta,
        lastError: result.error ?? null,
      },
      db
    );
    // Capture tokens in telemetry (nullable - not all providers report tokens).
    applyUsageDeltasToTelemetry(telemetry, tokenDeltas);
  } else {
    const tokenDeltas = usageTokenDeltas(result.usage);
    updateRuntimeState(
      agent.id,
      {
        lastRunId: runId,
        lastRunStatus: result.error ? "failed" : "succeeded",
        inputTokensDelta: tokenDeltas.inputTokensDelta,
        outputTokensDelta: tokenDeltas.outputTokensDelta,
        costCentsDelta: tokenDeltas.costCentsDelta,
        lastError: result.error ?? null,
      },
      db,
    );
    applyUsageDeltasToTelemetry(telemetry, tokenDeltas);
  }

  // ── Post-execution: read output, import reports, execute HiveRunner actions ──
  if (result.sessionId && !result.error) {
    try {
      const importStart = Date.now();
      const actionResults = await importSessionOutputAndExecuteActions({
        sessionKey: result.sessionKey ?? `agent:${agent.openclaw_agent_id}:heartbeat:${session.taskKey}`,
        sessionId: result.sessionId,
        agentId: agent.id,
        agentName: agent.name,
        companyId: agent.company_id,
        taskKey,
        wakeReason: String(contextSnapshot.wakeReason ?? ""),
        runId,
        executionRunId,
        db,
        messageCountBefore: result.messageCountBefore ?? 0,
        telemetry,  // pass telemetry accumulator for sub-phase timing
      });
      const importDurationMs = Date.now() - importStart;

      if (taskKey !== "__heartbeat__") {
        moveTaskToReviewIfAwaitingApproval(taskKey, agent.id, runId, db);
      }

      // Finalize telemetry
      telemetry.importDurationMs = importDurationMs;
      telemetry.totalDurationMs = Date.now() - startTime;

      const now = new Date().toISOString();
      const terminalFailure = getActionResultsTerminalFailure(actionResults);
      if (!terminalFailure && taskKey !== "__heartbeat__" && isInsufficientProgress(taskKey, actionResults, db)) {
        actionResults.errors.push("Insufficient progress: passive report without task-side action on assigned unfinished task");
        emitRunEvent(runId, agent.id, "action_error", "Marked insufficient progress: no task-side action emitted", db);
        db.prepare(
          "UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'review'"
        ).run(now, taskKey);
      }

      if (terminalFailure) {
        telemetry.terminalFailure = terminalFailure;
      }

      // Store action results + usage telemetry after insufficiency classification
      db.prepare(
        `UPDATE heartbeat_runs SET result_json = ?, usage_json = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(actionResults), JSON.stringify(telemetry), now, runId);

      if (terminalFailure) {
        emitRunEvent(runId, agent.id, "error", `Run marked terminal: ${terminalFailure}`, db);
      }

      // Continuation is decided only after final run classification inside finishRun().
      // That single post-classification gate prevents passive-report-only failures from
      // queuing themselves before the final failed status is known.
    } catch (importError) {
      const msg = importError instanceof Error ? importError.message : String(importError);
      console.error("[engine] output import failed:", msg);
      // Still persist whatever telemetry we have
      telemetry.totalDurationMs = Date.now() - startTime;
      telemetry.importError = msg;
      try {
        db.prepare(
          `UPDATE heartbeat_runs SET usage_json = ?, updated_at = ? WHERE id = ?`
        ).run(JSON.stringify(telemetry), new Date().toISOString(), runId);
      } catch { /* non-fatal */ }
    }
  } else {
    // No session or error; still persist partial telemetry.
    telemetry.totalDurationMs = Date.now() - startTime;
    const assistantTexts = adapterActionTexts(result.usage);
    if (taskKey !== "__heartbeat__" && assistantTexts.length > 0) {
      try {
        const importStart = Date.now();
        const actionResults = await importAssistantTextAndExecuteActions({
          assistantTexts,
          agentId: agent.id,
          agentName: agent.name,
          companyId: agent.company_id,
          taskKey,
          wakeReason: String(contextSnapshot.wakeReason ?? ""),
          runId,
          executionRunId,
          db,
          source: usedExecutionRunProvider ?? usedAdapterType,
          telemetry,
        });
        if (result.error) {
          actionResults.errors.push(`Adapter reported terminal error after emitting parseable output: ${result.error}`);
          (actionResults as Record<string, unknown>).adapterTerminalError = result.error;
        }
        const importDurationMs = Date.now() - importStart;
        telemetry.importDurationMs = importDurationMs;
        telemetry.totalDurationMs = Date.now() - startTime;

        if (taskKey !== "__heartbeat__") {
          moveTaskToReviewIfAwaitingApproval(taskKey, agent.id, runId, db);
        }

        const terminalFailure = getActionResultsTerminalFailure(actionResults);
        if (!terminalFailure && isInsufficientProgress(taskKey, actionResults, db)) {
          actionResults.errors.push("Insufficient progress: passive report without task-side action on assigned unfinished task");
          emitRunEvent(runId, agent.id, "action_error", "Marked insufficient progress: no task-side action emitted", db);
        }

        db.prepare(
          `UPDATE heartbeat_runs SET result_json = ?, usage_json = ?, updated_at = ? WHERE id = ?`
        ).run(JSON.stringify(actionResults), JSON.stringify(telemetry), new Date().toISOString(), runId);
      } catch (importError) {
        const msg = importError instanceof Error ? importError.message : String(importError);
        console.error("[engine] adapter output import failed:", msg);
        telemetry.importError = msg;
      }
    } else if (!result.error && taskKey !== "__heartbeat__" && result.usage?.taskEvidenceCommentCreated === true) {
      try {
        db.prepare(
          `UPDATE heartbeat_runs SET result_json = ?, updated_at = ? WHERE id = ?`
        ).run(
          JSON.stringify({
            messagesImported: 1,
            actionsFound: 1,
            actionsExecuted: 1,
            actionsSkippedDedup: 0,
            tasksCreated: [],
            approvalsCreated: [],
            reportsImported: 1,
            errors: [],
          }),
          new Date().toISOString(),
          runId,
        );
      } catch { /* non-fatal */ }
    }
    try {
      if (result.error) {
        persistAdapterFailureDiagnostic(db, runId, result);
      }
      db.prepare(
        `UPDATE heartbeat_runs SET usage_json = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(telemetry), new Date().toISOString(), runId);
    } catch { /* non-fatal */ }
  }

  // Update agent heartbeat
  db.prepare(
    `UPDATE agents
     SET last_heartbeat = ?,
         status = CASE WHEN status IN ('paused', 'offline') THEN status ELSE 'idle' END,
         updated_at = ?
     WHERE id = ?`
  ).run(new Date().toISOString(), new Date().toISOString(), agent.id);

  let finalStatus: HeartbeatRunStatus = result.error ? "failed" : "succeeded";
  let finalError: string | null = result.error ?? null;

  if (!result.error) {
    try {
      const parsed = loadStoredActionResults(runId, db);
      const terminalFailure = getActionResultsTerminalFailure(parsed);
      if (terminalFailure) {
        finalStatus = "failed";
        finalError = terminalFailure;
      } else if (taskKey !== "__heartbeat__" && parsed && isInsufficientProgress(taskKey, parsed, db)) {
        finalStatus = "failed";
        finalError = "insufficient_progress_passive_report_only";
      }
    } catch {}
  }

  return finishRun(
    runId,
    run,
    finalStatus,
    finalError,
    startTime,
    db,
    result.sessionId,
    executionRunId
  );
}

const STALE_QUEUED_RUN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_TICK_MAX_CONCURRENT = 5;
const TICK_MAX_CONCURRENT_CEILING = 32;

export function getTickMaxConcurrent(): number {
  const raw = process.env.MC_TICK_MAX_CONCURRENT;
  if (!raw) return DEFAULT_TICK_MAX_CONCURRENT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TICK_MAX_CONCURRENT;
  return Math.min(parsed, TICK_MAX_CONCURRENT_CEILING);
}

export function claimQueuedRunsForTick(db: Database.Database, max: number): ClaimedRun[] {
  const claimed: ClaimedRun[] = [];
  for (let i = 0; i < max; i++) {
    const next = claimNextQueuedRun(db);
    if (!next) break;
    claimed.push(next);
  }
  return claimed;
}

type ClaimedRun = {
  id: string;
  agent_id: string;
  wakeup_request_id: string | null;
};

/**
 * Atomically claim the oldest queued heartbeat run.
 * Uses UPDATE ... WHERE to prevent double-claiming.
 * Returns null if no queued runs exist.
 */
export function claimNextQueuedRun(db: Database.Database): ClaimedRun | null {
  const now = new Date().toISOString();
  const claimCompanyId = resolveQueuedHeartbeatClaimCompanyId(db);

  if (claimCompanyId === "__disabled__") {
    return null;
  }

  // Find the oldest queued run whose agent is not already running another heartbeat.
  const candidate = db
    .prepare(
      `SELECT hr.id, hr.agent_id, hr.wakeup_request_id
       FROM heartbeat_runs hr
       WHERE hr.status = 'queued'
         ${claimCompanyId ? "AND hr.company_id = ?" : ""}
         AND NOT EXISTS (
           SELECT 1
           FROM heartbeat_runs hr_running
           WHERE hr_running.agent_id = hr.agent_id
             AND hr_running.status = 'running'
         )
       ORDER BY
         CASE hr.trigger_detail WHEN 'goal_lead_planning' THEN 0 ELSE 1 END,
         hr.created_at ASC
       LIMIT 1`
    )
    .get(...(claimCompanyId ? [claimCompanyId] : [])) as ClaimedRun | undefined;

  if (!candidate) return null;

  // Atomic claim: only succeeds if still queued
  const result = db
    .prepare(
      `UPDATE heartbeat_runs
       SET status = 'running', started_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`
    )
    .run(now, now, candidate.id);

  if (result.changes === 0) {
    // Another tick already claimed it
    return null;
  }

  // Claim the wakeup request too
  if (candidate.wakeup_request_id) {
    db.prepare(
      `UPDATE agent_wakeup_requests SET status = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`
    ).run(now, now, candidate.wakeup_request_id);
  }

  return candidate;
}

/**
 * Recover runs stuck in 'running' for longer than the stale timeout.
 * Marks them as 'timed_out' so they don't block the queue forever.
 */
export const __testHooks = {
  claimNextQueuedRun,
  claimQueuedRunsForTick,
  getTickMaxConcurrent,
  maybeEnqueueNextReadyAssignedTaskForAgent,
  autoFlipTaskToReviewAfterMissingEndDeclaration,
};

export function recoverStaleRuns(db: Database.Database): number {
  const cutoff = new Date(Date.now() - getHeartbeatRunTimeoutMs()).toISOString();
  const now = new Date().toISOString();
  const timeoutMessage = `Timed out: run exceeded ${Math.round(getHeartbeatRunTimeoutMs() / 60_000)} minute limit`;

  const staleRuns = db
    .prepare(
      `SELECT id, agent_id, started_at, context_snapshot_json
       FROM heartbeat_runs
       WHERE status = 'running' AND started_at < ? AND started_at IS NOT NULL`
    )
    .all(cutoff) as Array<{
      id: string;
      agent_id: string;
      started_at: string | null;
      context_snapshot_json: string | null;
    }>;

  if (staleRuns.length === 0) {
    return 0;
  }

  const result = db
    .prepare(
      `UPDATE heartbeat_runs
       SET status = 'timed_out', finished_at = ?, error = ?, updated_at = ?
       WHERE status = 'running' AND started_at < ? AND started_at IS NOT NULL`
    )
    .run(now, timeoutMessage, now, cutoff);

  if (result.changes > 0) {
    // Also fail the linked wakeup requests
    db.prepare(
      `UPDATE agent_wakeup_requests
       SET status = 'failed', finished_at = ?, updated_at = ?
       WHERE status = 'claimed' AND claimed_at < ?`
    ).run(now, now, cutoff);

    for (const run of staleRuns) {
      let taskId: string | null = null;
      try {
        const snapshot = run.context_snapshot_json ? JSON.parse(run.context_snapshot_json) as Record<string, unknown> : null;
        const candidate = typeof snapshot?.taskId === "string" ? snapshot.taskId : null;
        taskId = candidate && candidate !== "__heartbeat__" ? candidate : null;
      } catch {
        taskId = null;
      }

      if (!taskId) continue;

      const startedAt = run.started_at ? Date.parse(run.started_at) : Number.NaN;
      const durationMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : getHeartbeatRunTimeoutMs();

      const staleExecRuns = db.prepare(
        `SELECT id FROM execution_runs WHERE task_id = ? AND agent_id = ? AND status IN ('pending', 'running')`
      ).all(taskId, run.agent_id) as Array<{ id: string }>;

      db.prepare(
        `UPDATE execution_runs
         SET status = 'failed', completed_at = ?, duration_ms = ?, error_message = ?, updated_at = ?
	         WHERE task_id = ?
	           AND agent_id = ?
	           AND status IN ('pending', 'running')`
      ).run(now, durationMs, timeoutMessage, now, taskId, run.agent_id);

      for (const { id } of staleExecRuns) {
        cleanupRunArtifacts(id).catch(() => {});
      }

      reconcileTerminalOpenClawTaskState(taskId, db);
    }
  }

  return result.changes;
}

export function recoverStaleQueuedRuns(db: Database.Database): number {
  const cutoff = new Date(Date.now() - STALE_QUEUED_RUN_TIMEOUT_MS).toISOString();
  const now = new Date().toISOString();
  const timeoutMessage = "Timed out: queued run was not claimed within 10 minutes";

  const stale = db
    .prepare(
      `SELECT id, wakeup_request_id
       FROM heartbeat_runs
       WHERE status = 'queued' AND created_at < ?`
    )
    .all(cutoff) as Array<{ id: string; wakeup_request_id: string | null }>;

  if (stale.length === 0) {
    return 0;
  }

  const result = db
    .prepare(
      `UPDATE heartbeat_runs
       SET status = 'timed_out', finished_at = ?, error = ?, updated_at = ?
       WHERE status = 'queued' AND created_at < ?`
    )
    .run(now, timeoutMessage, now, cutoff);

  const wakeupIds = stale
    .map((run) => run.wakeup_request_id)
    .filter((id): id is string => Boolean(id));

  if (wakeupIds.length > 0) {
    const updateWake = db.prepare(
      `UPDATE agent_wakeup_requests
       SET status = 'failed', finished_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`
    );
    for (const wakeupId of wakeupIds) {
      updateWake.run(now, now, wakeupId);
    }
  }

  return result.changes;
}

export function recoverStalePendingExecutionRuns(db: Database.Database): number {
  const cutoff = new Date(Date.now() - STALE_QUEUED_RUN_TIMEOUT_MS).toISOString();
  const now = new Date().toISOString();
  const timeoutMessage = "Timed out: execution run was not started within 10 minutes";
  const terminalTaskMessage = "Cancelled: task reached a terminal status before this execution run started";

  const terminalResult = db
    .prepare(
      `UPDATE execution_runs
       SET status = 'cancelled',
           completed_at = ?,
           error_message = ?,
           updated_at = ?
       WHERE status = 'pending'
         AND task_id IN (
           SELECT id
           FROM tasks
           WHERE status IN ('done', 'blocked')
              OR archived_at IS NOT NULL
         )`,
    )
    .run(now, terminalTaskMessage, now);

  const result = db
    .prepare(
      `UPDATE execution_runs
       SET status = 'cancelled',
           completed_at = ?,
           error_message = ?,
           updated_at = ?
       WHERE status = 'pending'
         AND created_at < ?`
    )
    .run(now, timeoutMessage, now, cutoff);

  return terminalResult.changes + result.changes;
}

export function finishRun(
  runId: string,
  run: HeartbeatRunRow,
  status: HeartbeatRunStatus,
  error: string | null,
  startTime: number,
  db: Database.Database,
  sessionId?: string,
  executionRunId?: string | null
): ExecuteHeartbeatResult {
  const now = new Date().toISOString();
  const durationMs = Date.now() - startTime;

  db.prepare(
    `UPDATE heartbeat_runs
     SET status = ?, finished_at = ?, error = ?,
         session_id_after = COALESCE(?, session_id_after),
         updated_at = ?
     WHERE id = ?`
  ).run(status, now, error, sessionId ?? null, now, runId);

  if (run.wakeup_request_id) {
    const wakeStatus = status === "succeeded" ? "finished" : "failed";
    db.prepare(
      `UPDATE agent_wakeup_requests SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?`
    ).run(wakeStatus, now, now, run.wakeup_request_id);
  }

  // Bridge: also finalize the corresponding execution_run so the HiveRunner dashboard
  // reflects completion. Without this, execution_runs stay stuck at 'running'.
  if (executionRunId) {
    const execStatus = status === "succeeded" ? "completed" : "failed";
    const failureClass = execStatus === "failed" && error
      ? (/timed?\s*out/i.test(error) ? "timeout" : null)
      : null;
    try {
      db.prepare(
        `UPDATE execution_runs
         SET status = ?, completed_at = ?, duration_ms = ?,
             error_message = ?, failure_class = COALESCE(failure_class, ?), updated_at = ?
         WHERE id = ? AND status IN ('pending', 'running')`
      ).run(execStatus, now, durationMs, error, failureClass, now, executionRunId);
      const executionRunRow = db
        .prepare(
          `SELECT task_id
           FROM execution_runs
           WHERE id = ?
           LIMIT 1`
        )
        .get(executionRunId) as { task_id: string | null } | undefined;
      if (executionRunRow?.task_id) {
        if (execStatus === "completed") {
          autoFlipTaskToReviewAfterMissingEndDeclaration(db, {
            taskId: executionRunRow.task_id,
            agentId: run.agent_id,
            runId,
            runWindowStart: run.started_at ?? run.created_at,
            now,
          });
        }
        reconcileTerminalOpenClawTaskState(executionRunRow.task_id, db);

        const postTask = db
          .prepare(
            `SELECT t.id, t.status, t.assignee_agent_id, t.project_id,
                    a.adapter_type AS assignee_adapter_type,
                    a.model AS assignee_model
             FROM tasks t
             LEFT JOIN agents a ON a.id = t.assignee_agent_id
             WHERE t.id = ? AND t.archived_at IS NULL
             LIMIT 1`,
          )
          .get(executionRunRow.task_id) as { id: string; status: string; assignee_agent_id: string | null; project_id: string; assignee_adapter_type: string | null; assignee_model: string | null } | undefined;
        const projectRow = postTask
          ? db.prepare("SELECT company_id FROM projects WHERE id = ? LIMIT 1").get(postTask.project_id) as { company_id: string | null } | undefined
          : undefined;

        if (projectRow?.company_id) {
          recordCompanyAuditEvent({
            companyId: projectRow.company_id,
            agentId: run.agent_id,
            taskId: executionRunRow.task_id,
            eventType: execStatus === "completed" ? "task.execution.completed" : "task.execution.failed",
            actorUserId: "engine",
            metadata: {
              executionRunId,
              heartbeatRunId: runId,
              status: execStatus,
              durationMs,
              error,
            },
          }, db);
        }

        if (postTask?.assignee_agent_id && projectRow?.company_id) {
          const continuationStatus = postTask.status;

          // Review is a reviewer-gated state. A finished run on a review-state
          // task does NOT auto-bounce back to in_progress — that created the
          // review-pinning loop observed 2026-04-18 (61 review→in_progress +
          // 60 in_progress→review events in 8h, only 3 real closures). The
          // CEO is woken separately by reconcileTerminalOpenClawTaskState via
          // the `ceo_review_requested` path; operator spec says review only
          // returns to in_progress via an explicit named-agent handoff.

          const continuation = decideFinishRunContinuation(postTask.id, runId, status, db);

          // ── Circuit breaker: in-progress-loop detection ───────────────────
          // Extracted to checkAndTripCircuitBreaker below so contract tests
          // can exercise it directly. Trip at 3 → flip to blocked, emit
          // [AWAITING_HUMAN] comment, skip continuation enqueue. Caught
          // Vane's WEA-258 + Barometer's WEA-237 loops 2026-04-18 evening.
          const circuitBreakerTripped = checkAndTripCircuitBreaker(
            {
              taskId: postTask.id,
              runId,
              agentId: run.agent_id,
              runWindowStart: run.started_at ?? run.created_at,
              now,
            },
            db,
          );

          if (
            !circuitBreakerTripped &&
            continuation.shouldContinue &&
            ["in_progress", "review", "to-do"].includes(continuationStatus)
          ) {
            const continuationReason = continuation.reason ?? `finish_run_continue_${continuationStatus}`;
            const continuationExecution = taskExecutionPolicyForWakeup({
              db,
              taskId: postTask.id,
              assigneeAdapterType: postTask.assignee_adapter_type,
              assigneeModel: postTask.assignee_model,
            });
            enqueueWakeup(
              {
                agentId: postTask.assignee_agent_id,
                companyId: projectRow.company_id,
                source: "api",
                reason: continuationReason,
                payload: {
                  taskId: postTask.id,
                  taskStatus: continuationStatus,
                  executionEngine: continuationExecution.executionEngine,
                  modelLane: continuationExecution.modelLane,
                  ...(continuationExecution.executionProvider
                    ? { executionProvider: continuationExecution.executionProvider }
                    : {}),
                  continuedFromExecutionRunId: executionRunId,
                },
                idempotencyKey: `continuation:${postTask.id}:${continuationStatus}`,
              },
              db,
            );
          }

          if (!circuitBreakerTripped && status === "succeeded") {
            maybeEnqueueNextReadyAssignedTaskForAgent({
              agentId: run.agent_id,
              companyId: projectRow.company_id,
              completedTaskId: postTask.id,
              currentTaskStatus: continuationStatus,
              runId,
              db,
            });
          }
        }
      }
    } catch {
      // Non-fatal: execution_run bridge update failed
    }
  }

  return {
    runId,
    agentId: run.agent_id,
    status,
    sessionId: sessionId ?? null,
    error,
    durationMs,
  };
}


export function resolveTaskKey(
  contextSnapshot: Record<string, unknown>,
  agentId: string,
  db: Database.Database
): string {
  // If context has a specific task/issue, use that as the task key
  const directionTaskId = contextSnapshot.directionTaskId as string | undefined;
  if (directionTaskId) return directionTaskId;

  const taskId = contextSnapshot.taskId as string | undefined;
  if (taskId) return taskId;

  const issueId = contextSnapshot.issueId as string | undefined;
  if (issueId) return issueId;

  const taskKey = contextSnapshot.taskKey as string | undefined;
  // WARNING: despite the name, this path expects the canonical tasks.id UUID.
  // Passing a human task key like "VIR-5" will later be bridged into
  // execution_runs.task_id and fail foreign-key checks. External/manual wake
  // callers should either pass the real task UUID here or omit taskKey so the
  // engine can resolve the assigned in_progress/to-do task automatically.
  if (taskKey) return taskKey;

  // Fallback: find the agent's highest-priority active task
  const activeTask = db
    .prepare(
      `SELECT id FROM tasks
       WHERE assignee_agent_id = ? AND archived_at IS NULL
         AND status IN ('in_progress', 'to-do')
       ORDER BY
         CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,
         CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at ASC
       LIMIT 1`
    )
    .get(agentId) as { id: string } | undefined;

  if (activeTask) return activeTask.id;

  // Last fallback: use "__heartbeat__" for general timer wakes with no tasks
  return "__heartbeat__";
}
