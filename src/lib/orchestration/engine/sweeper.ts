import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

import { enqueueWakeup, findCompanyCeo } from "@/lib/orchestration/engine/engine";
import { cleanupRunArtifacts } from "@/lib/orchestration/execution/cleanup";
import { latestTerminalRunAgentId, reconcileTerminalOpenClawTaskState } from "@/lib/orchestration/openclaw-reconciliation";
import { spawnPennyTriageMicroTask } from "@/lib/orchestration/triage/penny-triage";
import { isExecutableAgentRuntime } from "@/lib/orchestration/runtime-readiness";
import { backfillApprovalRoutes, cascadeResolvedApprovalsToLinkedTasks } from "@/lib/orchestration/service/approval";
import { resolveQueuedHeartbeatClaimCompanyId } from "@/lib/orchestration/service/dev-execution-test-mode";
import { parseProjectSettings, resolveTaskExecutionEngine } from "@/lib/orchestration/service/shared";
import { normalizeTaskModelLane } from "@/lib/orchestration/task-model-routing";
import type { TaskExecutionEngine, TaskModelLane } from "@/lib/orchestration/types";

/**
 * Orchestration sweeper: periodically scans open tasks (to-do / in_progress /
 * review) and enqueues wakes for the assigned agent if one isn't already in
 * flight. Terminates naturally when tasks reach done / cancelled / backlog or
 * get moved to blocked (blocked is treated as "waiting on something external"
 * and skipped).
 *
 * Design constraints:
 * - Per-task idempotency: `sweep:{taskId}:{status}` — multiple sweep cycles
 *   collapse into one queued wake until it is claimed.
 * - Per-agent concurrency: skip tasks whose assignee already has a queued or
 *   running wake. Another tick will pick them up when the prior run finishes.
 * - Loop guard: skip tasks with 3+ failed runs in the last hour. Chronic
 *   failures should not be re-woken forever — they require operator attention
 *   or a blocker comment before the sweep resumes.
 * - Agent state: paused/offline/archived agents never get swept.
 * - Cap: bounded number of wakes per sweep cycle to avoid bursty enqueues.
 */

export type SweepResult = {
  sweptAt: string;
  candidatesConsidered: number;
  wakesEnqueued: number;
  wakesCoalesced: number;
  skippedReasons: Record<string, number>;
};

type OpenTaskRow = {
  task_id: string;
  task_status: "to-do" | "in_progress" | "review";
  assignee_agent_id: string | null;
  eligible_assignee_ids: string | null;
  assignee_name: string | null;
  blocked_reason: string | null;
  project_id: string;
  task_title: string;
  task_type: string | null;
  task_priority: string | null;
  task_description: string | null;
  assigned_at: string | null;
  company_id: string;
  agent_status: string | null;
  agent_archived_at: string | null;
  agent_adapter_type: string | null;
  execution_engine: TaskExecutionEngine | null;
  model_lane: TaskModelLane | null;
  project_settings_json: string | null;
  company_settings_json: string | null;
};

type SweepTargetAgentRow = {
  adapter_type: string | null;
};

type RunnableAgentRow = {
  id: string;
  name: string;
  status: string | null;
  adapter_type: string | null;
};

type BackoffRecoveryTarget = {
  id: string;
  name: string;
  adapter_type: string | null;
  source: "eligible_assignee_backoff_rotation" | "triage_backoff_rotation" | "ceo_backoff_reroute";
};

type RunningProcessExecutionRow = {
  id: string;
  task_id: string;
  agent_id: string | null;
  provider: string;
  session_id: string | null;
  started_at: string | null;
  process_pid: number | null;
  token_usage_json: string | null;
  metadata_json: string | null;
};

type LinkedHeartbeatRow = {
  id: string;
  wakeup_request_id: string | null;
};

const DEFAULT_SWEEP_CAP = 10;
const BACKOFF_FAILED_RUN_THRESHOLD = 3;
const BACKOFF_WINDOW_MS = 60 * 60 * 1000; // 1h
const DEFAULT_REVIEW_ESCALATION_WINDOW_HOURS = 1;
const TO_DO_NO_STATUS_ESCALATION_MINUTES_BY_TYPE: Record<string, number> = {
  research: 5,
  triage: 5,
  planning: 5,
  feature: 30,
  bug: 30,
  qa: 15,
  verification: 15,
};
const DEFAULT_TO_DO_NO_STATUS_ESCALATION_MINUTES = 15;
const STALE_APPROVAL_WARNING_MS = 60 * 60 * 1000;
const STALE_ORPHAN_APPROVAL_SKIP_MS = 24 * 60 * 60 * 1000;
const STALE_ORPHAN_APPROVAL_CANCEL_MS = 7 * 24 * 60 * 60 * 1000;
const STUCK_AGENT_WARNING_MS = 60 * 60 * 1000;
const STUCK_AGENT_WORKING_ACTION_MS = 6 * 60 * 60 * 1000;
const STUCK_AGENT_IDLE_ACTION_MS = 24 * 60 * 60 * 1000;
const STUCK_AGENT_OFFLINE_MS = 48 * 60 * 60 * 1000;
const STUCK_AGENT_RECENT_TASK_ACTIVITY_MS = STUCK_AGENT_WARNING_MS;
const STUCK_AGENT_CREATION_UPDATE_GRACE_MS = 5 * 1000;
const STALE_PROCESS_FAILURE_CLASS = "stale_process_missing";
const STALE_PROCESS_ERROR_MESSAGE = "Failed: recorded execution process is no longer alive";

function parseMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

type ReviewEscalationSnapshot = {
  targetAgentId: string;
  targetAgentName: string;
  targetType: "oracle" | "ralph" | "ceo" | "unknown";
};

type EscalationReason = "no_review_response_within_window" | "reviewer_already_reviewed" | "no_declared_reviewer";

function isVerificationTask(row: Pick<OpenTaskRow, "task_title" | "task_type">): boolean {
  const type = (row.task_type ?? "").trim().toLowerCase();
  const title = row.task_title.trim().toLowerCase();
  return (
    type === "qa" ||
    type === "test" ||
    title.includes("qa verification") ||
    title.includes("verification")
  );
}

