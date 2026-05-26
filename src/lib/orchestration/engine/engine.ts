/**
 * Company Operating Engine
 *
 * This is the core engine that makes a HiveRunner company actually run:
 * CEO receives direction, hires agents, assigns work, and agents execute
 * with persistent sessions and heartbeat-driven wake cycles.
 *
 * Runtime model: OpenClaw gateway sessions (same as existing HiveRunner execution).
 * Session persistence: agent_task_sessions table stores per-task session state.
 * Heartbeat model: Wakeup requests queue → heartbeat runs → adapter execution.
 */

import { randomUUID } from "crypto";
import os from "os";
import path from "path";
import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  OPENCLAW_BIN,
  callGateway,
  getExecutionAdapter,
} from "@/lib/orchestration/execution/adapters";
import { cleanupOrphanedRunArtifacts } from "@/lib/orchestration/execution/cleanup";
import {
  reconcileTaskHierarchy,
  refreshAgentLoad,
} from "@/lib/orchestration/service/shared";
import { maybeSweepOpenTasks, type SweepResult } from "@/lib/orchestration/engine/sweeper";
import { resolveExecutionRoute } from "@/lib/orchestration/execution-route-resolver";
import {
  isExecutableAgentRuntime,
} from "@/lib/orchestration/runtime-readiness";
import {
  getOrCreateRuntimeState,
  getOrCreateTaskSession,
  parseJson,
  resetAgentRuntimeSessionForSelfHeal,
  stringFromRecord,
  updateRuntimeState,
  updateTaskSession,
} from "@/lib/orchestration/engine/persistence";
import type { RuntimeState, TaskSession } from "@/lib/orchestration/engine/persistence";
export {
  getOrCreateRuntimeState,
  getOrCreateTaskSession,
  resetAgentRuntimeSessionForSelfHeal,
  updateRuntimeState,
  updateTaskSession,
} from "@/lib/orchestration/engine/persistence";
export type { RuntimeState, TaskSession } from "@/lib/orchestration/engine/persistence";
import {
  claimNextQueuedRun,
  claimQueuedRunsForTick,
  configureHeartbeatManagerDependencies,
  executeHeartbeatRun,
  getTickMaxConcurrent,
  recoverStalePendingExecutionRuns,
  recoverStaleQueuedRuns,
  recoverStaleRuns,
  resolveTaskKey,
} from "@/lib/orchestration/engine/heartbeat-manager";
export { executeHeartbeatRun, resolveTaskKey } from "@/lib/orchestration/engine/heartbeat-manager";
export type { ExecuteHeartbeatOptions, ExecuteHeartbeatResult, ExecutionRunProvider } from "@/lib/orchestration/engine/heartbeat-manager";
import type { ExecutionRunProvider } from "@/lib/orchestration/engine/heartbeat-manager";
import { taskExecutionPolicyForWakeup } from "@/lib/orchestration/engine/execution-router";
export {
  routeTaskToAdapter,
  taskExecutionPolicyForWakeup,
} from "@/lib/orchestration/engine/execution-router";
import {
  enqueueWakeup,
  wakeTargetFromJson,
  type EnqueueWakeupResult,
  type HeartbeatRun,
  type HeartbeatRunStatus,
  type InvocationSource,
  type WakeupRequest,
  type WakeupSource,
  type WakeupStatus,
} from "@/lib/orchestration/engine/wakeup-queue";
export {
  enqueueWakeup,
  isTaskWakeTarget,
  mapSourceToInvocation,
  sameWakeTarget,
  shouldSupersedeQueuedWake,
  wakeTargetFromJson,
  wakeTargetFromRecord,
} from "@/lib/orchestration/engine/wakeup-queue";
export type {
  EnqueueWakeupResult,
  HeartbeatRun,
  HeartbeatRunStatus,
  InvocationSource,
  WakeTarget,
  WakeupRequest,
  WakeupSource,
  WakeupStatus,
} from "@/lib/orchestration/engine/wakeup-queue";
import {
  emitRunEvent,
  extractAssistantTexts,
  getLatestReviewSubmissionAuthor,
  loadStoredSessionMessages,
  parseDependencyIds,
  pendingDependencyCount,
  waitForSessionCompletion,
  type McAction,
} from "@/lib/orchestration/engine/action-dispatcher";
export {
  executeAddComment,
  executeCreateTask,
  executeHireAgent,
  executeMemoryReceipt,
  executeMcAction,
  executeRegisterArtifact,
  executeReviewCandidate,
  executeUpdateTask,
  executeUseSkill,
  emitRunEvent,
  getLatestReviewSubmissionAuthor,
  parseActionsFromText,
} from "@/lib/orchestration/engine/action-dispatcher";
export type { ExecuteMcActionInput, McAction, McActionExecutionOutcome } from "@/lib/orchestration/engine/action-dispatcher";
import { buildHeartbeatPrompt } from "@/lib/orchestration/engine/prompt-builder";
export {
  buildHeartbeatPrompt,
  buildUnassignedTaskTriagePrompt,
  isCeoRole,
  isCompanyOrchestrationLeadRole,
  loadOnboardingAssets,
} from "@/lib/orchestration/engine/prompt-builder";
export {
  applyReviewDecision,
  routeForReview,
} from "@/lib/orchestration/engine/review-handler";
import {
  EMPTY_ASSISTANT_OUTPUT_ERROR,
  MISSING_SESSION_OUTPUT_ERROR,
  OPENCLAW_SESSION_TIMEOUT_ERROR,
  autoFlipTaskToReviewAfterMissingEndDeclaration,
  decideFinishRunContinuation,
  getActionResultsTerminalFailure,
  isInsufficientProgress,
  loadStoredActionResults,
  type ActionResults,
} from "@/lib/orchestration/engine/run-continuation";
export {
  autoFlipTaskToReviewAfterMissingEndDeclaration,
  decideFinishRunContinuation,
} from "@/lib/orchestration/engine/run-continuation";
export type {
  ActionResults,
  ContinuationDecision,
} from "@/lib/orchestration/engine/run-continuation";
import {
  adapterActionTexts,
  importAssistantTextAndExecuteActions,
  importAssistantTextsAndExecuteActions,
} from "@/lib/orchestration/engine/comment-import";
export {
  adapterActionTexts,
  importAssistantTextAndExecuteActions,
} from "@/lib/orchestration/engine/comment-import";
import { checkAndTripCircuitBreaker } from "@/lib/orchestration/engine/circuit-breaker";
export { checkAndTripCircuitBreaker } from "@/lib/orchestration/engine/circuit-breaker";
import { findCompanyCeo } from "@/lib/orchestration/engine/engine-queries";
export { findCompanyCeo } from "@/lib/orchestration/engine/engine-queries";

/* ── Types ── */

export interface KickoffResult {
  companyId: string;
  ceoAgentId: string;
  directionTaskId: string | null;
  wakeupRequestId: string;
  heartbeatRunId: string;
  status: "queued" | "no_ceo" | "already_active";
  message: string;
}

/* ── Company Kickoff ── */

export function kickoffCompany(
  input: {
    companyId: string;
    direction?: string;
    requestedBy?: string;
  },
  db = getOrchestrationDb()
): KickoffResult {
  const ceo = findCompanyCeo(input.companyId, db);
  if (!ceo) {
    return {
      companyId: input.companyId,
      ceoAgentId: "",
      directionTaskId: null,
      wakeupRequestId: "",
      heartbeatRunId: "",
      status: "no_ceo",
      message: "No CEO agent found for this company. Hire a CEO agent with role 'ceo' first.",
    };
  }

  // Check if CEO already has an active/queued heartbeat run
  const activeRun = db
    .prepare(
      `SELECT id FROM heartbeat_runs
       WHERE agent_id = ? AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(ceo.id) as { id: string } | undefined;

  if (activeRun) {
    return {
      companyId: input.companyId,
      ceoAgentId: ceo.id,
      directionTaskId: null,
      wakeupRequestId: "",
      heartbeatRunId: activeRun.id,
      status: "already_active",
      message: `CEO ${ceo.name} already has an active heartbeat run.`,
    };
  }

  // If direction is provided, create a directive task for the CEO
  let directionTaskId: string | null = null;
  if (input.direction?.trim()) {
    directionTaskId = createDirectionTask(input.companyId, ceo.id, input.direction.trim(), db);
  }

  // Ensure runtime state exists
  getOrCreateRuntimeState(ceo.id, input.companyId, db, ceo.adapter_type || "manual");

  // Queue the CEO wakeup
  const wake = enqueueWakeup(
    {
      agentId: ceo.id,
      companyId: input.companyId,
      source: "kickoff",
      reason: input.direction
        ? "Company kickoff with direction"
        : "Company kickoff — CEO initial wake",
      payload: {
        kickoff: true,
        direction: input.direction ?? null,
        directionTaskId,
      },
      invocationSource: "kickoff",
      contextSnapshot: {
        wakeSource: "kickoff",
        wakeReason: "company_kickoff",
        direction: input.direction ?? null,
        directionTaskId,
      },
    },
    db
  );

  // Update agent status to show it's working
  db.prepare(
    `UPDATE agents SET status = 'working', last_heartbeat = ?, updated_at = ?
     WHERE id = ? AND status NOT IN ('paused', 'offline')`
  ).run(new Date().toISOString(), new Date().toISOString(), ceo.id);

  return {
    companyId: input.companyId,
    ceoAgentId: ceo.id,
    directionTaskId,
    wakeupRequestId: wake.wakeupRequestId,
    heartbeatRunId: wake.heartbeatRunId,
    status: "queued",
    message: `CEO ${ceo.name} kickoff queued. Heartbeat run ${wake.heartbeatRunId} created.`,
  };
}

/* ── Direction Task Creation ── */

function createDirectionTask(
  companyId: string,
  ceoAgentId: string,
  direction: string,
  db: Database.Database
): string {
  const now = new Date().toISOString();
  const taskId = randomUUID();

  // Find a project to assign the task to, or use the first one
  const project = db
    .prepare(
      `SELECT id FROM projects
       WHERE company_id = ? AND archived_at IS NULL AND status = 'active'
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(companyId) as { id: string } | undefined;

  if (!project) {
    // No project exists — create a default "Company Operations" project
    const projectId = randomUUID();
    const slug = `ops-${companyId.slice(0, 8)}`;
    db.prepare(
      `INSERT INTO projects (id, company_id, slug, name, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(projectId, companyId, slug, "Company Operations", "Default project for company-level directives and operations.", now, now);
    return createDirectionTaskInProject(projectId, companyId, ceoAgentId, direction, taskId, now, db);
  }

  return createDirectionTaskInProject(project.id, companyId, ceoAgentId, direction, taskId, now, db);
}

function createDirectionTaskInProject(
  projectId: string,
  companyId: string,
  ceoAgentId: string,
  direction: string,
  taskId: string,
  now: string,
  db: Database.Database
): string {
  // Get next task number for this company
  const maxRow = db
    .prepare(
      `SELECT MAX(task_number) AS max_num
       FROM tasks t INNER JOIN projects p ON p.id = t.project_id
       WHERE p.company_id = ?`
    )
    .get(companyId) as { max_num: number | null } | undefined;
  const nextNum = (maxRow?.max_num ?? 0) + 1;

  // Get company code for task key
  const codeRow = db
    .prepare(`SELECT company_code FROM companies WHERE id = ? LIMIT 1`)
    .get(companyId) as { company_code: string | null } | undefined;
  const code = codeRow?.company_code ?? "MC";
  const taskKey = `${code}-${nextNum}`;

  db.prepare(
    `INSERT INTO tasks
       (id, company_id, project_id, title, description, priority, type, status,
        assignee_agent_id, assigned_at, created_by,
        execution_mode, task_number, task_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'critical', 'directive', 'in_progress',
             ?, ?, 'engine:kickoff',
             'openclaw', ?, ?, ?, ?)`
  ).run(
    taskId,
    companyId,
    projectId,
    `Company Direction: ${direction.slice(0, 100)}`,
    `## Direction from the Board\n\n${direction}\n\n## Expected Outcome\n\nReview this direction, break it down into actionable work, create tasks, and assign them to the right agents. If you need new agents, submit hire requests.`,
    ceoAgentId,
    now,
    nextNum,
    taskKey,
    now,
    now
  );

  // Log task event
  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, event_type, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, 'task.created', 'in_progress', '{"source":"engine_kickoff"}', ?)`
  ).run(randomUUID(), projectId, taskId, now);

  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.assigned', '{"source":"engine_kickoff"}', ?)`
  ).run(randomUUID(), projectId, taskId, ceoAgentId, now);

  return taskId;
}