function isProcessPidAlive(pid: number | null | undefined): boolean {
  if (!Number.isInteger(pid) || !pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ESRCH") return false;
    return true;
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringFromJson(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function taskIdFromHeartbeatContext(value: string | null | undefined): string | null {
  const snapshot = parseJsonObject(value);
  const taskId = stringFromJson(snapshot.taskId) ?? stringFromJson(snapshot.taskKey);
  return taskId && taskId !== "__heartbeat__" ? taskId : null;
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findLinkedRunningHeartbeat(
  db: Database.Database,
  run: RunningProcessExecutionRow,
): LinkedHeartbeatRow | null {
  const tokenUsage = parseJsonObject(run.token_usage_json);
  const directHeartbeatRunId = stringFromJson(tokenUsage.heartbeatRunId);
  if (directHeartbeatRunId) {
    const direct = db
      .prepare(
        `SELECT id, wakeup_request_id
         FROM heartbeat_runs
         WHERE id = ? AND status = 'running'
         LIMIT 1`,
      )
      .get(directHeartbeatRunId) as LinkedHeartbeatRow | undefined;
    if (direct) return direct;
  }

  if (run.session_id) {
    const bySession = db
      .prepare(
        `SELECT id, wakeup_request_id
         FROM heartbeat_runs
         WHERE status = 'running'
           AND (? IS NULL OR agent_id = ?)
           AND (session_id_before = ? OR session_id_after = ?)
         ORDER BY COALESCE(started_at, created_at) DESC
         LIMIT 1`,
      )
      .get(run.agent_id, run.agent_id, run.session_id, run.session_id) as LinkedHeartbeatRow | undefined;
    if (bySession) return bySession;
  }

  const candidates = db
    .prepare(
      `SELECT id, wakeup_request_id, context_snapshot_json
       FROM heartbeat_runs
       WHERE status = 'running'
         AND (? IS NULL OR agent_id = ?)
       ORDER BY COALESCE(started_at, created_at) DESC`,
    )
    .all(run.agent_id, run.agent_id) as Array<LinkedHeartbeatRow & { context_snapshot_json: string | null }>;

  return candidates.find((candidate) => taskIdFromHeartbeatContext(candidate.context_snapshot_json) === run.task_id) ?? null;
}

function insertStaleProcessComment(
  db: Database.Database,
  input: { taskId: string; executionRunId: string; pid: number | null; heartbeatRunId: string | null; now: string },
): void {
  const externalRef = `engine:${STALE_PROCESS_FAILURE_CLASS}:${input.executionRunId}`;
  db.prepare(
    `INSERT INTO comments
      (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     SELECT ?, ?, NULL, ?, 'status_update', 'engine', ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM comments WHERE task_id = ? AND external_ref = ?)`,
  ).run(
    randomUUID(),
    input.taskId,
    `[ORCHESTRATION] Stale execution repaired: recorded PID ${input.pid ?? "unknown"} is no longer alive. Marked execution run ${input.executionRunId}${input.heartbeatRunId ? ` and heartbeat run ${input.heartbeatRunId}` : ""} failed so the task can be swept again.`,
    externalRef,
    input.now,
    input.now,
    input.taskId,
    externalRef,
  );
}

function clearAgentRunStateIfNoRunningExecutions(
  db: Database.Database,
  input: { agentId: string | null; taskId: string; executionRunId: string; now: string },
): void {
  if (!input.agentId) return;
  const hasOtherRunningRun = db
    .prepare(
      `SELECT 1
       FROM execution_runs
       WHERE agent_id = ?
         AND status = 'running'
         AND id <> ?
       LIMIT 1`,
    )
    .get(input.agentId, input.executionRunId);
  if (hasOtherRunningRun) return;

  db.prepare(
    `UPDATE agents
     SET status = 'idle',
         current_task_id = CASE WHEN current_task_id = ? THEN NULL ELSE current_task_id END,
         updated_at = ?
     WHERE id = ?
       AND status = 'working'`,
  ).run(input.taskId, input.now, input.agentId);
}

function enqueueReviewWakeAfterStaleRepair(
  db: Database.Database,
  input: { taskId: string; repairedExecutionRunId: string; now: Date },
): boolean {
  const row = db
    .prepare(
      `SELECT
         t.id AS task_id,
         t.status AS task_status,
         t.assignee_agent_id,
         t.execution_engine,
         t.model_lane,
         p.company_id,
         p.settings_json AS project_settings_json,
         c.settings_json AS company_settings_json,
         a.status AS agent_status,
         a.archived_at AS agent_archived_at,
         a.adapter_type AS agent_adapter_type
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       INNER JOIN companies c ON c.id = p.company_id
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE t.id = ?
         AND t.archived_at IS NULL
         AND p.archived_at IS NULL
         AND c.archived_at IS NULL
         AND c.status = 'active'
       LIMIT 1`,
    )
    .get(input.taskId) as
      | {
          task_id: string;
          task_status: string;
          assignee_agent_id: string | null;
          execution_engine: TaskExecutionEngine | null;
          model_lane: TaskModelLane | null;
          company_id: string;
          project_settings_json: string | null;
          company_settings_json: string | null;
          agent_status: string | null;
          agent_archived_at: string | null;
          agent_adapter_type: string | null;
        }
      | undefined;

  if (!row || row.task_status !== "review" || !row.assignee_agent_id) return false;
  if (row.agent_archived_at || row.agent_status === "paused" || row.agent_status === "offline") return false;
  if (!isExecutableAgentRuntime(row.agent_adapter_type)) return false;

  const staleBackoffSince = new Date(input.now.getTime() - BACKOFF_WINDOW_MS).toISOString();
  const recentStaleRepairs = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM execution_runs
       WHERE task_id = ?
         AND agent_id = ?
         AND status = 'failed'
         AND failure_class = ?
         AND COALESCE(completed_at, updated_at, created_at) > ?`,
    )
    .get(row.task_id, row.assignee_agent_id, STALE_PROCESS_FAILURE_CLASS, staleBackoffSince) as
      | { n: number }
      | undefined;
  if ((recentStaleRepairs?.n ?? 0) >= BACKOFF_FAILED_RUN_THRESHOLD) return false;

  const executionEngine = resolveTaskExecutionEngine({
    taskExecutionEngine: row.execution_engine,
    projectSettingsJson: row.project_settings_json,
    companySettingsJson: row.company_settings_json,
  }).engine;
  const modelLane = normalizeTaskModelLane(row.model_lane ?? "default");
  const executionProvider = executionEngine === "symphony" ? "symphony" : null;

  enqueueWakeup(
    {
      agentId: row.assignee_agent_id,
      companyId: row.company_id,
      source: "api",
      reason: "stale_review_execution_repaired",
      payload: {
        taskId: row.task_id,
        taskStatus: "review",
        assigneeAgentId: row.assignee_agent_id,
        repairedExecutionRunId: input.repairedExecutionRunId,
        staleProcessRepair: true,
        executionEngine,
        modelLane,
        ...(executionProvider ? { executionProvider } : {}),
      },
      idempotencyKey: `review_repair:${row.task_id}:${row.assignee_agent_id}:${input.repairedExecutionRunId}`,
    },
    db,
  );

  return true;
}

function recoverMissingProcessExecutionRuns(
  db: Database.Database,
  input: { now: Date; companySlugs?: string[] | null },
): number {
  const now = input.now.toISOString();
  const companyFilter = input.companySlugs && input.companySlugs.length > 0
    ? ` AND EXISTS (
          SELECT 1
          FROM tasks t
          INNER JOIN projects p ON p.id = t.project_id
          INNER JOIN companies c ON c.id = p.company_id
          WHERE t.id = er.task_id
            AND c.slug IN (${input.companySlugs.map(() => "?").join(",")})
        )`
    : "";
  const running = db
    .prepare(
      `SELECT er.id, er.task_id, er.agent_id, er.provider, er.session_id, er.started_at,
              er.process_pid, er.token_usage_json, er.metadata_json
       FROM execution_runs er
       WHERE er.status = 'running'
         AND er.process_pid IS NOT NULL${companyFilter}
       ORDER BY COALESCE(er.started_at, er.created_at) ASC`,
    )
    .all(...(input.companySlugs ?? [])) as RunningProcessExecutionRow[];

  let recovered = 0;
  for (const run of running) {
    if (isProcessPidAlive(run.process_pid)) continue;

    const heartbeat = findLinkedRunningHeartbeat(db, run);
    const startedAt = run.started_at ? Date.parse(run.started_at) : Number.NaN;
    const durationMs = Number.isFinite(startedAt)
      ? Math.max(0, input.now.getTime() - startedAt)
      : null;
    const metadata = parseMetadata(run.metadata_json);
    const repairMetadata = {
      ...metadata,
      heartbeatRunId: heartbeat?.id ?? metadata.heartbeatRunId ?? null,
      staleProcessRepair: {
        repairedAt: now,
        reason: STALE_PROCESS_FAILURE_CLASS,
        message: STALE_PROCESS_ERROR_MESSAGE,
        recordedPid: run.process_pid,
        heartbeatRunId: heartbeat?.id ?? null,
        likelyAppRestart: true,
      },
    };

    const tx = db.transaction(() => {
      const result = db.prepare(
        `UPDATE execution_runs
         SET status = 'failed',
             completed_at = ?,
             duration_ms = COALESCE(?, duration_ms),
             error_message = ?,
             failure_class = ?,
             process_pid = NULL,
             idempotency_key = NULL,
             metadata_json = ?,
             updated_at = ?
         WHERE id = ?
           AND status = 'running'
           AND process_pid = ?`,
      ).run(
        now,
        durationMs,
        STALE_PROCESS_ERROR_MESSAGE,
        STALE_PROCESS_FAILURE_CLASS,
        JSON.stringify(repairMetadata),
        now,
        run.id,
        run.process_pid,
      );

      if (result.changes === 0) return false;

      if (heartbeat) {
        db.prepare(
          `UPDATE heartbeat_runs
           SET status = 'failed',
               finished_at = ?,
               error = ?,
               updated_at = ?
           WHERE id = ?
             AND status = 'running'`,
        ).run(now, STALE_PROCESS_ERROR_MESSAGE, now, heartbeat.id);

        if (heartbeat.wakeup_request_id) {
          db.prepare(
            `UPDATE agent_wakeup_requests
             SET status = 'failed',
                 finished_at = ?,
                 idempotency_key = NULL,
                 updated_at = ?
             WHERE id = ?
               AND status = 'claimed'`,
          ).run(now, now, heartbeat.wakeup_request_id);
        }
      }

      if (run.session_id) {
        db.prepare(
          `UPDATE tasks
           SET execution_session_id = NULL,
               updated_at = ?
           WHERE id = ?
             AND execution_session_id = ?`,
        ).run(now, run.task_id, run.session_id);
      }

      insertStaleProcessComment(db, {
        taskId: run.task_id,
        executionRunId: run.id,
        pid: run.process_pid,
        heartbeatRunId: heartbeat?.id ?? null,
        now,
      });

      clearAgentRunStateIfNoRunningExecutions(db, {
        agentId: run.agent_id,
        taskId: run.task_id,
        executionRunId: run.id,
        now,
      });

      return true;
    });

    if (!tx()) continue;
    recovered += 1;
    cleanupRunArtifacts(run.id).catch(() => {});
    reconcileTerminalOpenClawTaskState(run.task_id, db);
    enqueueReviewWakeAfterStaleRepair(db, {
      taskId: run.task_id,
      repairedExecutionRunId: run.id,
      now: input.now,
    });
  }

  return recovered;
}

function parseEligibleAssigneeIds(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function agentHasRunningExecutionRun(db: Database.Database, agentId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM execution_runs WHERE agent_id = ? AND status = 'running' LIMIT 1")
    .get(agentId);
  return Boolean(row);
}

function pickCapableListStealTarget(
  db: Database.Database,
  input: { companyId: string; primaryAgentId: string; eligibleAssigneeIds: string[] }
): { id: string; name: string } | null {
  if (!agentHasRunningExecutionRun(db, input.primaryAgentId)) return null;
  const alternates = input.eligibleAssigneeIds.filter((id) => id && id !== input.primaryAgentId);
  if (!alternates.length) return null;
  const placeholders = alternates.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.status, a.archived_at, a.adapter_type,
              COUNT(er.id) AS running_runs
       FROM agents a
       LEFT JOIN execution_runs er
         ON er.agent_id = a.id
        AND er.status = 'running'
       WHERE a.company_id = ?
         AND a.id IN (${placeholders})
         AND a.archived_at IS NULL
       GROUP BY a.id
       ORDER BY running_runs ASC, lower(a.name) ASC`
    )
    .all(input.companyId, ...alternates) as Array<{ id: string; name: string; status: string | null; archived_at: string | null; adapter_type: string | null; running_runs: number }>;
  for (const row of rows) {
    if (row.archived_at || row.status === "paused" || row.status === "offline" || row.status === "error") continue;
    if (Number(row.running_runs ?? 0) > 0) continue;
    if (!isExecutableAgentRuntime(row.adapter_type)) continue;
    return { id: row.id, name: row.name };
  }
  return null;
}

function pickAlternateAssignee(
  db: Database.Database,
  input: { companyId: string; primaryAgentId: string | null; eligibleAssigneeIds: string[] }
): { id: string; name: string } | null {
  const alternates = input.eligibleAssigneeIds.filter((id) => id && id !== input.primaryAgentId);
  if (!alternates.length) return null;
  const placeholders = alternates.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.status, a.archived_at, a.adapter_type,
              COUNT(er.id) AS running_runs
       FROM agents a
       LEFT JOIN execution_runs er
         ON er.agent_id = a.id
        AND er.status = 'running'
       WHERE a.company_id = ?
         AND a.id IN (${placeholders})
         AND a.archived_at IS NULL
       GROUP BY a.id
       ORDER BY running_runs ASC, lower(a.name) ASC`,
    )
    .all(input.companyId, ...alternates) as Array<{
      id: string;
      name: string;
      status: string | null;
      archived_at: string | null;
      adapter_type: string | null;
      running_runs: number;
    }>;
  for (const row of rows) {
    if (row.archived_at || row.status === "paused" || row.status === "offline" || row.status === "error") continue;
    if (Number(row.running_runs ?? 0) > 0) continue;
    if (!isExecutableAgentRuntime(row.adapter_type)) continue;
    return { id: row.id, name: row.name };
  }
  return null;
}

function countRecentFailedHeartbeatRuns(
  db: Database.Database,
  input: { agentId: string; backoffSince: string; adapterType: string | null },
): number {
  const recentFailed = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM heartbeat_runs
       WHERE agent_id = ? AND status = 'failed'
         AND started_at > ?
         AND NOT (
           ? = 1
           AND error IS NOT NULL
           AND error LIKE 'Agent % has no executable runtime configured.%'
         )
         AND NOT (
           ? = 1
           AND error IS NOT NULL
           AND (
             error LIKE '%usage limit%'
             OR error LIKE '%rate limit%'
             OR error LIKE '%try again%'
             OR error LIKE '%failed with exit code unknown%'
             OR error LIKE '%codex exec failed with exit code 1%'
           )
         )`,
    )
    .get(
      input.agentId,
      input.backoffSince,
      isExecutableAgentRuntime(input.adapterType) ? 1 : 0,
      isExecutableAgentRuntime(input.adapterType) ? 1 : 0,
    ) as { n: number } | undefined;

  return recentFailed?.n ?? 0;
}

function pickBackoffRecoveryTarget(
  db: Database.Database,
  input: {
    row: OpenTaskRow;
    currentAgentId: string;
    backoffSince: string;
  },
): BackoffRecoveryTarget | null {
  const eligibleAlternate = pickAlternateAssignee(db, {
    companyId: input.row.company_id,
    primaryAgentId: input.currentAgentId,
    eligibleAssigneeIds: parseEligibleAssigneeIds(input.row.eligible_assignee_ids),
  });
  if (eligibleAlternate) {
    const runtime = db
      .prepare("SELECT adapter_type FROM agents WHERE id = ? AND archived_at IS NULL LIMIT 1")
      .get(eligibleAlternate.id) as SweepTargetAgentRow | undefined;
    if (
      runtime &&
      isExecutableAgentRuntime(runtime.adapter_type) &&
      countRecentFailedHeartbeatRuns(db, {
        agentId: eligibleAlternate.id,
        backoffSince: input.backoffSince,
        adapterType: runtime.adapter_type,
      }) < BACKOFF_FAILED_RUN_THRESHOLD
    ) {
      return {
        id: eligibleAlternate.id,
        name: eligibleAlternate.name,
        adapter_type: runtime.adapter_type,
        source: "eligible_assignee_backoff_rotation",
      };
    }
  }

  const runnableAgents = resolveRunnableAgentsForCompany(db, input.row.company_id)
    .filter((agent) => agent.id !== input.currentAgentId);
  const routedAgentId = resolveTriageTarget(
    {
      type: input.row.task_type,
      title: input.row.task_title ?? "",
      // First-pass triage intentionally refuses to auto-route critical work.
      // Backoff recovery is different: the task already has an accountable
      // assignee, and that assignee has repeatedly failed to execute. Use the
      // role/category routing table so the work can keep moving.
      priority: null,
    },
    runnableAgents,
  );
  const routedAgent = runnableAgents.find((agent) => agent.id === routedAgentId);
  if (
    routedAgent &&
    countRecentFailedHeartbeatRuns(db, {
      agentId: routedAgent.id,
      backoffSince: input.backoffSince,
      adapterType: routedAgent.adapter_type,
    }) < BACKOFF_FAILED_RUN_THRESHOLD
  ) {
    return {
      id: routedAgent.id,
      name: routedAgent.name,
      adapter_type: routedAgent.adapter_type,
      source: "triage_backoff_rotation",
    };
  }

  const ceo = findCompanyCeo(input.row.company_id, db);
  if (ceo && ceo.id !== input.currentAgentId) {
    const ceoRuntime = db
      .prepare("SELECT name, status, archived_at, adapter_type FROM agents WHERE id = ? LIMIT 1")
      .get(ceo.id) as { name: string; status: string | null; archived_at: string | null; adapter_type: string | null } | undefined;
    if (
      ceoRuntime &&
      !ceoRuntime.archived_at &&
      ceoRuntime.status !== "paused" &&
      ceoRuntime.status !== "offline" &&
      isExecutableAgentRuntime(ceoRuntime.adapter_type) &&
      countRecentFailedHeartbeatRuns(db, {
        agentId: ceo.id,
        backoffSince: input.backoffSince,
        adapterType: ceoRuntime.adapter_type,
      }) < BACKOFF_FAILED_RUN_THRESHOLD
    ) {
      return {
        id: ceo.id,
        name: ceoRuntime.name,
        adapter_type: ceoRuntime.adapter_type,
        source: "ceo_backoff_reroute",
      };
    }
  }

  return null;
}

function enqueueApprovalWakesForStaleApprovals(
  db: Database.Database,
  input: { now: Date; companySlugs?: string[] | null },
): number {
  const cutoff = new Date(input.now.getTime() - STALE_APPROVAL_WARNING_MS).toISOString();
  const orphanSkipCutoff = new Date(input.now.getTime() - STALE_ORPHAN_APPROVAL_SKIP_MS).toISOString();
  const orphanCancelCutoff = new Date(input.now.getTime() - STALE_ORPHAN_APPROVAL_CANCEL_MS).toISOString();
  const companyFilter = input.companySlugs && input.companySlugs.length > 0
    ? ` AND c.slug IN (${input.companySlugs.map(() => "?").join(",")})`
    : "";
  const cancelCompanyFilter = input.companySlugs && input.companySlugs.length > 0
    ? ` AND company_id IN (SELECT id FROM companies WHERE slug IN (${input.companySlugs.map(() => "?").join(",")}))`
    : "";
  const cancelResult = db
    .prepare(
      `UPDATE approvals
       SET status = 'cancelled',
           decision_note = 'auto-cancelled: stale orphan approval (no linked task, predates 7-day threshold).',
           decided_by_user_id = COALESCE(decided_by_user_id, 'system:stale-orphan-approval-sweeper'),
           decided_at = COALESCE(decided_at, ?),
           updated_at = ?
       WHERE status = 'pending'
         AND linked_task_id IS NULL
         AND created_at < ?
         ${cancelCompanyFilter}`,
    )
    .run(input.now.toISOString(), input.now.toISOString(), orphanCancelCutoff, ...(input.companySlugs ?? []));
  if (cancelResult.changes > 0) {
    console.warn("[orchestration] auto-cancelled stale orphan approvals", { count: cancelResult.changes });
  }

  const rows = db
    .prepare(
      `SELECT ap.id, ap.company_id, ap.type, ap.approver_agent_id, ap.approval_route_reason, ap.linked_task_id, ap.created_at
       FROM approvals ap
       INNER JOIN companies c ON c.id = ap.company_id
       WHERE ap.status = 'pending'
         AND ap.created_at < ?
         AND NOT (ap.linked_task_id IS NULL AND ap.created_at < ?)
         ${companyFilter}`,
    )
    .all(cutoff, orphanSkipCutoff, ...(input.companySlugs ?? [])) as Array<{
      id: string;
      company_id: string;
      type: string;
      approver_agent_id: string | null;
      approval_route_reason: string | null;
      linked_task_id: string | null;
      created_at: string;
    }>;

  const companyIds = new Set(rows.map((row) => row.company_id));
  for (const companyId of companyIds) {
    backfillApprovalRoutes({ companyIdOrSlug: companyId, status: "pending", force: true, db });
  }

  let enqueued = 0;
  const now = input.now.toISOString();
  for (const row of rows) {
    const routed = db
      .prepare("SELECT approver_agent_id, approval_route_reason FROM approvals WHERE id = ? LIMIT 1")
      .get(row.id) as { approver_agent_id: string | null; approval_route_reason: string | null } | undefined;
    const approverAgentId = routed?.approver_agent_id ?? row.approver_agent_id;
    if (!approverAgentId) continue;
    const result = enqueueWakeup(
      {
        agentId: approverAgentId,
        companyId: row.company_id,
        source: "api",
        reason: "approval_requested",
        payload: {
          approvalId: row.id,
          approvalType: row.type,
          routeReason: routed?.approval_route_reason ?? row.approval_route_reason ?? null,
          staleApprovalSweep: true,
        },
        idempotencyKey: `approval:${row.id}:${approverAgentId}`,
      },
      db,
    );
    if (result.status === "queued" || result.status === "coalesced") enqueued += 1;

    db.prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
       SELECT ?, ap.linked_task_id, NULL, ?, 'status_update', 'engine', ?, ?, ?
       FROM approvals ap
       WHERE ap.id = ?
         AND ap.linked_task_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM comments c
           WHERE c.task_id = ap.linked_task_id
             AND c.external_ref = ?
         )`,
    ).run(
      randomUUID(),
      `[APPROVAL_BLOCKED] Approval ${row.id} has been pending for more than 1 hour. Routed to approver wake queue for follow-up.`,
      `approval:stale:${row.id}`,
      now,
      now,
      row.id,
      `approval:stale:${row.id}`,
    );
  }
  return enqueued;
}

function hasRecentMeaningfulTaskActivity(input: {
  now: Date;
  createdAt: string | null;
  updatedAt: string | null;
  assignedAt: string | null;
}): boolean {
  const cutoffMs = input.now.getTime() - STUCK_AGENT_RECENT_TASK_ACTIVITY_MS;
  const createdAt = timestampMs(input.createdAt);
  const updatedAt = timestampMs(input.updatedAt);
  const assignedAt = timestampMs(input.assignedAt);
  const isAfterCreation = (value: number | null): boolean => {
    if (!value) return false;
    if (!createdAt) return true;
    return value - createdAt > STUCK_AGENT_CREATION_UPDATE_GRACE_MS;
  };

  return (
    Boolean(updatedAt && updatedAt >= cutoffMs && isAfterCreation(updatedAt)) ||
    Boolean(assignedAt && assignedAt >= cutoffMs && isAfterCreation(assignedAt))
  );
}

function hasFreshActiveWakeOrExecution(
  db: Database.Database,
  input: { taskId: string; taskKey: string | null; agentId: string; now: Date },
): boolean {
  const cutoff = new Date(input.now.getTime() - STUCK_AGENT_RECENT_TASK_ACTIVITY_MS).toISOString();
  const taskRef = input.taskKey && input.taskKey.trim() ? input.taskKey.trim() : input.taskId;

  const activeExecution = db
    .prepare(
      `SELECT 1
       FROM execution_runs
       WHERE task_id = ?
         AND agent_id = ?
         AND status IN ('pending', 'running')
         AND MAX(COALESCE(updated_at, ''), COALESCE(started_at, ''), COALESCE(created_at, '')) >= ?
       LIMIT 1`,
    )
    .get(input.taskId, input.agentId, cutoff);
  if (activeExecution) return true;

  const activeWake = db
    .prepare(
      `SELECT 1
       FROM agent_wakeup_requests awr
       LEFT JOIN heartbeat_runs hr ON hr.id = awr.run_id
       WHERE awr.agent_id = ?
         AND awr.status IN ('queued', 'claimed')
         AND MAX(
           COALESCE(awr.updated_at, ''),
           COALESCE(awr.claimed_at, ''),
           COALESCE(awr.requested_at, ''),
           COALESCE(awr.created_at, ''),
           COALESCE(hr.updated_at, ''),
           COALESCE(hr.started_at, ''),
           COALESCE(hr.created_at, '')
         ) >= ?
         AND (
           json_extract(awr.payload_json, '$.taskId') IN (?, ?)
           OR json_extract(awr.payload_json, '$.taskKey') IN (?, ?)
           OR json_extract(hr.context_snapshot_json, '$.taskId') IN (?, ?)
           OR json_extract(hr.context_snapshot_json, '$.taskKey') IN (?, ?)
         )
       LIMIT 1`,
    )
    .get(
      input.agentId,
      cutoff,
      input.taskId,
      taskRef,
      input.taskId,
      taskRef,
      input.taskId,
      taskRef,
      input.taskId,
      taskRef,
    );
  if (activeWake) return true;

  const activeHeartbeat = db
    .prepare(
      `SELECT 1
       FROM heartbeat_runs
       WHERE agent_id = ?
         AND status IN ('queued', 'running')
         AND MAX(COALESCE(updated_at, ''), COALESCE(started_at, ''), COALESCE(created_at, '')) >= ?
         AND (
           json_extract(context_snapshot_json, '$.taskId') IN (?, ?)
           OR json_extract(context_snapshot_json, '$.taskKey') IN (?, ?)
         )
       LIMIT 1`,
    )
    .get(input.agentId, cutoff, input.taskId, taskRef, input.taskId, taskRef);
  return Boolean(activeHeartbeat);
}

function sweepSilentAgents(
  db: Database.Database,
  input: { now: Date; companySlugs?: string[] | null },
): { comments: number; reassignments: number; offlineAgents: number } {
  const companyFilter = input.companySlugs && input.companySlugs.length > 0
    ? ` AND c.slug IN (${input.companySlugs.map(() => "?").join(",")})`
    : "";
  const rows = db
    .prepare(
      `SELECT
         t.id AS task_id,
         t.project_id,
         t.task_key,
         t.status AS task_status,
         t.title AS task_title,
         t.assigned_at AS task_assigned_at,
         t.created_at AS task_created_at,
         t.updated_at AS task_updated_at,
         t.eligible_assignee_ids,
         t.execution_engine,
         p.company_id,
         a.id AS agent_id,
         a.name AS agent_name,
         a.status AS agent_status,
         a.last_heartbeat AS last_heartbeat_at
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       INNER JOIN companies c ON c.id = p.company_id
       INNER JOIN agents a ON a.id = t.assignee_agent_id
       WHERE t.archived_at IS NULL
         AND p.archived_at IS NULL
         AND c.archived_at IS NULL
         AND c.status = 'active'
         AND t.status IN ('to-do', 'in_progress')
         AND a.status IN ('working', 'idle')
         ${companyFilter}`,
    )
    .all(...(input.companySlugs ?? [])) as Array<{
      task_id: string;
      project_id: string;
      task_key: string | null;
      task_status: string;
      task_title: string;
      task_assigned_at: string | null;
      task_created_at: string | null;
      task_updated_at: string | null;
      eligible_assignee_ids: string | null;
      execution_engine: TaskExecutionEngine | null;
      company_id: string;
      agent_id: string;
      agent_name: string;
      agent_status: string;
      last_heartbeat_at: string | null;
    }>;

  const now = input.now.toISOString();
  let comments = 0;
  let reassignments = 0;
  const offlineAgents = new Set<string>();

  for (const row of rows) {
    const heartbeatAt = row.last_heartbeat_at ? Date.parse(row.last_heartbeat_at) : 0;
    if (!heartbeatAt) continue;
    const ageMs = input.now.getTime() - heartbeatAt;
    const actionMs = row.agent_status === "working" ? STUCK_AGENT_WORKING_ACTION_MS : STUCK_AGENT_IDLE_ACTION_MS;

    if (ageMs < STUCK_AGENT_WARNING_MS) continue;

    if (
      hasRecentMeaningfulTaskActivity({
        now: input.now,
        createdAt: row.task_created_at,
        updatedAt: row.task_updated_at,
        assignedAt: row.task_assigned_at,
      }) ||
      hasFreshActiveWakeOrExecution(db, {
        taskId: row.task_id,
        taskKey: row.task_key,
        agentId: row.agent_id,
        now: input.now,
      })
    ) {
      continue;
    }

    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    const externalRef = `stuck-agent:warn:${row.task_id}:${row.agent_id}`;
    const inserted = db.prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
       SELECT ?, ?, NULL, ?, 'status_update', 'engine', ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM comments WHERE external_ref = ?)`,
    ).run(
      randomUUID(),
      row.task_id,
      `[STUCK_AGENT_WATCHDOG] Agent ${row.agent_name} has not heartbeated since ${row.last_heartbeat_at}. Will auto-reassign if no activity crosses the action threshold. Current silence: ${hours}h.`,
      externalRef,
      now,
      now,
      externalRef,
    );
    if (inserted.changes > 0) comments += 1;

    if (ageMs >= actionMs) {
      const alternate = pickAlternateAssignee(db, {
        companyId: row.company_id,
        primaryAgentId: row.agent_id,
        eligibleAssigneeIds: parseEligibleAssigneeIds(row.eligible_assignee_ids),
      });
      if (alternate) {
        db.prepare("UPDATE tasks SET assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
          .run(alternate.id, now, now, row.task_id);
        db.prepare(
          `INSERT INTO task_events
            (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
           VALUES (?, ?, ?, ?, 'task.reassigned', ?, ?)`,
        ).run(
          randomUUID(),
          row.project_id,
          row.task_id,
          alternate.id,
          JSON.stringify({
            source: "stuck_agent_watchdog",
            from: row.agent_id,
            to: alternate.id,
            executionEngine: row.execution_engine,
          }),
          now,
        );
        db.prepare(
          `INSERT INTO comments
            (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'status_update', 'engine', ?, ?, ?)`,
        ).run(
          randomUUID(),
          row.task_id,
          `[STUCK_AGENT_WATCHDOG] Auto-reassigned from ${row.agent_name} to ${alternate.name} due to stale heartbeat.`,
          `stuck-agent:reassign:${row.task_id}:${row.agent_id}:${alternate.id}:${now}`,
          now,
          now,
        );
        enqueueWakeup(
          {
            agentId: alternate.id,
            companyId: row.company_id,
            source: "api",
            reason: "stuck_agent_reassigned",
            payload: {
              taskId: row.task_id,
              taskStatus: row.task_status,
              previousAgentId: row.agent_id,
              executionEngine: row.execution_engine,
            },
            idempotencyKey: `stuck-agent:${row.task_id}:${alternate.id}`,
          },
          db,
        );
        reassignments += 1;
      }
    }

    if (ageMs >= STUCK_AGENT_OFFLINE_MS) {
      db.prepare("UPDATE agents SET status = 'offline', updated_at = ? WHERE id = ? AND status != 'offline'")
        .run(now, row.agent_id);
      offlineAgents.add(row.agent_id);
    }
  }

  return { comments, reassignments, offlineAgents: offlineAgents.size };
}

function sweepAutoCompleteFinishedSprints(
  db: Database.Database,
  input: { now: Date; companySlugs?: string[] | null },
): number {
  const companyFilter = input.companySlugs && input.companySlugs.length > 0
    ? ` AND c.slug IN (${input.companySlugs.map(() => "?").join(",")})`
    : "";
  const rows = db
    .prepare(
      `SELECT s.id, s.project_id, s.status, MIN(t.id) AS event_task_id, COUNT(t.id) AS task_count
       FROM sprints s
       INNER JOIN projects p ON p.id = s.project_id
       INNER JOIN companies c ON c.id = p.company_id
       INNER JOIN tasks t
         ON t.sprint_id = s.id
       AND t.archived_at IS NULL
       WHERE s.status IN ('planning', 'active')
         AND COALESCE(s.goal_kind, CASE WHEN s.parent_id IS NULL THEN 'company' ELSE 'sprint' END) = 'sprint'
         ${companyFilter}
       GROUP BY s.id
       HAVING COUNT(t.id) > 0
          AND SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) = COUNT(t.id)`,
    )
    .all(...(input.companySlugs ?? [])) as Array<{ id: string; project_id: string; status: string; event_task_id: string; task_count: number }>;

  if (rows.length === 0) return 0;
  const now = input.now.toISOString();
  const update = db.prepare(
    `UPDATE sprints
     SET status = 'completed',
         completed_at = COALESCE(completed_at, ?),
         updated_at = ?
     WHERE id = ?
       AND status IN ('planning', 'active')`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO task_events
      (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, NULL, 'system:sprint-sweeper', 'sprint.auto_completed', ?, 'completed', ?, ?)`,
  );

  let completed = 0;
  for (const row of rows) {
    const result = update.run(now, now, row.id);
    if (result.changes === 0) continue;
    insertEvent.run(
      randomUUID(),
      row.project_id,
      row.event_task_id,
      row.status,
      JSON.stringify({ sprintId: row.id, taskCount: row.task_count, source: "sweeper_all_tasks_done" }),
      now,
    );
    completed += 1;
  }
  return completed;
}

function latestTerminalExecutionRun(
  db: Database.Database,
  taskId: string,
): { agent_id: string | null; status: string; error_message: string | null; completed_at: string | null; created_at: string } | null {
  return db
    .prepare(
      `SELECT agent_id, status, error_message, completed_at, created_at
         FROM execution_runs
        WHERE task_id = ?
          AND status IN ('completed','failed','cancelled')
        ORDER BY completed_at DESC, created_at DESC
        LIMIT 1`,
    )
    .get(taskId) as
      | {
          agent_id: string | null;
          status: string;
          error_message: string | null;
          completed_at: string | null;
          created_at: string;
      }
      | undefined ?? null;
}

function resolveReviewEscalationWindowMs(row: Pick<OpenTaskRow, "project_settings_json" | "company_settings_json">): number {
  const projectSettings = parseProjectSettings(row.project_settings_json);
  const companySettings = parseProjectSettings(row.company_settings_json);
  const reviewHours = Math.max(
    0,
    projectSettings.staleAlertThresholdsHours.review,
    companySettings.staleAlertThresholdsHours.review,
    DEFAULT_REVIEW_ESCALATION_WINDOW_HOURS,
  );
  return Math.max(1, Math.floor(reviewHours * 60 * 60 * 1000));
}

function resolveToDoNoStatusEscalationWindowMs(row: Pick<OpenTaskRow, "task_type">): number {
  const type = (row.task_type ?? "").trim().toLowerCase();
  const minutes = TO_DO_NO_STATUS_ESCALATION_MINUTES_BY_TYPE[type] ?? DEFAULT_TO_DO_NO_STATUS_ESCALATION_MINUTES;
  return Math.max(1, minutes) * 60 * 1000;
}

function isOracleOrchestrator(roleOrName: string | null | undefined): boolean {
  const value = (roleOrName ?? "").trim().toLowerCase();
  return value === "oracle" || value.includes("product orchestrator") || value.includes("orchestration lead");
}

function isRalphAssignee(roleOrName: string | null | undefined): boolean {
  return (roleOrName ?? "").trim().toLowerCase() === "ralph";
}

function pickReviewEscalationTarget(
  db: Database.Database,
  companyId: string | null,
  currentAgentId: string | null
): ReviewEscalationSnapshot | null {
  if (!companyId) return null;

  const candidates = db
    .prepare(
      `SELECT id, name, role, status
       FROM agents
       WHERE company_id = ? AND archived_at IS NULL`,
    )
    .all(companyId) as Array<{ id: string; name: string; role: string; status: string }>;

  const oracle = candidates.find((agent) =>
    (agent.status === "working" || agent.status === "idle") &&
    (isOracleOrchestrator(agent.name) || isOracleOrchestrator(agent.role)),
  );
  if (oracle && oracle.id !== currentAgentId) {
    return {
      targetAgentId: oracle.id,
      targetAgentName: oracle.name,
      targetType: "oracle",
    };
  }

  const ralph = candidates.find((agent) =>
    (agent.status === "working" || agent.status === "idle") &&
    isRalphAssignee(agent.name),
  );
  if (ralph && ralph.id !== currentAgentId) {
    return {
      targetAgentId: ralph.id,
      targetAgentName: ralph.name,
      targetType: "ralph",
    };
  }

  const ceo = findCompanyCeo(companyId, db);
  if (!ceo || ceo.id === currentAgentId) return null;
  const ceoRuntime = candidates.find((agent) => agent.id === ceo.id);
  if (ceoRuntime && ceoRuntime.status !== "working" && ceoRuntime.status !== "idle") return null;

  return {
    targetAgentId: ceo.id,
    targetAgentName: ceo.name,
    targetType: "ceo",
  };
}

function buildReviewEscalationReason(params: {
  reason: EscalationReason;
  fromName: string;
  toName: string;
  ageMinutes: number;
  windowHours: number;
}): string {
  if (params.reason === "no_declared_reviewer") {
    return `Review watchdog: no declared reviewer was found. Escalating to ${params.toName}.`;
  }
  if (params.reason === "reviewer_already_reviewed") {
    return `Review watchdog: ${params.fromName} reviewed the current submission without a status change. Escalating to ${params.toName}.`;
  }
  return `Review watchdog: no review progress from ${params.fromName} within ${params.windowHours}h (${params.ageMinutes}m). Escalating to ${params.toName}.`;
}

function resolveRunnableAgentsForCompany(
  db: Database.Database,
  companyId: string,
): RunnableAgentRow[] {
  const rows = db
    .prepare(
      `SELECT id, name, status, adapter_type
         FROM agents
        WHERE company_id = ? AND archived_at IS NULL`,
    )
    .all(companyId) as RunnableAgentRow[];

  return rows.filter((agent) =>
    isExecutableAgentRuntime(agent.adapter_type) &&
    agent.status !== "paused" &&
    agent.status !== "offline"
  );
}

export function findAgentByName(
  runnableAgents: RunnableAgentRow[],
  name: string,
): RunnableAgentRow | undefined {
  const needle = name.trim().toLowerCase();
  return runnableAgents.find((agent) => agent.name.trim().toLowerCase() === needle);
}

function hasKeywordInText(text: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i").test(text);
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => hasKeywordInText(text, keyword));
}

function resolveTriageTarget(
  task: { type: string | null; title: string; priority: string | null },
  runnableAgents: RunnableAgentRow[],
): string | null {
  const normalizedType = (task.type ?? "").trim().toLowerCase();
  const normalizedPriority = (task.priority ?? "").trim().toLowerCase();
  const title = task.title;

  if (normalizedPriority === "critical") {
    return null;
  }

  if (normalizedType === "research") {
    return findAgentByName(runnableAgents, "Scout")?.id ?? null;
  }

  if (normalizedType === "qa" || normalizedType === "test") {
    return findAgentByName(runnableAgents, "Gator")?.id ?? null;
  }

  if (normalizedType === "content") {
    return findAgentByName(runnableAgents, "Prism")?.id ?? null;
  }

  if (normalizedType === "infrastructure") {
    return findAgentByName(runnableAgents, "Mannie")?.id ?? null;
  }

  if (normalizedType === "compliance") {
    return findAgentByName(runnableAgents, "Castor")?.id ?? null;
  }

  if (
    normalizedType === "bug" ||
    normalizedType === "feature" ||
    normalizedType === "implementation"
  ) {
    if (hasAnyKeyword(title, ["ui", "modal", "component", "page"])) {
      return findAgentByName(runnableAgents, "Samantha")?.id ?? null;
    }

    if (hasAnyKeyword(title, ["api", "schema", "database", "migration"])) {
      return findAgentByName(runnableAgents, "Mannie")?.id ?? null;
    }

    if (hasAnyKeyword(title, ["deploy", "release", "repo"])) {
      return findAgentByName(runnableAgents, "Ralph")?.id ?? null;
    }
  }

  return null;
}

function logTriageRoutingDecision(
  db: Database.Database,
  input: {
    taskId: string;
    taskType: string | null;
    taskPriority: string | null;
    assigneeAgentName: string | null;
    routedTo: string | null;
    routedToCeo: boolean;
    note: string;
  },
): void {
  const externalRef = `engine:triage_route:${input.taskId}`;
  const logged = db
    .prepare("SELECT 1 AS present FROM comments WHERE task_id = ? AND external_ref = ? LIMIT 1")
    .get(input.taskId, externalRef) as { present: number } | undefined;
  if (logged) return;

  const now = new Date().toISOString();
  const routeTarget = input.routedToCeo
    ? "CEO"
    : input.routedTo;
  const routedText = routeTarget
    ? ` routed to ${routeTarget}.`
    : ".";

  db.prepare(
    `INSERT INTO comments
      (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'comment', 'engine', ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.taskId,
    `[ORCHESTRATION] Fast triage decision for '${input.taskType ?? "unknown"}' (priority=${input.taskPriority ?? "normal"}, assignee=${input.assigneeAgentName ?? "unassigned"})${routedText} ${input.note}`,
    externalRef,
    now,
    now,
  );
}

function updateReviewEscalationAssignee(
  db: Database.Database,
  input: {
    taskId: string;
    newAssigneeId: string;
    reason: string;
  }
): boolean {
  const task = db
    .prepare(
      `SELECT id, project_id
       FROM tasks
       WHERE id = ? AND status = 'review' AND archived_at IS NULL
       LIMIT 1`
    )
    .get(input.taskId) as { id: string; project_id: string } | undefined;
  if (!task) return false;

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks
       SET assignee_agent_id = ?,
           assigned_at = ?,
           blocked_reason = ?,
           consecutive_noop_wakes = 0,
           updated_at = ?
       WHERE id = ? AND status = 'review'`,
    ).run(input.newAssigneeId, now, input.reason, now, task.id);

    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES
        (?, ?, ?, ?, 'engine', 'task.assigned', 'review', 'review', ?, ?)`,
    ).run(
      randomUUID(),
      task.project_id,
      task.id,
      input.newAssigneeId,
      JSON.stringify({
        source: "review_watchdog_escalation",
        newAssignee: input.newAssigneeId,
        reason: input.reason,
      }),
      now,
    );

    db.prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'comment', 'engine', ?, ?, ?)`,
    ).run(
      randomUUID(),
      task.id,
      `[REVIEW_WATCHDOG] ${input.reason}`,
      `engine:review_watchdog:${task.id}`,
      now,
      now,
    );
  });

  tx();
  return true;
}

function updateOnDeckNoStatusEscalationAssignee(
  db: Database.Database,
  input: {
    taskId: string;
    newAssigneeId: string;
    reason: string;
  },
): boolean {
  const task = db
    .prepare(
      `SELECT id, project_id, assignee_agent_id
       FROM tasks
       WHERE id = ? AND status = 'to-do' AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.taskId) as { id: string; project_id: string; assignee_agent_id: string | null } | undefined;
  if (!task || task.assignee_agent_id === input.newAssigneeId) return false;

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks
       SET assignee_agent_id = ?,
           assigned_at = ?,
           consecutive_noop_wakes = 0,
           updated_at = ?
       WHERE id = ? AND status = 'to-do'`,
    ).run(input.newAssigneeId, now, now, task.id);

    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.assigned', ?, ?)`,
    ).run(
      randomUUID(),
      task.project_id,
      task.id,
      input.newAssigneeId,
      JSON.stringify({
        source: "sweep_to-do_no_status_escalation",
        previousAssignee: task.assignee_agent_id,
        newAssignee: input.newAssigneeId,
        reason: input.reason,
      }),
      now,
    );

    db.prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'comment', 'engine', ?, ?, ?)`,
    ).run(
      randomUUID(),
      task.id,
      `[ORCHESTRATION] ${input.reason}`,
      `engine:to-do_no_status:${task.id}:${now}`,
      now,
      now,
    );
  });

  tx();
  return true;
}

function hasReviewerReworkAfterRun(
  db: Database.Database,
  input: { taskId: string; assigneeAgentId: string; latestRunAt: string },
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS present
       FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.status_changed'
         AND from_status = 'review'
         AND to_status IN ('to-do', 'in_progress')
         AND created_at > ?
         AND COALESCE(agent_id, '') <> ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(input.taskId, input.latestRunAt, input.assigneeAgentId) as
      | { present: number }
      | undefined;
  return row?.present === 1;
}

function latestReviewSubmission(
  db: Database.Database,
  taskId: string,
): { agent_id: string | null; created_at: string } | null {
  return db
    .prepare(
      `SELECT agent_id, created_at
       FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.status_changed'
         AND to_status = 'review'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(taskId) as { agent_id: string | null; created_at: string } | undefined ?? null;
}