/* ── Heartbeat Execution ── */

/* ── Automatic Execution Tick ── */

// Provider adapters own the normal execution deadline (Codex/Claude/Gemini,
// Hermes, OpenClaw). This stale-run guard is only a safety net for orphaned
// runs, so it must sit above the longest default adapter timeout.
const ORPHAN_ARTIFACT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const LEAD_SUPERVISOR_TICK_REASON = "goal_lead_supervisor_tick";
const DEFAULT_LEAD_SUPERVISOR_INTERVAL_SECONDS = 300;
const MIN_LEAD_SUPERVISOR_INTERVAL_SECONDS = 60;
const MAX_LEAD_SUPERVISOR_INTERVAL_SECONDS = 3600;
let lastOrphanArtifactCleanupAt = 0;
let lastLeadSupervisorSweepAt = 0;

export type TickRunResult = {
  runId: string;
  agentId: string;
  status: HeartbeatRunStatus | "idle" | "stale_recovered";
  error: string | null;
};

export type TickResult = {
  tickedAt: string;
  claimed: boolean;
  claimedCount: number;
  runs: TickRunResult[];
  // Back-compat: mirror the first claimed run's fields for older consumers
  // (server.js logger reads these). Null when nothing was claimed.
  runId: string | null;
  agentId: string | null;
  status: HeartbeatRunStatus | "idle" | "stale_recovered";
  error: string | null;
  durationMs: number;
  staleRunsRecovered: number;
  staleQueuedRunsRecovered: number;
  staleExecutionRunsRecovered: number;
  sweep?: SweepResult | null;
  leadSupervisor?: LeadSupervisorTickResult | null;
};

type LeadSupervisorTickResult = {
  enabled: boolean;
  intervalSeconds: number;
  candidates: number;
  wakesEnqueued: number;
  wakesCoalesced: number;
  skippedPending: number;
  skippedCadence: number;
};

function getLeadSupervisorIntervalSeconds(): number {
  const raw = process.env.HEARTBEAT_INTERVAL_SECONDS?.trim();
  if (!raw) return DEFAULT_LEAD_SUPERVISOR_INTERVAL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LEAD_SUPERVISOR_INTERVAL_SECONDS;
  return Math.min(
    MAX_LEAD_SUPERVISOR_INTERVAL_SECONDS,
    Math.max(MIN_LEAD_SUPERVISOR_INTERVAL_SECONDS, parsed),
  );
}

function isLeadSupervisorEnabled(): boolean {
  const raw = process.env.HEARTBEAT_ENABLED?.trim().toLowerCase();
  if (raw) {
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  }
  // Dev lane defaults on; stable runs with NODE_ENV=production and defaults off
  // unless the operator explicitly flips HEARTBEAT_ENABLED.
  return process.env.NODE_ENV !== "production";
}

function hasPendingLeadSupervisorWake(db: Database.Database, goalId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS found
       FROM agent_wakeup_requests awr
       LEFT JOIN heartbeat_runs hr ON hr.id = awr.run_id
       WHERE awr.reason = ?
         AND json_extract(awr.payload_json, '$.goalId') = ?
         AND (
           awr.status IN ('queued', 'claimed')
           OR hr.status IN ('queued', 'running')
         )
       LIMIT 1`,
    )
    .get(LEAD_SUPERVISOR_TICK_REASON, goalId) as { found: number } | undefined;
  return Boolean(row);
}

function latestLeadSupervisorWakeTimestamp(db: Database.Database, goalId: string): string | null {
  const row = db
    .prepare(
      `SELECT COALESCE(finished_at, claimed_at, requested_at, created_at) AS at
       FROM agent_wakeup_requests
       WHERE reason = ?
         AND json_extract(payload_json, '$.goalId') = ?
       ORDER BY datetime(COALESCE(finished_at, claimed_at, requested_at, created_at)) DESC
       LIMIT 1`,
    )
    .get(LEAD_SUPERVISOR_TICK_REASON, goalId) as { at: string | null } | undefined;
  return row?.at ?? null;
}

function maybeEnqueueLeadSupervisorTicks(db: Database.Database): LeadSupervisorTickResult | null {
  const intervalSeconds = getLeadSupervisorIntervalSeconds();
  const nowMs = Date.now();
  if (!isLeadSupervisorEnabled()) {
    return { enabled: false, intervalSeconds, candidates: 0, wakesEnqueued: 0, wakesCoalesced: 0, skippedPending: 0, skippedCadence: 0 };
  }
  if (nowMs - lastLeadSupervisorSweepAt < intervalSeconds * 1000) {
    return null;
  }
  lastLeadSupervisorSweepAt = nowMs;

  const candidates = db
    .prepare(
      `SELECT
         c.id AS company_id,
         g.id AS goal_id,
         g.name AS goal_name,
         g.lead_agent_id AS lead_agent_id,
         d.planning_task_id AS planning_task_id,
         pt.task_key AS planning_task_key,
         pt.status AS planning_task_status,
         COUNT(DISTINCT t.id) AS running_task_count
       FROM sprints g
       INNER JOIN projects p ON p.id = g.project_id
       INNER JOIN companies c ON c.id = p.company_id
       INNER JOIN sprints s ON s.parent_id = g.id
       INNER JOIN tasks t ON t.sprint_id = s.id AND t.archived_at IS NULL
       INNER JOIN goal_sprint_plan_drafts d
         ON d.id = (
           SELECT d2.id
           FROM goal_sprint_plan_drafts d2
           WHERE d2.company_goal_id = g.id
             AND d2.planning_task_id IS NOT NULL
           ORDER BY datetime(d2.created_at) DESC, d2.id DESC
           LIMIT 1
         )
       INNER JOIN tasks pt ON pt.id = d.planning_task_id AND pt.archived_at IS NULL
       WHERE g.status = 'active'
         AND s.status = 'active'
         AND g.lead_agent_id IS NOT NULL
         AND t.status NOT IN ('done', 'blocked', 'cancelled', 'backlog', 'to-do')
       GROUP BY c.id, g.id, g.name, g.lead_agent_id, d.planning_task_id, pt.task_key, pt.status
       ORDER BY g.updated_at ASC`,
    )
    .all() as Array<{
      company_id: string;
      goal_id: string;
      goal_name: string;
      lead_agent_id: string;
      planning_task_id: string;
      planning_task_key: string | null;
      planning_task_status: string;
      running_task_count: number;
    }>;

  const result: LeadSupervisorTickResult = {
    enabled: true,
    intervalSeconds,
    candidates: candidates.length,
    wakesEnqueued: 0,
    wakesCoalesced: 0,
    skippedPending: 0,
    skippedCadence: 0,
  };
  const now = new Date(nowMs).toISOString();

  for (const candidate of candidates) {
    if (hasPendingLeadSupervisorWake(db, candidate.goal_id)) {
      result.skippedPending += 1;
      continue;
    }

    const latest = latestLeadSupervisorWakeTimestamp(db, candidate.goal_id);
    if (latest && nowMs - Date.parse(latest) < intervalSeconds * 1000) {
      result.skippedCadence += 1;
      continue;
    }

    const bucket = Math.floor(nowMs / (intervalSeconds * 1000));
    const wake = enqueueWakeup(
      {
        agentId: candidate.lead_agent_id,
        companyId: candidate.company_id,
        source: "timer",
        reason: LEAD_SUPERVISOR_TICK_REASON,
        triggerDetail: `goal_supervisor:${candidate.goal_id}`,
        payload: {
          goalId: candidate.goal_id,
          goalName: candidate.goal_name,
          planningTaskId: candidate.planning_task_id,
          taskId: candidate.planning_task_id,
          taskStatus: candidate.planning_task_status,
          runningTaskCount: candidate.running_task_count,
          supervisorSince: latest,
          heartbeatIntervalSeconds: intervalSeconds,
          enqueuedAt: now,
        },
        idempotencyKey: `goal-lead-supervisor:${candidate.goal_id}:${bucket}`,
      },
      db,
    );
    if (wake.status === "coalesced") result.wakesCoalesced += 1;
    else result.wakesEnqueued += 1;
  }

  return result;
}

/**
 * Engine tick: claims and executes queued heartbeat runs for distinct agents
 * concurrently. Called automatically by the server loop every N seconds.
 *
 * Safety properties:
 * - Atomic claim: UPDATE ... WHERE status='queued' with LIMIT 1 per run
 * - Concurrent execution: up to MC_TICK_MAX_CONCURRENT runs fire in parallel
 *   (default 4). Different agents only — the per-agent "already running"
 *   guard in claimNextQueuedRun prevents same-agent double-claims.
 * - Stale detection: marks runs stuck in 'running' as timed_out
 * - Idempotent: if no queued runs, returns idle
 */
export async function tick(
  db = getOrchestrationDb()
): Promise<TickResult> {
  const startTime = Date.now();
  const tickedAt = new Date().toISOString();

  // Step 1: Recover stale runs (stuck in 'running' for too long)
  const staleRunsRecovered = recoverStaleRuns(db);
  const staleQueuedRunsRecovered = recoverStaleQueuedRuns(db);
  const staleExecutionRunsRecovered = recoverStalePendingExecutionRuns(db);

  // Orphan GC: delete temp artifacts for old terminal runs. This scans the OS
  // temp directory, so keep it off the hot 10s engine tick path.
  if (Date.now() - lastOrphanArtifactCleanupAt > ORPHAN_ARTIFACT_CLEANUP_INTERVAL_MS) {
    lastOrphanArtifactCleanupAt = Date.now();
    cleanupOrphanedRunArtifacts(db).catch(() => {});
  }

  // Step 1b: Periodic sweep of open tasks. Enqueues wakes for assignees that
  // aren't already being worked. Throttled internally — called every tick,
  // but only fires once per MC_SWEEP_INTERVAL_MS window (default 60s).
  const sweep = maybeSweepOpenTasks(db);
  const leadSupervisor = maybeEnqueueLeadSupervisorTicks(db);

  // Step 2: Atomically claim up to N queued runs (one per agent)
  const maxConcurrent = getTickMaxConcurrent();
  const claimedRuns = claimQueuedRunsForTick(db, maxConcurrent);

  if (claimedRuns.length === 0) {
    return {
      tickedAt,
      claimed: false,
      claimedCount: 0,
      runs: [],
      runId: null,
      agentId: null,
      status: "idle",
      error: null,
      durationMs: Date.now() - startTime,
      staleRunsRecovered,
      staleQueuedRunsRecovered,
      staleExecutionRunsRecovered,
      sweep: sweep ?? null,
      leadSupervisor: leadSupervisor ?? null,
    };
  }

  // Step 3: Execute all claimed runs concurrently.
  const settled = await Promise.allSettled(
    claimedRuns.map((c) => executeHeartbeatRun(c.id, db, { allowPreclaimedRunning: true }))
  );

  const runs: TickRunResult[] = claimedRuns.map((claimed, i) => {
    const result = settled[i];
    if (result.status === "fulfilled") {
      return {
        runId: claimed.id,
        agentId: claimed.agent_id,
        status: result.value.status,
        error: result.value.error,
      };
    }
    // Rejected: mark the run (and its wakeup request) as failed.
    const err = result.reason;
    const msg = err instanceof Error ? err.message : String(err);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE heartbeat_runs SET status = 'failed', finished_at = ?, error = ?, updated_at = ? WHERE id = ? AND status = 'running'`
    ).run(now, msg, now, claimed.id);
    if (claimed.wakeup_request_id) {
      db.prepare(
        `UPDATE agent_wakeup_requests SET status = 'failed', finished_at = ?, updated_at = ? WHERE id = ?`
      ).run(now, now, claimed.wakeup_request_id);
    }
    return {
      runId: claimed.id,
      agentId: claimed.agent_id,
      status: "failed",
      error: msg,
    };
  });

  const first = runs[0];
  return {
    tickedAt,
    claimed: true,
    claimedCount: runs.length,
    runs,
    runId: first.runId,
    agentId: first.agentId,
    status: first.status,
    error: first.error,
    durationMs: Date.now() - startTime,
    staleRunsRecovered,
    staleQueuedRunsRecovered,
    staleExecutionRunsRecovered,
    sweep: sweep ?? null,
    leadSupervisor: leadSupervisor ?? null,
  };
}