function latestReviewAssignmentForAssignee(
  db: Database.Database,
  input: { taskId: string; assigneeAgentId: string },
): string | null {
  const row = db
    .prepare(
      `SELECT created_at
       FROM task_events
       WHERE task_id = ?
         AND event_type IN ('task.assigned', 'task.reassigned')
         AND (
           agent_id = ?
           OR json_extract(metadata_json, '$.assigneeId') = ?
           OR json_extract(metadata_json, '$.newAssignee') = ?
           OR json_extract(metadata_json, '$.to') = ?
         )
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(
      input.taskId,
      input.assigneeAgentId,
      input.assigneeAgentId,
      input.assigneeAgentId,
      input.assigneeAgentId,
    ) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

function laterTimestamp(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

function insertReviewFallbackComment(
  db: Database.Database,
  input: { taskId: string; now: string },
): void {
  db.prepare(
    `INSERT INTO comments
      (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'comment', 'engine', ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.taskId,
    "[REVIEW_FALLBACK] No escalation target available; routing back to current assignee.",
    `engine:review_fallback:${input.taskId}:${input.now}`,
    input.now,
    input.now,
  );
}

function agentHasReviewedCurrentSubmission(
  db: Database.Database,
  input: { taskId: string; agentId: string | null; submittedAt: string | null },
): boolean {
  if (!input.agentId) return false;
  const row = db
    .prepare(
      `SELECT 1 AS present FROM execution_runs
       WHERE task_id = ?
         AND agent_id = ?
         AND status IN ('completed','failed','cancelled')
         AND NOT (status = 'failed' AND failure_class = ?)
         AND (? IS NULL OR COALESCE(completed_at, created_at) > ?)
       LIMIT 1`,
    )
    .get(input.taskId, input.agentId, STALE_PROCESS_FAILURE_CLASS, input.submittedAt, input.submittedAt) as
      | { present: number }
      | undefined;
  return row?.present === 1;
}

function hasOpenChildTasks(db: Database.Database, taskId: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM tasks
       WHERE parent_task_id = ?
         AND archived_at IS NULL
         AND status NOT IN ('done', 'cancelled')`,
    )
    .get(taskId) as { n: number } | undefined;
  return (row?.n ?? 0) > 0;
}

function openChildTasksAllDependOnParent(db: Database.Database, taskId: string): boolean {
  const rows = db
    .prepare(
      `SELECT depends_on_json
       FROM tasks
       WHERE parent_task_id = ?
         AND archived_at IS NULL
         AND status NOT IN ('done', 'cancelled')`,
    )
    .all(taskId) as Array<{ depends_on_json: string | null }>;
  if (rows.length === 0) return false;
  return rows.every((row) => {
    try {
      const deps = JSON.parse(row.depends_on_json ?? "[]") as unknown;
      return Array.isArray(deps) && deps.includes(taskId);
    } catch {
      return false;
    }
  });
}

function markReviewNeedsHumanDecision(
  db: Database.Database,
  input: { taskId: string; agentId: string | null; now: string; reason: string },
): boolean {
  const task = db
    .prepare(
      `SELECT id, project_id, status
       FROM tasks
       WHERE id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.taskId) as { id: string; project_id: string; status: string } | undefined;
  if (!task || task.status !== "review") return false;

  const blockedReason =
    "Review loop guard: the current review submission has already been reviewed without a status change. " +
    "Human decision required to approve, reopen, reassign, or clarify the task.";

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks
       SET status = 'blocked',
           blocked_reason = ?,
           consecutive_noop_wakes = 0,
           updated_at = ?
       WHERE id = ? AND status = 'review'`,
    ).run(blockedReason, input.now, task.id);

    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'review', 'blocked', ?, ?)`,
    ).run(
      randomUUID(),
      task.project_id,
      task.id,
      input.agentId,
      JSON.stringify({
        source: "engine_review_loop_guard",
        reason: input.reason,
      }),
      input.now,
    );

    db.prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'blocker', 'engine', ?, ?, ?)`,
    ).run(
      randomUUID(),
      task.id,
      "[AWAITING_HUMAN] Review loop guard stopped this task: the current review submission was already reviewed without a status change. Please approve it, reopen it for rework, reassign it, or clarify what decision is needed.",
      `engine:review_loop_guard:${task.id}:${input.now}`,
      input.now,
      input.now,
    );
  });

  tx();
  return true;
}

/**
 * Optional company-slug allowlist read from MC_SWEEP_COMPANIES. Unset = sweep
 * every company (platform-wide orchestration). Set to a comma-separated list
 * of slugs to restrict the sweep — useful when you want stable focused on one
 * lane without touching code (e.g. "weather-edge-2").
 *
 * Unknown slugs are dropped rather than aborting; an empty effective list (all
 * values unknown) still sweeps nothing, which is the intended safety — if the
 * operator typoed every slug, we'd rather do nothing than silently fall back
 * to platform-wide.
 */
function readSweepCompanyAllowlist(): string[] | null {
  const raw = process.env.MC_SWEEP_COMPANIES?.trim();
  if (!raw) return null;
  const slugs = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return slugs.length > 0 ? slugs : null;
}

export function sweepOpenTasks(
  db: Database.Database,
  options: { cap?: number; now?: Date; companySlugs?: string[] | null } = {},
): SweepResult {
  const cap = options.cap ?? DEFAULT_SWEEP_CAP;
  const now = options.now ?? new Date();
  const sweptAt = now.toISOString();
  const backoffSince = new Date(now.getTime() - BACKOFF_WINDOW_MS).toISOString();
  const claimCompanyId = resolveQueuedHeartbeatClaimCompanyId(db);
  const companySlugs = options.companySlugs !== undefined
    ? options.companySlugs
    : readSweepCompanyAllowlist();

  const skippedReasons: Record<string, number> = {};
  const bumpSkip = (reason: string) => {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  };

  const staleProcessesRecovered = recoverMissingProcessExecutionRuns(db, { now, companySlugs });
  if (staleProcessesRecovered > 0) {
    skippedReasons.stale_process_missing = staleProcessesRecovered;
  }

  if (claimCompanyId === "__disabled__") {
    return {
      sweptAt,
      candidatesConsidered: 0,
      wakesEnqueued: 0,
      wakesCoalesced: 0,
      skippedReasons: {
        ...skippedReasons,
        dev_execution_test_mode_inactive: 1,
      },
    };
  }

  const approvalWakes = enqueueApprovalWakesForStaleApprovals(db, { now, companySlugs });
  if (approvalWakes > 0) {
    skippedReasons.stale_approval_wakes = approvalWakes;
  }
  const approvalCascades = cascadeResolvedApprovalsToLinkedTasks({ db, companySlugs });
  if (approvalCascades.changed > 0) {
    skippedReasons.resolved_approval_task_cascades = approvalCascades.changed;
  }
  const stuckAgentSweep = sweepSilentAgents(db, { now, companySlugs });
  if (stuckAgentSweep.comments > 0) skippedReasons.stuck_agent_watchdog_comments = stuckAgentSweep.comments;
  if (stuckAgentSweep.reassignments > 0) skippedReasons.stuck_agent_watchdog_reassignments = stuckAgentSweep.reassignments;
  if (stuckAgentSweep.offlineAgents > 0) skippedReasons.stuck_agent_watchdog_offline = stuckAgentSweep.offlineAgents;
  const completedSprints = sweepAutoCompleteFinishedSprints(db, { now, companySlugs });
  if (completedSprints > 0) skippedReasons.sprints_auto_completed = completedSprints;

  // Pull eligible open tasks + their assignee agent (LEFT JOIN so unassigned
  // tasks still come through — the CEO is the implicit triage target for
  // those, per product decision 2026-04-18). Done/cancelled/backlog and
  // blocked are filtered at the query level. Archived companies/projects
  // are excluded outright so stale demo fixtures can't keep burning agent
  // runs after they've been archived in the UI (observed 2026-04-17: four
  // archived "Detail Co …" rows kept showing up in sweep results because
  // nothing filtered them out).
  //
  // Unassigned eligibility covers to-do plus in_progress. An unassigned
  // in_progress task is a board anomaly, but leaving it invisible makes the
  // work look active while nobody owns it. Route it to the CEO/orchestrator
  // so it gets an accountable assignee or is handed off.
  const companyFilter = companySlugs && companySlugs.length > 0
    ? ` AND c.slug IN (${companySlugs.map(() => "?").join(",")})`
    : "";
  const claimCompanyFilter = claimCompanyId ? " AND p.company_id = ?" : "";
  const queryParams = [
    ...(claimCompanyId ? [claimCompanyId] : []),
    ...(companySlugs ?? []),
  ];
  const candidates = db
    .prepare(
      `SELECT
         t.id             AS task_id,
         t.status         AS task_status,
         t.assignee_agent_id,
         t.eligible_assignee_ids,
         t.project_id,
         a.name           AS assignee_name,
         t.title          AS task_title,
         t.type           AS task_type,
         t.priority       AS task_priority,
         t.description    AS task_description,
         t.assigned_at,
         t.blocked_reason,
         t.depends_on_json,
         p.company_id,
         a.status         AS agent_status,
         a.archived_at    AS agent_archived_at,
         a.adapter_type   AS agent_adapter_type,
         t.execution_engine,
         t.model_lane,
         p.settings_json  AS project_settings_json,
         c.settings_json  AS company_settings_json
       FROM tasks t
       INNER JOIN projects p  ON p.id = t.project_id
       INNER JOIN companies c ON c.id = p.company_id
       LEFT  JOIN agents a    ON a.id = t.assignee_agent_id
       WHERE t.archived_at IS NULL
         AND p.archived_at IS NULL
         AND c.archived_at IS NULL
         AND c.status = 'active'
         AND (
           (t.assignee_agent_id IS NOT NULL AND t.status IN ('to-do', 'in_progress', 'review'))
           OR (t.assignee_agent_id IS NULL AND t.status IN ('to-do', 'in_progress'))
         )
         AND NOT EXISTS (
           SELECT 1
             FROM goal_sprint_plan_drafts d
            WHERE d.planning_task_id = t.id
              AND d.status IN ('pending', 'approved')
         )
         -- Defensive: circuit breaker trips at 3 and flips task to blocked
         -- (which is already excluded by the status filter above). This is
         -- belt + suspenders in case a tripped task somehow stays in a
         -- sweep-eligible status.
         AND COALESCE(t.consecutive_noop_wakes, 0) < 3${claimCompanyFilter}${companyFilter}
       ORDER BY
         CASE t.status
           WHEN 'in_progress' THEN 0
           WHEN 'review' THEN 1
           WHEN 'to-do' THEN 2
         END,
         t.updated_at ASC`,
      )
    .all(...queryParams) as Array<OpenTaskRow & { depends_on_json: string | null }>;

  const runnableAgentsByCompany = new Map<string, RunnableAgentRow[]>();

  // G4 — pre-filter on dependsOn. Tasks whose declared deps are not all `done`
  // (or archived/deleted) are skipped from this sweep cycle. Leverages the
  // depends_on_json column on tasks. The check runs in TS rather than SQL so
  // we can emit a clean `dependency_pending` skip reason for telemetry.
  const depsBlockedTaskIds = new Set<string>();
  for (const row of candidates) {
    let deps: unknown;
    try {
      deps = JSON.parse(row.depends_on_json ?? "[]");
    } catch {
      deps = [];
    }
    if (!Array.isArray(deps) || deps.length === 0) continue;
    const depIds = (deps as unknown[]).filter((v): v is string => typeof v === "string" && v.length > 0);
    if (depIds.length === 0) continue;
    const placeholders = depIds.map(() => "?").join(",");
    const dependencyReadyClause = isVerificationTask(row)
      ? "status NOT IN ('done', 'review')"
      : "status != 'done'";
    const blocking = db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks
         WHERE id IN (${placeholders})
           AND archived_at IS NULL
           AND ${dependencyReadyClause}`,
      )
      .get(...depIds) as { n: number } | undefined;
    if ((blocking?.n ?? 0) > 0) {
      depsBlockedTaskIds.add(row.task_id);
    }
  }

  const approvalBlockedTaskIds = new Set<string>();
  if (candidates.length > 0) {
    const taskIds = candidates.map((row) => row.task_id);
    const placeholders = taskIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT DISTINCT linked_task_id
         FROM approvals
         WHERE linked_task_id IN (${placeholders})
           AND status IN ('pending', 'revision_requested')`,
      )
      .all(...taskIds) as Array<{ linked_task_id: string | null }>;
    for (const row of rows) {
      if (row.linked_task_id) approvalBlockedTaskIds.add(row.linked_task_id);
    }
  }

  let wakesEnqueued = 0;
  let wakesCoalesced = 0;

  for (const row of candidates) {
    if (wakesEnqueued + wakesCoalesced >= cap) {
      bumpSkip("cap_reached");
      continue;
    }

    if (row.blocked_reason === "triage_pending") {
      const openTriages = db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM tasks
            WHERE parent_task_id = ?
              AND type = 'triage'
              AND status NOT IN ('done', 'cancelled')`
        )
        .get(row.task_id) as { n: number } | undefined;
      if ((openTriages?.n ?? 0) > 0) {
        bumpSkip("triage_pending");
        continue;
      }

      db.prepare(
        `UPDATE tasks
           SET blocked_reason = NULL,
               updated_at = ?
         WHERE id = ?`
      ).run(sweptAt, row.task_id);
    }

    // G4 — task has unfinished `dependsOn` — defer wake until upstream tasks
    // close. Re-evaluated on every sweep cycle, so the moment all deps land
    // on `done`, the next sweep picks this task up.
    if (depsBlockedTaskIds.has(row.task_id)) {
      bumpSkip("dependency_pending");
      continue;
    }
    if (approvalBlockedTaskIds.has(row.task_id)) {
      bumpSkip("approval_pending");
      continue;
    }
    if (
      (row.task_status === "in_progress" || row.task_status === "review") &&
      hasOpenChildTasks(db, row.task_id) &&
      !openChildTasksAllDependOnParent(db, row.task_id)
    ) {
      bumpSkip("parent_waiting_on_children");
      continue;
    }

    // Four branches based on task state:
    //
    //  1. Unassigned to-do task — route to CEO for triage/assignment.
    //     Product decision 2026-04-18: "every unassigned task should be
    //     picked up by the CEO and routed." Closes the gap observed on
    //     WEA where a P0/critical task ("Be Productive") sat unassigned
    //     at the bottom of the TO-DO column indefinitely because sweep
    //     ignored unassigned tasks.
    //
    //  2. Review task with a declared reviewer (assignee != producer) —
    //     route to the declared assignee. Supports specialist→QA handoff
    //     (e.g. Kelvin produces, hands to Sentinel for QA via
    //     update_task status=review assignee=sentinel_id) before the
    //     CEO sees it. Observed 2026-04-24 on WEA-278: Sentinel was the
    //     declared reviewer but sweep routed to Barometer (CEO) because
    //     the review branch hardcoded CEO.
    //
    //  3. Review task with assignee == producer — route to CEO. The
    //     assignee-as-producer can't approve their own work; CEO is the
    //     default reviewer.
    //
    //  4. On_deck / in_progress with an assignee — target the assignee
    //     (unchanged baseline behavior).
    let targetAgentId: string | null = row.assignee_agent_id;
    let sweepReason:
      | "sweep_open_task"
      | "sweep_review_to_ceo"
      | "sweep_review_to_assignee"
      | "sweep_to-do_no_status_to_ceo"
      | "sweep_unassigned_to_ceo" = "sweep_open_task";
    let idempotencyKey = `sweep:${row.task_id}:${row.task_status}`;

    if (!row.assignee_agent_id) {
      // Unassigned to-do task — try a fast, static triage rule before CEO.
      if (row.task_status === "to-do") {
        let runnableAgents = runnableAgentsByCompany.get(row.company_id);
        if (!runnableAgents) {
          runnableAgents = resolveRunnableAgentsForCompany(db, row.company_id);
          runnableAgentsByCompany.set(row.company_id, runnableAgents);
        }

        const routedAgentId = resolveTriageTarget(
          {
            type: row.task_type,
            title: row.task_title ?? "",
            priority: row.task_priority,
          },
          runnableAgents,
        );

        if (routedAgentId) {
          targetAgentId = routedAgentId;
          const routedAgent = runnableAgents.find((agent) => agent.id === routedAgentId);
          logTriageRoutingDecision(db, {
            taskId: row.task_id,
            taskType: row.task_type,
            taskPriority: row.task_priority,
            assigneeAgentName: row.assignee_name,
            routedTo: routedAgent?.name ?? routedAgentId,
            routedToCeo: false,
            note: "Layer-1 static routing table matched",
          });
          sweepReason = "sweep_open_task";
        } else {
          const isCriticalPriority = (row.task_priority ?? "").trim().toLowerCase() === "critical";
          if (!isCriticalPriority) {
            const spawned = spawnPennyTriageMicroTask(
              db,
              {
                id: row.task_id,
                project_id: row.project_id,
                title: row.task_title,
                description: row.task_description,
              },
              runnableAgents,
            );
            if (spawned.spawned) {
              logTriageRoutingDecision(db, {
                taskId: row.task_id,
                taskType: row.task_type,
                taskPriority: row.task_priority,
                assigneeAgentName: row.assignee_name,
                routedTo: "Penny",
                routedToCeo: false,
                note: "No Layer-1 static triage match; routed via Penny triage micro-task.",
              });
              bumpSkip("penny_triage_micro_task_spawned");
              continue;
            }
          }
          const ceo = findCompanyCeo(row.company_id, db);
          if (!ceo) {
            bumpSkip("no_ceo_for_unassigned");
            continue;
          }
          // Self-loop guard: if CEO has already run on this task (triaged but
          // didn't assign), don't re-wake every cycle. Task waits for fresh
          // handoff (new comment, manual assignment, etc.).
          const latestRun = latestTerminalExecutionRun(db, row.task_id);
          const latestRunAgent = latestRun?.agent_id ?? null;
          if (latestRunAgent === ceo.id && latestRun?.status === "completed") {
            bumpSkip("ceo_recent_triage_no_assign");
            continue;
          }
          const ceoRow = db
            .prepare(
              `SELECT status, archived_at FROM agents WHERE id = ? LIMIT 1`,
            )
            .get(ceo.id) as { status: string; archived_at: string | null } | undefined;
          if (!ceoRow || ceoRow.archived_at) {
            bumpSkip("ceo_archived");
            continue;
          }
          if (ceoRow.status === "paused" || ceoRow.status === "offline") {
            bumpSkip(`ceo_${ceoRow.status}`);
            continue;
          }
          logTriageRoutingDecision(db, {
            taskId: row.task_id,
            taskType: row.task_type,
            taskPriority: row.task_priority,
            assigneeAgentName: row.assignee_name,
            routedTo: ceo.name,
            routedToCeo: true,
            note: "No Layer-1 static triage match; falling back to CEO.",
          });
          targetAgentId = ceo.id;
          sweepReason = "sweep_unassigned_to_ceo";
          idempotencyKey = `ceo_triage:${row.task_id}`;
        }
      } else {
        // Unassigned in_progress tasks are routed to CEO so they get an
        // accountable owner.
        const ceo = findCompanyCeo(row.company_id, db);
        if (!ceo) {
          bumpSkip("no_ceo_for_unassigned");
          continue;
        }

        const latestRun = latestTerminalExecutionRun(db, row.task_id);
        const ceoRow = db
          .prepare(
            `SELECT status, archived_at FROM agents WHERE id = ? LIMIT 1`,
          )
          .get(ceo.id) as { status: string; archived_at: string | null } | undefined;

        if (!ceoRow || ceoRow.archived_at) {
          bumpSkip("ceo_archived");
          continue;
        }
        if (ceoRow.status === "paused" || ceoRow.status === "offline") {
          bumpSkip(`ceo_${ceoRow.status}`);
          continue;
        }
        if (latestRun?.agent_id === ceo.id && latestRun?.status === "completed") {
          bumpSkip("ceo_recent_triage_no_assign");
          continue;
        }
        targetAgentId = ceo.id;
        sweepReason = "sweep_unassigned_to_ceo";
        idempotencyKey = `ceo_triage:${row.task_id}`;
      }
    } else if (row.task_status === "review") {
      // Producer = agent whose terminal run most recently touched this task.
      // Used both to route declared-reviewer handoffs (assignee != producer)
      // and to guard against self-review loops (assignee == producer).
      const latestSubmission = latestReviewSubmission(db, row.task_id);
      const producerAgentId = latestSubmission?.agent_id ?? latestTerminalRunAgentId(row.task_id, db);
      const reviewSubmissionAtMs = latestSubmission?.created_at ? Date.parse(latestSubmission.created_at) : null;
      const reviewEscalationWindowMs = resolveReviewEscalationWindowMs(row);
      const hasReviewSubmissionAt = reviewSubmissionAtMs !== null && Number.isFinite(reviewSubmissionAtMs);
      const reviewSubmissionAgeMs = hasReviewSubmissionAt
        ? Math.max(0, now.getTime() - reviewSubmissionAtMs)
        : 0;
      const reviewWindowHours = Math.max(1, Math.ceil(reviewEscalationWindowMs / (60 * 60 * 1000)));

      // CEO required to route fallback when no escalation target exists.
      const ceo = findCompanyCeo(row.company_id, db);
      if (!ceo) {
        bumpSkip("no_ceo_for_review");
        continue;
      }

      // Has the current assignee already reviewed the current submission?
      // Older reviewer runs from previous QA cycles should not force CEO
      // escalation after the producer has submitted revised work.
      const assigneeHasReviewedCurrentSubmission = agentHasReviewedCurrentSubmission(db, {
        taskId: row.task_id,
        agentId: row.assignee_agent_id,
        submittedAt: latestSubmission?.created_at ?? null,
      });
      const assigneeIsPotentialReviewer =
        row.assignee_agent_id !== null &&
        producerAgentId !== null &&
        row.assignee_agent_id !== producerAgentId;
      const latestReviewAssignmentAt = row.assignee_agent_id
        ? latestReviewAssignmentForAssignee(db, {
            taskId: row.task_id,
            assigneeAgentId: row.assignee_agent_id,
          })
        : null;
      const reviewerHeldSince = laterTimestamp(
        latestSubmission?.created_at ?? null,
        laterTimestamp(latestReviewAssignmentAt, row.assigned_at),
      );
      const reviewerHeldSinceMs = reviewerHeldSince ? Date.parse(reviewerHeldSince) : null;
      const reviewerHeldAgeMs = reviewerHeldSinceMs !== null && Number.isFinite(reviewerHeldSinceMs)
        ? Math.max(0, now.getTime() - reviewerHeldSinceMs)
        : reviewSubmissionAgeMs;
      const reviewerHeldAgeMinutes = Math.max(0, Math.floor(reviewerHeldAgeMs / (60 * 1000)));

      const assigneeNeedsWatchdogEscalation =
        assigneeIsPotentialReviewer &&
        row.assignee_agent_id !== ceo.id &&
        (assigneeHasReviewedCurrentSubmission || (hasReviewSubmissionAt && reviewerHeldAgeMs >= reviewEscalationWindowMs));
      const assigneeDisplayName = row.assignee_name ?? "Unknown reviewer";

      if (assigneeIsPotentialReviewer && !assigneeNeedsWatchdogEscalation) {
        // Route to the declared reviewer (Sentinel / QA / whoever the
        // producer handed to via update_task). Fresh reviewer — has never
        // run on this task. If the reviewer runs and emits narrative-only
        // (no status change), `assigneeHasPriorRun` becomes true on the
        // next sweep and watchdog escalates to the next escalation target.
        if (row.agent_archived_at) {
          bumpSkip("agent_archived");
          continue;
        }
        if (row.agent_status === "paused" || row.agent_status === "offline") {
          bumpSkip(`agent_${row.agent_status}`);
          continue;
        }
        targetAgentId = row.assignee_agent_id;
        sweepReason = "sweep_review_to_assignee";
        idempotencyKey = `review_assignee:${row.task_id}:${row.assignee_agent_id}`;
      } else if (assigneeNeedsWatchdogEscalation) {
        const escalationReason: EscalationReason = assigneeHasReviewedCurrentSubmission
          ? "reviewer_already_reviewed"
          : "no_review_response_within_window";
        // Preserve CEO self-loop behavior when CEO already reviewed the current
        // submission and no further review action is possible from the
        // existing run lineage.
        if (producerAgentId === ceo.id || agentHasReviewedCurrentSubmission(db, {
          taskId: row.task_id,
          agentId: ceo.id,
          submittedAt: latestSubmission?.created_at ?? null,
        })) {
          markReviewNeedsHumanDecision(db, {
            taskId: row.task_id,
            agentId: ceo.id,
            now: sweptAt,
            reason: "ceo_recent_review_no_close",
          });
          bumpSkip("ceo_recent_review_no_close");
          continue;
        }
        const escalationTarget = pickReviewEscalationTarget(
          db,
          row.company_id,
          row.assignee_agent_id,
        );
        if (!escalationTarget) {
          if (!assigneeHasReviewedCurrentSubmission && row.assignee_agent_id) {
            insertReviewFallbackComment(db, { taskId: row.task_id, now: sweptAt });
            targetAgentId = row.assignee_agent_id;
            sweepReason = "sweep_review_to_assignee";
            idempotencyKey = `review_assignee:${row.task_id}:${row.assignee_agent_id}`;
          } else {
            bumpSkip("no_review_escalation_target");
            continue;
          }
        } else {
          const updated = updateReviewEscalationAssignee(db, {
            taskId: row.task_id,
            newAssigneeId: escalationTarget.targetAgentId,
            reason: buildReviewEscalationReason({
              reason: escalationReason,
              fromName: assigneeDisplayName,
              toName: escalationTarget.targetAgentName,
              ageMinutes: assigneeHasReviewedCurrentSubmission ? Math.max(0, Math.floor(reviewSubmissionAgeMs / (60 * 1000))) : reviewerHeldAgeMinutes,
              windowHours: reviewWindowHours,
            }),
          });
          if (!updated) {
            bumpSkip("review_escalation_update_failed");
            continue;
          }
          targetAgentId = escalationTarget.targetAgentId;
          sweepReason = "sweep_review_to_ceo";
          idempotencyKey = `ceo_review:${row.task_id}:${escalationTarget.targetAgentId}`;
        }
      } else {
        if (ceo.id === row.assignee_agent_id) {
          bumpSkip("assignee_is_ceo_for_review");
          continue;
        }
        // CEO self-loop guard (see openclaw-reconciliation.ts for context):
        // if the most recent terminal run on this task was by the CEO, they
        // already reviewed and emitted no status change. Re-sweeping just
        // re-triggers the same narrative-only pattern at 60s cadence.
        if (producerAgentId === ceo.id || agentHasReviewedCurrentSubmission(db, {
          taskId: row.task_id,
          agentId: ceo.id,
          submittedAt: latestSubmission?.created_at ?? null,
        })) {
          markReviewNeedsHumanDecision(db, {
            taskId: row.task_id,
            agentId: ceo.id,
            now: sweptAt,
            reason: "ceo_recent_review_no_close",
          });
          bumpSkip("ceo_recent_review_no_close");
          continue;
        }
        const ceoRow = db
          .prepare(
            `SELECT status, archived_at FROM agents WHERE id = ? LIMIT 1`,
          )
          .get(ceo.id) as { status: string; archived_at: string | null } | undefined;
        if (!ceoRow || ceoRow.archived_at) {
          bumpSkip("ceo_archived");
          continue;
        }
        if (ceoRow.status === "paused" || ceoRow.status === "offline") {
          bumpSkip(`ceo_${ceoRow.status}`);
          continue;
        }
        targetAgentId = ceo.id;
        sweepReason = "sweep_review_to_ceo";
        idempotencyKey = `ceo_review:${row.task_id}:${ceo.id}`;
      }
    } else {
      if (row.agent_archived_at) {
        bumpSkip("agent_archived");
        continue;
      }
      if (row.agent_status === "paused" || row.agent_status === "offline") {
        bumpSkip(`agent_${row.agent_status}`);
        continue;
      }
      if (
        row.task_status === "to-do" &&
        row.assignee_agent_id
      ) {
        const latestRun = latestTerminalExecutionRun(db, row.task_id);
        const retryableRuntimeFailure =
          latestRun?.status === "failed" &&
          /runtime|provider|model|gemini|codex|anthropic|hermes|openclaw|no executable/i.test(latestRun.error_message ?? "");
        const retryableProgressFailure =
          latestRun?.status === "failed" &&
          /insufficient_progress_passive_report_only|no_op_resubmission/i.test(latestRun.error_message ?? "");
        // If the assignee just ran this to-do task and left it to-do,
        // sweeping them again only repeats the same wake. The task now needs
        // either an explicit status update, a human nudge, or a new comment.
        // Runtime/configuration failures are retryable after the operator fixes
        // the provider; otherwise the task can appear stuck even though the
        // underlying runtime is now healthy.
        const latestRunAt = latestRun?.completed_at ?? latestRun?.created_at ?? "";
        const reviewerRequestedRework =
          latestRun?.agent_id === row.assignee_agent_id &&
          latestRunAt.length > 0 &&
          hasReviewerReworkAfterRun(db, {
            taskId: row.task_id,
            assigneeAgentId: row.assignee_agent_id,
            latestRunAt,
          });
        if (
          latestRun?.agent_id === row.assignee_agent_id &&
          !retryableRuntimeFailure &&
          !retryableProgressFailure &&
          !reviewerRequestedRework
        ) {
          const statusAnchorAt = latestRunAt || row.assigned_at || "";
          const statusAnchorMs = statusAnchorAt ? Date.parse(statusAnchorAt) : NaN;
          const escalationWindowMs = resolveToDoNoStatusEscalationWindowMs(row);
          const statusAgeMs = Number.isFinite(statusAnchorMs)
            ? Math.max(0, now.getTime() - statusAnchorMs)
            : escalationWindowMs;
          if (statusAgeMs < escalationWindowMs) {
            bumpSkip("to-do_no_status_threshold_wait");
            continue;
          }
          const ceo = findCompanyCeo(row.company_id, db);
          if (!ceo) {
            bumpSkip("no_ceo_for_to-do_no_status");
            continue;
          }
          const ceoRow = db
            .prepare("SELECT status, archived_at FROM agents WHERE id = ? LIMIT 1")
            .get(ceo.id) as { status: string; archived_at: string | null } | undefined;
          if (!ceoRow || ceoRow.archived_at) {
            bumpSkip("ceo_archived");
            continue;
          }
          if (ceoRow.status === "paused" || ceoRow.status === "offline") {
            bumpSkip(`ceo_${ceoRow.status}`);
            continue;
          }
          if (ceo.id !== row.assignee_agent_id) {
            updateOnDeckNoStatusEscalationAssignee(db, {
              taskId: row.task_id,
              newAssigneeId: ceo.id,
              reason: `${row.assignee_name ?? "The assigned agent"} ran this To-Do task without moving it or leaving a terminal decision. Escalating to ${ceo.name} for rerouting.`,
            });
          }
          targetAgentId = ceo.id;
          sweepReason = "sweep_to-do_no_status_to_ceo";
          idempotencyKey = `ceo_to-do_no_status:${row.task_id}`;
        }
      }
    }

    if (!targetAgentId) {
      // Defensive invariant — every branch above sets targetAgentId or skips.
      bumpSkip("no_target_agent_resolved");
      continue;
    }

    if (row.task_status === "to-do" && row.assignee_agent_id && targetAgentId === row.assignee_agent_id) {
      const stealTarget = pickCapableListStealTarget(db, {
        companyId: row.company_id,
        primaryAgentId: row.assignee_agent_id,
        eligibleAssigneeIds: parseEligibleAssigneeIds(row.eligible_assignee_ids),
      });
      if (stealTarget) {
        db.prepare("UPDATE tasks SET assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
          .run(stealTarget.id, sweptAt, sweptAt, row.task_id);
        db.prepare(
          `INSERT INTO task_events
            (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
           VALUES (?, ?, ?, ?, 'task.reassigned', ?, ?)`
        ).run(
          randomUUID(),
          row.project_id,
          row.task_id,
          stealTarget.id,
          JSON.stringify({
            source: "capable_list_steal",
            from: row.assignee_agent_id,
            to: stealTarget.id,
            fromName: row.assignee_name,
            toName: stealTarget.name,
          }),
          sweptAt,
        );
        targetAgentId = stealTarget.id;
        idempotencyKey = `sweep:${row.task_id}:${row.task_status}:${stealTarget.id}`;
      }
    }

    let targetRuntime = db
      .prepare("SELECT adapter_type FROM agents WHERE id = ? AND archived_at IS NULL LIMIT 1")
      .get(targetAgentId) as SweepTargetAgentRow | undefined;

    if (!targetRuntime || !isExecutableAgentRuntime(targetRuntime.adapter_type)) {
      bumpSkip("agent_runtime_not_executable");
      continue;
    }

    const recentFailedCount = countRecentFailedHeartbeatRuns(db, {
      agentId: targetAgentId,
      backoffSince,
      adapterType: targetRuntime.adapter_type,
    });

    if (recentFailedCount >= BACKOFF_FAILED_RUN_THRESHOLD) {
      const recoveryTarget = pickBackoffRecoveryTarget(db, {
        row,
        currentAgentId: targetAgentId,
        backoffSince,
      });

      if (!recoveryTarget) {
        bumpSkip("agent_backoff");
        continue;
      }

      if (recoveryTarget.id !== row.assignee_agent_id) {
        db.prepare("UPDATE tasks SET assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
          .run(recoveryTarget.id, sweptAt, sweptAt, row.task_id);
        db.prepare(
          `INSERT INTO task_events
            (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
           VALUES (?, ?, ?, ?, 'task.reassigned', ?, ?)`,
        ).run(
          randomUUID(),
          row.project_id,
          row.task_id,
          recoveryTarget.id,
          JSON.stringify({
            source: recoveryTarget.source,
            from: targetAgentId,
            to: recoveryTarget.id,
            fromName: row.assignee_name,
            toName: recoveryTarget.name,
            failedRunsInWindow: recentFailedCount,
            backoffWindowMs: BACKOFF_WINDOW_MS,
          }),
          sweptAt,
        );
        db.prepare(
          `INSERT INTO comments
            (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'status_update', 'engine', ?, ?, ?)`,
        ).run(
          randomUUID(),
          row.task_id,
          `[ESCALATION] Reassigned from ${row.assignee_name ?? targetAgentId} to ${recoveryTarget.name} after ${recentFailedCount} failed runs in the backoff window. Reason: ${recoveryTarget.source}.`,
          `agent-backoff:reassign:${row.task_id}:${targetAgentId}:${recoveryTarget.id}:${sweptAt}`,
          sweptAt,
          sweptAt,
        );
      }

      targetAgentId = recoveryTarget.id;
      targetRuntime = { adapter_type: recoveryTarget.adapter_type };
      idempotencyKey = `agent_backoff_recovery:${row.task_id}:${targetAgentId}:${row.task_status}`;
    }

    const activeWake = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM agent_wakeup_requests
         WHERE agent_id = ? AND status IN ('queued', 'claimed')`,
      )
      .get(targetAgentId) as { n: number } | undefined;

    if ((activeWake?.n ?? 0) > 0) {
      bumpSkip("agent_has_active_wake");
      continue;
    }

    const activeRun = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM heartbeat_runs
         WHERE agent_id = ? AND status = 'running'`,
      )
      .get(targetAgentId) as { n: number } | undefined;

    if ((activeRun?.n ?? 0) > 0) {
      bumpSkip("agent_has_running_run");
      continue;
    }

    const executionEngine = resolveTaskExecutionEngine({
      taskExecutionEngine: row.execution_engine,
      projectSettingsJson: row.project_settings_json,
      companySettingsJson: row.company_settings_json,
    }).engine;
    const modelLane = normalizeTaskModelLane(row.model_lane ?? "default");
    const executionProvider = executionEngine === "symphony" ? "symphony" : null;

    const result = enqueueWakeup(
      {
        agentId: targetAgentId,
        companyId: row.company_id,
        source: "api",
        reason: sweepReason,
        payload: {
          taskId: row.task_id,
          taskStatus: row.task_status,
          executionEngine,
          modelLane,
          ...(executionProvider ? { executionProvider } : {}),
          sweptAt,
          ...(sweepReason === "sweep_review_to_ceo" ||
          sweepReason === "sweep_review_to_assignee"
            ? { assigneeAgentId: row.assignee_agent_id }
            : {}),
        },
        idempotencyKey,
      },
      db,
    );

    if (result.status === "coalesced") {
      wakesCoalesced += 1;
    } else {
      wakesEnqueued += 1;
    }
  }

  return {
    sweptAt,
    candidatesConsidered: candidates.length,
    wakesEnqueued,
    wakesCoalesced,
    skippedReasons,
  };
}

/**
 * Caller-scoped scheduler for periodic sweeps. Engine tick fires every ~10s;
 * the sweeper is more expensive and only needs to fire once a minute. In-memory
 * `lastSweepAt` is fine: on process restart the sweep just fires on the first
 * tick after the server comes up, which is the right behavior.
 */
let lastSweepAt = 0;

const SWEEP_INTERVAL_MS = (() => {
  const raw = process.env.MC_SWEEP_INTERVAL_MS;
  if (!raw) return 60_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
})();

export function maybeSweepOpenTasks(db: Database.Database): SweepResult | null {
  if (process.env.MC_ORCHESTRATION_SWEEP === "0") {
    return null;
  }
  const nowMs = Date.now();
  if (nowMs - lastSweepAt < SWEEP_INTERVAL_MS) {
    return null;
  }
  lastSweepAt = nowMs;
  return sweepOpenTasks(db, { now: new Date(nowMs) });
}

// Exposed for testing only — lets tests force a sweep regardless of cadence.
export const __sweeperTestHooks = {
  resetLastSweepAt: () => {
    lastSweepAt = 0;
  },
};