export const __testHooks = {
  claimNextQueuedRun,
  claimQueuedRunsForTick,
  getTickMaxConcurrent,
  maybeEnqueueNextReadyAssignedTaskForAgent,
  autoFlipTaskToReviewAfterMissingEndDeclaration,
};

function maybeResetTaskSessionForFreshAssignment(
  agentId: string,
  companyId: string,
  taskKey: string,
  contextSnapshot: Record<string, unknown>,
  db: Database.Database,
): void {
  if (!taskKey || taskKey === "__heartbeat__") return;

  const wakeSource = String(contextSnapshot.wakeSource ?? "").trim().toLowerCase();
  const wakeReason = String(contextSnapshot.wakeReason ?? "").trim().toLowerCase();
  const resetReasons = new Set([
    "issue_assigned",
    "task_created_in_progress",
    "mission_control_comment",
    "user_comment_on_assigned_task",
  ]);

  if (wakeSource !== "issue_assigned" && !resetReasons.has(wakeReason)) {
    return;
  }

  db.prepare(
    `UPDATE agent_task_sessions
     SET session_params_json = '{}', session_display_id = NULL, last_error = NULL, updated_at = ?
     WHERE company_id = ? AND agent_id = ? AND adapter_type = 'openclaw' AND task_key = ?`
  ).run(new Date().toISOString(), companyId, agentId, taskKey);
}

function persistAdapterFailureDiagnostic(
  db: Database.Database,
  runId: string,
  result: { error?: string; usage?: Record<string, unknown> | null },
): void {
  if (!result.error) return;
  const stored = db
    .prepare("SELECT result_json FROM heartbeat_runs WHERE id = ? LIMIT 1")
    .get(runId) as { result_json: string | null } | undefined;
  let current: Record<string, unknown> = {};
  try {
    current = stored?.result_json ? JSON.parse(stored.result_json) as Record<string, unknown> : {};
  } catch {
    current = {};
  }
  const usage = result.usage ?? {};
  const stderr = typeof usage.stderrTail === "string" ? usage.stderrTail : "";
  const command = typeof usage.command === "string"
    ? usage.command
    : typeof usage.cli === "string"
      ? usage.cli
      : null;
  const errors = Array.isArray(current.errors) ? current.errors : [];
  db.prepare("UPDATE heartbeat_runs SET result_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify({
      ...current,
      errors: [...errors, result.error],
      adapterFailure: {
        error: result.error,
        command,
        stderr,
      },
    }),
    new Date().toISOString(),
    runId,
  );
}

type SessionGetMessage = {
  role?: string;
  content?: string | Array<{ type?: string; text?: string; name?: string; arguments?: Record<string, unknown> }>;
};

async function importSessionOutputAndExecuteActions(input: {
  sessionKey: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  companyId: string;
  taskKey: string;
  wakeReason?: string;
  runId: string;
  executionRunId?: string | null;
  db: Database.Database;
  messageCountBefore: number;
  telemetry?: Record<string, unknown>;
}): Promise<ActionResults> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const results: ActionResults = {
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

  // Wait for session to reach terminal state (poll sessions.get)
  const thinkingStart = Date.now();
  emitRunEvent(input.runId, input.agentId, "waiting", "Waiting for agent to complete thinking", input.db);
  const sessionData = await waitForSessionCompletion(OPENCLAW_BIN, input.sessionKey, execFileAsync);
  const thinkingDurationMs = Date.now() - thinkingStart;
  if (input.telemetry) {
    input.telemetry.thinkingDurationMs = thinkingDurationMs;
  }
  if (!sessionData) {
    results.fatalError = MISSING_SESSION_OUTPUT_ERROR;
    results.errors.push(MISSING_SESSION_OUTPUT_ERROR);
    emitRunEvent(
      input.runId,
      input.agentId,
      "error",
      "FATAL: Session output could not be retrieved after execution. Marking run failed to stop continuation/retry waste.",
      input.db,
    );
    return results;
  }

  const sessionRecord = sessionData as Record<string, unknown>;
  if (sessionRecord.__sessionCompletionTimedOut === true) {
    results.fatalError = OPENCLAW_SESSION_TIMEOUT_ERROR;
    results.errors.push(OPENCLAW_SESSION_TIMEOUT_ERROR);
    if (input.telemetry) {
      input.telemetry.sessionCompletionTimedOut = true;
      input.telemetry.sessionOutputStatus = typeof sessionRecord.status === "string" ? sessionRecord.status : null;
      input.telemetry.sessionKey = input.sessionKey;
      input.telemetry.sessionId = input.sessionId;
    }
    emitRunEvent(
      input.runId,
      input.agentId,
      "error",
      "FATAL: OpenClaw session was still running at the import deadline. Marking run failed instead of importing partial progress as a final answer.",
      input.db,
    );
    return results;
  }

  // Extract assistant text messages — only from the NEW turn.
  // When reusing a session, messages[0..messageCountBefore-1] are from prior
  // runs and must be skipped to avoid re-importing old actions/reports.
  const allMessages: SessionGetMessage[] = (sessionData as Record<string, unknown>).messages as SessionGetMessage[] ?? [];
  let messages = allMessages.slice(input.messageCountBefore);
  let assistantTexts = extractAssistantTexts(messages);
  if (input.telemetry) {
    input.telemetry.sessionOutputStatus = typeof sessionRecord.status === "string" ? sessionRecord.status : null;
    input.telemetry.sessionMessageCount = allMessages.length;
    input.telemetry.newMessageCount = messages.length;
    input.telemetry.newAssistantTextCount = assistantTexts.length;
    input.telemetry.sessionKey = input.sessionKey;
    input.telemetry.sessionId = input.sessionId;
  }

  if (input.messageCountBefore > 0) {
    console.log(`[engine:import] session reuse — skipping ${input.messageCountBefore} prior messages, processing ${messages.length} new`);
  }

  let storedMessages = loadStoredSessionMessages(input.sessionId, input.sessionKey).slice(input.messageCountBefore);
  let storedAssistantTexts = extractAssistantTexts(storedMessages);

  const currentAssistantChars = assistantTexts.reduce((sum, text) => sum + text.length, 0);

  // Race guard: the gateway (sessions.get) can return "done" + pre-existing
  // message state on attempt=0 before the newly-created session has actually
  // written its assistant response to jsonl. Observed 2026-04-17 on Barometer:
  // live reported 8 msgs / 5637 chars / 0 actions while the same session's
  // jsonl landed 13s later with 1 clean msg / 2249 chars / 5 mc-action blocks.
  // When the live response looks action-free and stored is still empty, poll
  // the jsonl for up to 30s so the real turn can settle. No extra latency when
  // the live response already carries mc-action fences (trusted path).
  const liveHasFences = assistantTexts.some((text) => text.includes("```mc-action"));
  if (storedAssistantTexts.length === 0 && currentAssistantChars > 0 && !liveHasFences) {
    const pollStart = Date.now();
    const pollDeadline = pollStart + 30_000;
    while (Date.now() < pollDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      storedMessages = loadStoredSessionMessages(input.sessionId, input.sessionKey).slice(input.messageCountBefore);
      storedAssistantTexts = extractAssistantTexts(storedMessages);
      if (storedAssistantTexts.length > 0) {
        console.log(
          `[engine:import] jsonl settled after ${Math.round((Date.now() - pollStart) / 1000)}s for ${input.sessionKey} (gateway was action-free, stored now has ${storedAssistantTexts.length} msg${storedAssistantTexts.length !== 1 ? "s" : ""})`,
        );
        break;
      }
    }
  }

  const storedAssistantChars = storedAssistantTexts.reduce((sum, text) => sum + text.length, 0);
  if (input.telemetry) {
    input.telemetry.liveAssistantTextCount = assistantTexts.length;
    input.telemetry.liveAssistantChars = currentAssistantChars;
    input.telemetry.storedAssistantTextCount = storedAssistantTexts.length;
    input.telemetry.storedAssistantChars = storedAssistantChars;
  }

  // Prefer the stored (jsonl) transcript whenever it has content. OpenClaw's
  // jsonl is its own canonical append-only record; the gateway's sessions.get
  // cache can return fragmented or stale snapshots where a single assistant
  // turn is split across multiple text blocks. When a fence like
  // ```mc-action\n{...}\n``` straddles two blocks, the parser sees neither
  // complete block and drops all structured actions — exactly how Barometer's
  // 2026-04-17 WEA-262 retry lost 5 well-formed mc-action blocks (live
  // reported 8 text blocks / 5637 chars / 0 actions; the jsonl had 1 clean
  // block of 2786 chars / 5 actions).
  //
  // If the jsonl is empty (brand-new session before flush, or path resolution
  // miss), fall back to whatever the live gateway returned.
  const shouldUseStoredTranscript = storedAssistantTexts.length > 0;

  if (shouldUseStoredTranscript) {
    console.log(
      `[engine:import] using stored transcript for ${input.sessionKey} (stored: ${storedMessages.length} messages / ${storedAssistantChars} chars; live: ${messages.length} / ${currentAssistantChars})`,
    );
    messages = storedMessages;
    assistantTexts = storedAssistantTexts;
  }

  if (assistantTexts.length === 0) {
    results.fatalError = EMPTY_ASSISTANT_OUTPUT_ERROR;
    results.errors.push(EMPTY_ASSISTANT_OUTPUT_ERROR);
    if (input.telemetry) {
      input.telemetry.emptyAssistantOutput = true;
      input.telemetry.emptyOutputFailure = {
        reason: EMPTY_ASSISTANT_OUTPUT_ERROR,
        sessionKey: input.sessionKey,
        sessionId: input.sessionId,
        messageCountBefore: input.messageCountBefore,
        liveMessageCount: allMessages.length,
        storedAssistantTextCount: storedAssistantTexts.length,
      };
    }

    // Self-heal: force the NEXT wake onto a genuinely fresh session.
    //
    // Two signals are sent so the adapter layer has no way to silently
    // resume the degraded session:
    //   1. Null agent_runtime_state.session_id — adapter-agnostic
    //      "start clean" signal.
    //   2. Wipe the OpenClaw task-session params blob so the adapter's
    //      fresh-session branch runs instead of its resume branch.
    //
    // Round-2 of the 2026-04-17 live test proved (1) alone isn't enough:
    // the OpenClaw adapter used a deterministic session key, so even with
    // a null stored sessionId it silently fell back to the existing
    // OpenClaw-side session via a create-collision. Fix lands alongside
    // the adapter's new random-suffix-on-fresh-create behavior.
    resetAgentRuntimeSessionForSelfHeal(
      input.db,
      input.agentId,
      "empty_assistant_output",
    );
    // importSessionOutputAndExecuteActions is OpenClaw-specific today
    // (uses OPENCLAW_BIN + waitForSessionCompletion). When that path
    // becomes adapter-agnostic, plumb the adapter through; for now the
    // OpenClaw adapter's self-heal helper is the correct counterpart.
    getExecutionAdapter("openclaw").clearTaskSessionForSelfHeal(input.db, {
      companyId: input.companyId,
      agentId: input.agentId,
      taskKey: input.taskKey,
      reason: "empty_assistant_output",
    });

    emitRunEvent(
      input.runId,
      input.agentId,
      "error",
      "FATAL: Session completed with no assistant text output. Session reset; next wake will start fresh.",
      input.db,
    );
    return results;
  }

  return importAssistantTextsAndExecuteActions(
    {
      assistantTexts,
      agentId: input.agentId,
      agentName: input.agentName,
      companyId: input.companyId,
      taskKey: input.taskKey,
      wakeReason: input.wakeReason,
      runId: input.runId,
      executionRunId: input.executionRunId,
      db: input.db,
      telemetry: input.telemetry,
    },
    { messageLabel: "message" },
  );
}

/** Emit an in-flight event visible to the dashboard during execution */
function hasActiveHeartbeatForAgent(db: Database.Database, agentId: string): boolean {
  const row = db
    .prepare(
      `SELECT id
       FROM heartbeat_runs
       WHERE agent_id = ?
         AND status IN ('queued', 'running')
       LIMIT 1`,
    )
    .get(agentId) as { id: string } | undefined;
  return Boolean(row);
}

function hasActiveWakeOrRunForTask(db: Database.Database, taskId: string, taskKey?: string | null): boolean {
  const activeExecution = db
    .prepare(
      `SELECT id
       FROM execution_runs
       WHERE task_id = ?
         AND status IN ('pending', 'running')
       LIMIT 1`,
    )
    .get(taskId) as { id: string } | undefined;
  if (activeExecution) return true;

  const activeHeartbeats = db
    .prepare(
      `SELECT context_snapshot_json
       FROM heartbeat_runs
       WHERE status IN ('queued', 'running')`,
    )
    .all() as Array<{ context_snapshot_json: string | null }>;

  return activeHeartbeats.some((row) => {
    const target = wakeTargetFromJson(row.context_snapshot_json);
    return (
      target.taskId === taskId ||
      target.taskKey === taskId ||
      (Boolean(taskKey) && (target.taskId === taskKey || target.taskKey === taskKey))
    );
  });
}

function maybeEnqueueNextReadyAssignedTaskForAgent(input: {
  agentId: string;
  companyId: string;
  completedTaskId: string;
  currentTaskStatus: string | null;
  runId: string;
  db: Database.Database;
}): { queued: boolean; taskId: string | null; reason: string } {
  if (input.currentTaskStatus !== "done" && input.currentTaskStatus !== "review" && input.currentTaskStatus !== "blocked") {
    return { queued: false, taskId: null, reason: "current_task_still_active" };
  }

  const agent = input.db
    .prepare(
      `SELECT status, adapter_type
       FROM agents
       WHERE id = ? AND company_id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.agentId, input.companyId) as { status: string | null; adapter_type: string | null } | undefined;
  if (!agent) return { queued: false, taskId: null, reason: "agent_not_found" };
  if (agent.status === "paused" || agent.status === "offline" || agent.status === "error") {
    return { queued: false, taskId: null, reason: "agent_not_available" };
  }
  if (!isExecutableAgentRuntime(agent.adapter_type)) {
    return { queued: false, taskId: null, reason: "agent_runtime_not_executable" };
  }
  if (hasActiveHeartbeatForAgent(input.db, input.agentId)) {
    return { queued: false, taskId: null, reason: "agent_already_has_active_wake" };
  }

  const candidates = input.db
    .prepare(
      `SELECT t.id, t.task_key, t.project_id, t.depends_on_json, a.model AS assignee_model
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE p.company_id = ?
         AND t.archived_at IS NULL
         AND t.status = 'to-do'
         AND t.assignee_agent_id = ?
         AND t.id != ?
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         COALESCE(t.assigned_at, t.created_at) ASC,
         t.created_at ASC`,
    )
    .all(input.companyId, input.agentId, input.completedTaskId) as Array<{
      id: string;
      task_key: string | null;
      project_id: string;
      depends_on_json: string | null;
      assignee_model: string | null;
    }>;

  for (const candidate of candidates) {
    const dependencyIds = parseDependencyIds(candidate.depends_on_json);
    if (dependencyIds.length > 0 && pendingDependencyCount(input.db, dependencyIds) > 0) {
      continue;
    }
    if (hasActiveWakeOrRunForTask(input.db, candidate.id, candidate.task_key)) {
      continue;
    }

    const taskExecution = taskExecutionPolicyForWakeup({
      db: input.db,
      taskId: candidate.id,
      assigneeAdapterType: agent.adapter_type,
      assigneeModel: candidate.assignee_model,
    });
    if (!taskExecution.executionProvider) {
      continue;
    }

    const now = new Date().toISOString();
    input.db.prepare(
      `UPDATE tasks
       SET status = 'in_progress',
           blocked_reason = NULL,
           updated_at = ?
       WHERE id = ?
         AND status = 'to-do'
         AND archived_at IS NULL`,
    ).run(now, candidate.id);
    input.db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'to-do', 'in_progress', ?, ?)`,
    ).run(
      randomUUID(),
      candidate.project_id,
      candidate.id,
      input.agentId,
      JSON.stringify({
        source: "engine_next_ready_task_assignment",
        runId: input.runId,
        previousTaskId: input.completedTaskId,
      }),
      now,
    );

    enqueueWakeup(
      {
        agentId: input.agentId,
        companyId: input.companyId,
        source: "issue_assigned",
        reason: "engine_next_ready_task_assignment",
        payload: {
          taskId: candidate.id,
          taskStatus: "in_progress",
          projectId: candidate.project_id,
          executionEngine: taskExecution.executionEngine,
          modelLane: taskExecution.modelLane,
          executionProvider: taskExecution.executionProvider,
          runnerProvider: taskExecution.runnerProvider,
          modelRouting: taskExecution.modelRouting,
          modelRoutingLabel: taskExecution.modelRoutingLabel,
          activeHiveId: taskExecution.activeHiveId,
          activeHiveName: taskExecution.activeHiveName,
          continuedAfterTaskId: input.completedTaskId,
          continuedAfterRunId: input.runId,
        },
        idempotencyKey: `next-ready:${candidate.id}:${input.agentId}`,
      },
      input.db,
    );
    emitRunEvent(
      input.runId,
      input.agentId,
      "action_executed",
      `Queued next ready assigned task ${candidate.task_key ?? candidate.id} for this agent.`,
      input.db,
    );
    return { queued: true, taskId: candidate.id, reason: "queued" };
  }

  return { queued: false, taskId: null, reason: "no_ready_assigned_task" };
}


function moveTaskToReviewIfAwaitingApproval(
  taskId: string,
  agentId: string,
  runId: string,
  db: Database.Database,
): boolean {
  const pendingApprovalCount = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM approvals
       WHERE linked_task_id = ?
         AND status IN ('pending', 'revision_requested')`
    )
    .get(taskId) as { count: number } | undefined;

  if (!pendingApprovalCount || pendingApprovalCount.count === 0) {
    return false;
  }

  const task = db
    .prepare("SELECT id, project_id, status FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(taskId) as { id: string; project_id: string; status: string } | undefined;

  if (!task || task.status !== "in_progress") {
    return false;
  }

  const now = new Date().toISOString();
  const updated = db
    .prepare("UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ? AND status = 'in_progress'")
    .run(now, task.id);

  if (updated.changes === 0) {
    return false;
  }

  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.status_changed', ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    agentId,
    "in_progress",
    "review",
    JSON.stringify({ source: "engine_approval_hold", runId }),
    now,
  );

  return true;
}

function autoMarkTaskInProgressForExecutionRun(
  db: Database.Database,
  input: { taskId: string; agentId: string; runId: string; executionRunId: string; now?: string }
): void {
  const now = input.now ?? new Date().toISOString();
  const task = db
    .prepare("SELECT id, project_id, status, assignee_agent_id FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(input.taskId) as { id: string; project_id: string | null; status: string; assignee_agent_id: string | null } | undefined;
  if (!task || !["to-do", "backlog"].includes(task.status)) return;

  const changed = db
    .prepare(
      `UPDATE tasks
       SET status = 'in_progress',
           assignee_agent_id = COALESCE(assignee_agent_id, ?),
           assigned_at = COALESCE(assigned_at, ?),
           started_at = COALESCE(started_at, ?),
           consecutive_noop_wakes = 0,
           updated_at = ?
       WHERE id = ?
         AND status IN ('to-do', 'backlog')
         AND archived_at IS NULL`
    )
    .run(input.agentId, now, now, now, input.taskId);
  if (changed.changes === 0) return;

  db.prepare(
    `INSERT INTO task_events
       (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.status_changed', ?, 'in_progress', ?, ?)`
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    input.agentId,
    task.status,
    JSON.stringify({
      source: "engine_auto_claim_on_run_start",
      runId: input.runId,
      executionRunId: input.executionRunId,
    }),
    now,
  );

  refreshAgentLoad(db, input.agentId);
  if (task.assignee_agent_id && task.assignee_agent_id !== input.agentId) {
    refreshAgentLoad(db, task.assignee_agent_id);
  }
}

/* ── Run Finalization ── */

/* ─��� Task Key Resolution ── */

configureHeartbeatManagerDependencies({
  autoFlipTaskToReviewAfterMissingEndDeclaration,
  autoMarkTaskInProgressForExecutionRun,
  buildHeartbeatPrompt,
  checkAndTripCircuitBreaker,
  decideFinishRunContinuation,
  enqueueWakeup,
  importAssistantTextAndExecuteActions,
  importSessionOutputAndExecuteActions,
  loadStoredActionResults,
  maybeEnqueueNextReadyAssignedTaskForAgent,
  maybeResetTaskSessionForFreshAssignment,
  moveTaskToReviewIfAwaitingApproval,
  getActionResultsTerminalFailure,
  isInsufficientProgress,
  adapterActionTexts,
  persistAdapterFailureDiagnostic,
});

/* ── Query Helpers ── */

export {
  getHeartbeatRun,
  listHeartbeatRuns,
  listWakeupRequests,
} from "@/lib/orchestration/engine/engine-queries";

/* ── Shared Row Types ── */

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
