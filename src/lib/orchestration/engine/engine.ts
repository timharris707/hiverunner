/**
 * Company Operating Engine
 *
 * This is the core engine that makes a Mission Control company actually run
 * like Paperclip: CEO receives direction, hires agents, assigns work, and
 * agents execute with persistent sessions and heartbeat-driven wake cycles.
 *
 * Runtime model: OpenClaw gateway sessions (same as existing MC execution).
 * Session persistence: agent_task_sessions table stores per-task session state.
 * Heartbeat model: Wakeup requests queue → heartbeat runs → adapter execution.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";

/* ── Constants ── */

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const ONBOARDING_DIR = path.join(__dirname, "onboarding-assets");

/* ── Types ── */

export type WakeupSource = "timer" | "issue_assigned" | "routine" | "explicit" | "api" | "kickoff";
export type WakeupStatus = "queued" | "claimed" | "finished" | "failed";
export type HeartbeatRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
export type InvocationSource = "on_demand" | "timer" | "issue_assigned" | "wakeup_request" | "kickoff";

export interface WakeupRequest {
  id: string;
  agentId: string;
  companyId: string;
  source: WakeupSource;
  reason: string | null;
  triggerDetail: string | null;
  payload: Record<string, unknown>;
  status: WakeupStatus;
  coalescedCount: number;
  idempotencyKey: string | null;
  runId: string | null;
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
}

export interface HeartbeatRun {
  id: string;
  agentId: string;
  companyId: string;
  invocationSource: InvocationSource;
  triggerDetail: string | null;
  status: HeartbeatRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  wakeupRequestId: string | null;
  sessionIdBefore: string | null;
  sessionIdAfter: string | null;
  usage: Record<string, unknown>;
  result: Record<string, unknown>;
  exitCode: number | null;
  error: string | null;
  contextSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface TaskSession {
  id: string;
  agentId: string;
  companyId: string;
  adapterType: string;
  taskKey: string;
  sessionParams: Record<string, unknown>;
  sessionDisplayId: string | null;
  lastRunId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeState {
  agentId: string;
  companyId: string;
  adapterType: string;
  sessionId: string | null;
  state: Record<string, unknown>;
  lastRunId: string | null;
  lastRunStatus: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  lastError: string | null;
}

export interface KickoffResult {
  companyId: string;
  ceoAgentId: string;
  directionTaskId: string | null;
  wakeupRequestId: string;
  heartbeatRunId: string;
  status: "queued" | "no_ceo" | "already_active";
  message: string;
}

export interface EnqueueWakeupResult {
  wakeupRequestId: string;
  heartbeatRunId: string;
  status: "queued" | "coalesced";
}

export interface ExecuteHeartbeatResult {
  runId: string;
  agentId: string;
  status: HeartbeatRunStatus;
  sessionId: string | null;
  error: string | null;
  durationMs: number;
}

/* ── Helpers ── */

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/* ── Onboarding Asset Loading ── */

function resolveOnboardingDir(): string {
  // Try relative to this file first (works in dev), then fallback to cwd-based path
  const candidates = [
    ONBOARDING_DIR,
    path.join(process.cwd(), "src/lib/orchestration/engine/onboarding-assets"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

export function loadOnboardingAssets(role: string): Record<string, string> {
  const baseDir = resolveOnboardingDir();
  const roleDir = role === "ceo" ? path.join(baseDir, "ceo") : path.join(baseDir, "default");
  const assets: Record<string, string> = {};

  if (!fs.existsSync(roleDir)) return assets;

  for (const file of fs.readdirSync(roleDir)) {
    if (!file.endsWith(".md")) continue;
    try {
      assets[file] = fs.readFileSync(path.join(roleDir, file), "utf8").trim();
    } catch {
      // Skip unreadable files
    }
  }
  return assets;
}

/* ── CEO Resolution ── */

export function findCompanyCeo(
  companyId: string,
  db = getOrchestrationDb()
): { id: string; name: string; role: string } | null {
  // Find agent with role 'ceo' (case-insensitive) in this company
  const row = db
    .prepare(
      `SELECT id, name, role FROM agents
       WHERE company_id = ? AND archived_at IS NULL
         AND LOWER(TRIM(role)) = 'ceo'
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get(companyId) as { id: string; name: string; role: string } | undefined;
  return row ?? null;
}

/* ── Wakeup Queue ── */

export function enqueueWakeup(
  input: {
    agentId: string;
    companyId: string;
    source: WakeupSource;
    reason?: string;
    triggerDetail?: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
    invocationSource?: InvocationSource;
    contextSnapshot?: Record<string, unknown>;
  },
  db = getOrchestrationDb()
): EnqueueWakeupResult {
  const now = new Date().toISOString();

  // Check for existing queued wakeup we can coalesce
  if (input.idempotencyKey) {
    const existing = db
      .prepare(
        `SELECT id, run_id FROM agent_wakeup_requests
         WHERE idempotency_key = ? AND status = 'queued'
         LIMIT 1`
      )
      .get(input.idempotencyKey) as { id: string; run_id: string | null } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE agent_wakeup_requests
         SET coalesced_count = coalesced_count + 1, updated_at = ?
         WHERE id = ?`
      ).run(now, existing.id);
      return {
        wakeupRequestId: existing.id,
        heartbeatRunId: existing.run_id ?? "",
        status: "coalesced",
      };
    }
  }

  const wakeupId = randomUUID();
  const runId = randomUUID();

  const invSource = input.invocationSource ?? mapSourceToInvocation(input.source);
  const snapshot = input.contextSnapshot ?? {
    wakeSource: input.source,
    wakeReason: input.reason ?? null,
    ...(input.payload ?? {}),
  };

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, trigger_detail, payload_json, status, idempotency_key, run_id, requested_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`
  ).run(
    wakeupId,
    input.agentId,
    input.companyId,
    input.source,
    input.reason ?? null,
    input.triggerDetail ?? null,
    JSON.stringify(input.payload ?? {}),
    input.idempotencyKey ?? null,
    runId,
    now,
    now,
    now
  );

  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status, wakeup_request_id, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
  ).run(
    runId,
    input.agentId,
    input.companyId,
    invSource,
    input.triggerDetail ?? null,
    wakeupId,
    JSON.stringify(snapshot),
    now,
    now
  );

  return { wakeupRequestId: wakeupId, heartbeatRunId: runId, status: "queued" };
}

function mapSourceToInvocation(source: WakeupSource): InvocationSource {
  switch (source) {
    case "timer":
      return "timer";
    case "issue_assigned":
      return "issue_assigned";
    case "kickoff":
      return "kickoff";
    default:
      return "wakeup_request";
  }
}

/* ── Session Management ── */

export function getOrCreateTaskSession(
  input: {
    agentId: string;
    companyId: string;
    adapterType?: string;
    taskKey: string;
  },
  db = getOrchestrationDb()
): TaskSession {
  const adapter = input.adapterType ?? "openclaw";
  const existing = db
    .prepare(
      `SELECT id, agent_id, company_id, adapter_type, task_key,
              session_params_json, session_display_id, last_run_id, last_error,
              created_at, updated_at
       FROM agent_task_sessions
       WHERE company_id = ? AND agent_id = ? AND adapter_type = ? AND task_key = ?
       LIMIT 1`
    )
    .get(input.companyId, input.agentId, adapter, input.taskKey) as TaskSessionRow | undefined;

  if (existing) return mapTaskSessionRow(existing);

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_task_sessions
       (id, agent_id, company_id, adapter_type, task_key, session_params_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`
  ).run(id, input.agentId, input.companyId, adapter, input.taskKey, now, now);

  return {
    id,
    agentId: input.agentId,
    companyId: input.companyId,
    adapterType: adapter,
    taskKey: input.taskKey,
    sessionParams: {},
    sessionDisplayId: null,
    lastRunId: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTaskSession(
  sessionId: string,
  patch: {
    sessionParams?: Record<string, unknown>;
    sessionDisplayId?: string;
    lastRunId?: string;
    lastError?: string | null;
  },
  db = getOrchestrationDb()
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_task_sessions
     SET session_params_json = COALESCE(?, session_params_json),
         session_display_id = COALESCE(?, session_display_id),
         last_run_id = COALESCE(?, last_run_id),
         last_error = COALESCE(?, last_error),
         updated_at = ?
     WHERE id = ?`
  ).run(
    patch.sessionParams ? JSON.stringify(patch.sessionParams) : null,
    patch.sessionDisplayId ?? null,
    patch.lastRunId ?? null,
    patch.lastError === undefined ? null : patch.lastError,
    now,
    sessionId
  );
}

/* ── Runtime State ��─ */

export function getOrCreateRuntimeState(
  agentId: string,
  companyId: string,
  db = getOrchestrationDb()
): RuntimeState {
  const existing = db
    .prepare(
      `SELECT agent_id, company_id, adapter_type, session_id, state_json,
              last_run_id, last_run_status,
              total_input_tokens, total_output_tokens, total_cost_cents,
              last_error
       FROM agent_runtime_state
       WHERE agent_id = ?
       LIMIT 1`
    )
    .get(agentId) as RuntimeStateRow | undefined;

  if (existing) return mapRuntimeStateRow(existing);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_runtime_state
       (agent_id, company_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(agentId, companyId, now, now);

  return {
    agentId,
    companyId,
    adapterType: "openclaw",
    sessionId: null,
    state: {},
    lastRunId: null,
    lastRunStatus: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostCents: 0,
    lastError: null,
  };
}

export function updateRuntimeState(
  agentId: string,
  patch: {
    sessionId?: string | null;
    lastRunId?: string;
    lastRunStatus?: string;
    inputTokensDelta?: number;
    outputTokensDelta?: number;
    costCentsDelta?: number;
    lastError?: string | null;
  },
  db = getOrchestrationDb()
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_runtime_state
     SET session_id = COALESCE(?, session_id),
         last_run_id = COALESCE(?, last_run_id),
         last_run_status = COALESCE(?, last_run_status),
         total_input_tokens = total_input_tokens + COALESCE(?, 0),
         total_output_tokens = total_output_tokens + COALESCE(?, 0),
         total_cost_cents = total_cost_cents + COALESCE(?, 0),
         last_error = CASE WHEN ? IS NOT NULL THEN ? ELSE last_error END,
         updated_at = ?
     WHERE agent_id = ?`
  ).run(
    patch.sessionId === undefined ? null : patch.sessionId,
    patch.lastRunId ?? null,
    patch.lastRunStatus ?? null,
    patch.inputTokensDelta ?? null,
    patch.outputTokensDelta ?? null,
    patch.costCentsDelta ?? null,
    patch.lastError === undefined ? null : "set",
    patch.lastError === undefined ? null : patch.lastError,
    now,
    agentId
  );
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
  getOrCreateRuntimeState(ceo.id, input.companyId, db);

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
     WHERE id = ?`
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
       (id, project_id, title, description, priority, type, status,
        assignee_agent_id, assigned_at, created_by,
        execution_mode, task_number, task_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'critical', 'directive', 'in_progress',
             ?, ?, 'engine:kickoff',
             'openclaw', ?, ?, ?, ?)`
  ).run(
    taskId,
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

export async function executeHeartbeatRun(
  runId: string,
  db = getOrchestrationDb()
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

  if (run.status !== "queued") {
    return {
      runId,
      agentId: run.agent_id,
      status: run.status as HeartbeatRunStatus,
      sessionId: null,
      error: `Run is already in status '${run.status}', not queued`,
      durationMs: Date.now() - startTime,
    };
  }

  // Claim the run
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE heartbeat_runs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`
  ).run(now, now, runId);

  if (run.wakeup_request_id) {
    db.prepare(
      `UPDATE agent_wakeup_requests SET status = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, run.wakeup_request_id);
  }

  // Load agent
  const agent = db
    .prepare(
      `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
              adapter_config_json, runtime_config_json, capabilities
       FROM agents WHERE id = ? AND archived_at IS NULL LIMIT 1`
    )
    .get(run.agent_id) as AgentRow | undefined;

  if (!agent) {
    return finishRun(runId, run, "failed", "Agent not found or archived", startTime, db);
  }

  // Resolve context snapshot
  const contextSnapshot = parseJson(run.context_snapshot_json);

  // Determine task key for session persistence
  const taskKey = resolveTaskKey(contextSnapshot, agent.id, db);

  // Get or create persistent session
  const session = getOrCreateTaskSession(
    { agentId: agent.id, companyId: agent.company_id, taskKey },
    db
  );

  // Get runtime state
  const runtimeState = getOrCreateRuntimeState(agent.id, agent.company_id, db);

  // Store session-before
  db.prepare(
    `UPDATE heartbeat_runs SET session_id_before = ?, updated_at = ? WHERE id = ?`
  ).run(runtimeState.sessionId ?? session.sessionParams.sessionId as string ?? null, new Date().toISOString(), runId);

  // If this heartbeat is for a real task (not __heartbeat__), bridge to execution_runs
  // so the existing MC polling infrastructure can import output.
  let executionRunId: string | null = null;
  if (taskKey !== "__heartbeat__") {
    const existingExecRun = db
      .prepare(
        `SELECT id FROM execution_runs
         WHERE task_id = ? AND provider = 'openclaw' AND status IN ('pending', 'running')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(taskKey) as { id: string } | undefined;

    if (!existingExecRun) {
      executionRunId = randomUUID();
      const execNow = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'openclaw', 'running', ?, ?, ?)`
      ).run(executionRunId, taskKey, agent.id, execNow, execNow, execNow);
    } else {
      executionRunId = existingExecRun.id;
    }
  }

  // Build the execution prompt
  const prompt = buildHeartbeatPrompt(agent, contextSnapshot, session, db);

  // Execute via OpenClaw gateway
  let result: { sessionId?: string; error?: string; usage?: Record<string, unknown> };
  try {
    result = await executeViaOpenClaw(agent, prompt, session, runtimeState);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finishRun(runId, run, "failed", message, startTime, db);
  }

  // Bridge: update execution_run with session ID so polling can find it
  if (executionRunId && result.sessionId) {
    db.prepare(
      `UPDATE execution_runs SET session_id = ?, status = 'running', updated_at = ? WHERE id = ?`
    ).run(result.sessionId, new Date().toISOString(), executionRunId);

    // Also set the task's execution_session_id so poll knows which session to check
    db.prepare(
      `UPDATE tasks SET execution_mode = 'openclaw', execution_session_id = ?, updated_at = ? WHERE id = ?`
    ).run(result.sessionId, new Date().toISOString(), taskKey);
  }

  // Persist session state
  if (result.sessionId) {
    updateTaskSession(
      session.id,
      {
        sessionParams: { ...session.sessionParams, sessionId: result.sessionId },
        lastRunId: runId,
        lastError: result.error ?? null,
      },
      db
    );

    updateRuntimeState(
      agent.id,
      {
        sessionId: result.sessionId,
        lastRunId: runId,
        lastRunStatus: result.error ? "failed" : "succeeded",
        inputTokensDelta: (result.usage?.inputTokens as number) ?? 0,
        outputTokensDelta: (result.usage?.outputTokens as number) ?? 0,
        lastError: result.error ?? null,
      },
      db
    );
  }

  // ── Post-execution: read output, import reports, execute MC actions ──
  if (result.sessionId && !result.error) {
    try {
      const actionResults = await importSessionOutputAndExecuteActions({
        sessionKey: `agent:${agent.openclaw_agent_id}:heartbeat:${session.taskKey}`,
        sessionId: result.sessionId,
        agentId: agent.id,
        agentName: agent.name,
        companyId: agent.company_id,
        taskKey,
        runId,
        db,
      });

      // Store action results in heartbeat run
      db.prepare(
        `UPDATE heartbeat_runs SET result_json = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(actionResults), new Date().toISOString(), runId);
    } catch (importError) {
      const msg = importError instanceof Error ? importError.message : String(importError);
      console.error("[engine] output import failed:", msg);
      // Non-fatal: run succeeded even if import fails
    }
  }

  // Update agent heartbeat
  db.prepare(
    `UPDATE agents SET last_heartbeat = ?, status = 'idle', updated_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), new Date().toISOString(), agent.id);

  return finishRun(
    runId,
    run,
    result.error ? "failed" : "succeeded",
    result.error ?? null,
    startTime,
    db,
    result.sessionId
  );
}

/* ── Prompt Building ── */

function buildHeartbeatPrompt(
  agent: AgentRow,
  contextSnapshot: Record<string, unknown>,
  session: TaskSession,
  db: Database.Database
): string {
  const sections: string[] = [];

  // Load onboarding assets based on agent role
  const assets = loadOnboardingAssets(agent.role.toLowerCase());

  // Agent instructions
  if (assets["AGENTS.md"]) {
    sections.push(assets["AGENTS.md"]);
  }
  if (assets["HEARTBEAT.md"]) {
    sections.push(assets["HEARTBEAT.md"]);
  }
  if (assets["SOUL.md"]) {
    sections.push(assets["SOUL.md"]);
  }

  // Context section
  sections.push("\n---\n# Execution Context\n");
  sections.push(`Agent: ${agent.name} (${agent.role})`);
  sections.push(`Company ID: ${agent.company_id}`);

  if (agent.capabilities) {
    sections.push(`Capabilities: ${agent.capabilities}`);
  }

  // Wake reason
  const wakeSource = contextSnapshot.wakeSource as string | undefined;
  const wakeReason = contextSnapshot.wakeReason as string | undefined;
  if (wakeSource) {
    sections.push(`\nWake source: ${wakeSource}`);
  }
  if (wakeReason) {
    sections.push(`Wake reason: ${wakeReason}`);
  }

  // Direction (for kickoff)
  const direction = contextSnapshot.direction as string | undefined;
  if (direction) {
    sections.push(`\n## Board Direction\n${direction}`);
  }

  // Assigned tasks
  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.type, t.task_key,
              p.name AS project_name, p.slug AS project_slug
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.assignee_agent_id = ? AND t.archived_at IS NULL
         AND t.status NOT IN ('done', 'cancelled')
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         t.created_at ASC
       LIMIT 20`
    )
    .all(agent.id) as Array<{
      id: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      type: string;
      task_key: string;
      project_name: string;
      project_slug: string;
    }>;

  if (tasks.length > 0) {
    sections.push("\n## Your Assigned Tasks\n");
    for (const task of tasks) {
      sections.push(`- [${task.task_key}] ${task.title} (${task.status}, ${task.priority}, ${task.type})`);
      sections.push(`  Project: ${task.project_name}`);
      if (task.description) {
        const desc = task.description.length > 200 ? task.description.slice(0, 200) + "..." : task.description;
        sections.push(`  Description: ${desc}`);
      }
    }
  } else {
    sections.push("\n## Your Assigned Tasks\nNo tasks currently assigned. Check the company backlog or create new tasks based on direction.");
  }

  // Session continuity info
  if (session.sessionParams.sessionId) {
    sections.push(`\n## Session\nResuming session: ${session.sessionDisplayId ?? session.sessionParams.sessionId}`);
  }

  return sections.join("\n").trim();
}

/* ── OpenClaw Gateway Execution ── */

async function executeViaOpenClaw(
  agent: AgentRow,
  prompt: string,
  session: TaskSession,
  runtimeState: RuntimeState
): Promise<{ sessionId?: string; error?: string; usage?: Record<string, unknown> }> {
  // Import the gateway call function from the existing execution module
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  // Determine if we should resume an existing session
  const existingSessionId = session.sessionParams.sessionId as string | undefined;
  const openclawAgentId = agent.openclaw_agent_id;

  if (!openclawAgentId) {
    return { error: "Agent has no openclaw_agent_id mapping. Cannot execute via OpenClaw gateway." };
  }

  try {
    // Create or resume session
    const sessionKey = `agent:${openclawAgentId}:heartbeat:${session.taskKey}`;

    // Session resolution order:
    // 1. Task session's stored sessionId (from previous run on this task key)
    // 2. Runtime state's sessionId (last known session for this agent)
    // 3. Create a brand new session via gateway
    let sessionId = existingSessionId ?? (runtimeState.sessionId || undefined);

    if (sessionId) {
      // Reusing existing session — send directly
      const sendResult = await callGateway<{ runId?: string; status?: string }>(
        OPENCLAW_BIN,
        "sessions.send",
        { key: sessionKey, message: prompt },
        execFileAsync
      );
      return {
        sessionId,
        usage: {
          openclawRunId: sendResult?.runId ?? null,
          openclawStatus: sendResult?.status ?? null,
          sessionReused: true,
        },
      };
    }

    // No existing session — create new, or look up existing by key
    const createResult = await callGateway<{ sessionId: string; key: string; ok?: boolean }>(
      OPENCLAW_BIN,
      "sessions.create",
      { key: sessionKey, agentId: openclawAgentId, label: `Heartbeat: ${agent.name} [${session.taskKey.slice(0, 8)}]` },
      execFileAsync
    );
    sessionId = createResult?.sessionId;

    // If create failed (e.g. label already in use), try to look up existing session by key
    if (!sessionId) {
      const existing = await callGateway<{ sessionId?: string; messages?: unknown[] }>(
        OPENCLAW_BIN,
        "sessions.get",
        { key: sessionKey },
        execFileAsync
      );
      sessionId = existing?.sessionId;
    }

    if (!sessionId) {
      return { error: "Failed to create or resolve OpenClaw session" };
    }

    // Send the heartbeat prompt to new session
    const sendResult = await callGateway<{ runId?: string; status?: string }>(
      OPENCLAW_BIN,
      "sessions.send",
      { key: sessionKey, message: prompt },
      execFileAsync
    );

    return {
      sessionId,
      usage: {
        openclawRunId: sendResult?.runId ?? null,
        openclawStatus: sendResult?.status ?? null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `OpenClaw execution failed: ${message}` };
  }
}

const OPENCLAW_BIN = process.env.ORCHESTRATION_OPENCLAW_CLI?.trim() || "/opt/homebrew/bin/openclaw";
const GATEWAY_ENV = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` };

async function callGateway<T>(
  _command: string,
  method: string,
  params: Record<string, unknown>,
  execFileAsync: (cmd: string, args: string[], opts: { maxBuffer: number; env: Record<string, string | undefined> }) => Promise<{ stdout: string }>
): Promise<T | undefined> {
  try {
    const { stdout } = await execFileAsync(
      OPENCLAW_BIN,
      ["gateway", "call", method, "--json", "--params", JSON.stringify(params)],
      { maxBuffer: 2 * 1024 * 1024, env: GATEWAY_ENV }
    );
    return JSON.parse(stdout) as T;
  } catch (err) {
    const primaryMsg = err instanceof Error ? err.message : String(err);
    // Only try fallback if the primary error is about an unknown method
    if (primaryMsg.includes("unknown method")) {
      try {
        const fallbackMethod = method.replace(".", "_");
        const { stdout } = await execFileAsync(
          OPENCLAW_BIN,
          ["gateway", "call", fallbackMethod, "--json", "--params", JSON.stringify(params)],
          { maxBuffer: 2 * 1024 * 1024, env: GATEWAY_ENV }
        );
        return JSON.parse(stdout) as T;
      } catch (fallbackErr) {
        console.error(`[engine] gateway call ${method} failed:`, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
        return undefined;
      }
    }
    console.error(`[engine] gateway call ${method} failed:`, primaryMsg);
    return undefined;
  }
}

/* ── Post-Execution Output Import & MC Action Execution ── */

type McAction =
  | { action: "create_task"; title: string; description?: string; priority?: string; type?: string; assignee?: string; project?: string }
  | { action: "hire_agent"; name: string; role: string; capabilities?: string; reason?: string }
  | { action: "report"; summary: string };

type ActionResults = {
  messagesImported: number;
  actionsFound: number;
  actionsExecuted: number;
  tasksCreated: string[];
  approvalsCreated: string[];
  reportsImported: number;
  errors: string[];
};

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
  runId: string;
  db: Database.Database;
}): Promise<ActionResults> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const results: ActionResults = {
    messagesImported: 0,
    actionsFound: 0,
    actionsExecuted: 0,
    tasksCreated: [],
    approvalsCreated: [],
    reportsImported: 0,
    errors: [],
  };

  // Wait for session to reach terminal state (poll sessions.get)
  const sessionData = await waitForSessionCompletion(OPENCLAW_BIN, input.sessionKey, execFileAsync);
  if (!sessionData) {
    results.errors.push("Could not retrieve session data after execution");
    return results;
  }

  // Extract assistant text messages
  const messages: SessionGetMessage[] = (sessionData as Record<string, unknown>).messages as SessionGetMessage[] ?? [];
  const assistantTexts: string[] = [];

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") {
      assistantTexts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          assistantTexts.push(block.text);
        }
      }
    }
  }

  if (assistantTexts.length === 0) {
    results.errors.push("No assistant text output found in session");
    return results;
  }

  results.messagesImported = assistantTexts.length;

  // Parse all mc-action blocks from assistant output
  const allActions: McAction[] = [];
  const allPlainText: string[] = [];

  for (const text of assistantTexts) {
    const { actions, plainText } = parseActionsFromText(text);
    allActions.push(...actions);
    if (plainText.trim()) {
      allPlainText.push(plainText.trim());
    }
  }

  results.actionsFound = allActions.length;

  // Import plain text as a report comment on the direction task
  if (allPlainText.length > 0) {
    const reportBody = allPlainText.join("\n\n---\n\n").slice(0, 9000);
    importCommentOnTask(input.taskKey, input.agentId, reportBody, "status_update", input.runId, input.db);
    results.reportsImported++;
  }

  // Execute each action
  for (const action of allActions) {
    try {
      switch (action.action) {
        case "create_task":
          {
            const taskId = executeCreateTask(action, input, input.db);
            if (taskId) {
              results.tasksCreated.push(taskId);
              results.actionsExecuted++;
            }
          }
          break;
        case "hire_agent":
          {
            const approvalId = executeHireAgent(action, input, input.db);
            if (approvalId) {
              results.approvalsCreated.push(approvalId);
              results.actionsExecuted++;
            }
          }
          break;
        case "report":
          {
            importCommentOnTask(
              input.taskKey,
              input.agentId,
              `**CEO Report:** ${action.summary}`.slice(0, 9000),
              "status_update",
              input.runId,
              input.db
            );
            results.reportsImported++;
            results.actionsExecuted++;
          }
          break;
        default:
          results.errors.push(`Unknown action type: ${(action as Record<string, unknown>).action}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Action ${action.action} failed: ${msg}`);
    }
  }

  return results;
}

async function waitForSessionCompletion(
  _command: string,
  sessionKey: string,
  execFileAsync: (cmd: string, args: string[], opts: { maxBuffer: number; env: NodeJS.ProcessEnv | undefined }) => Promise<{ stdout: string }>
): Promise<unknown> {
  // Poll sessions.get until status is terminal (done, failed, etc.)
  const maxAttempts = 30; // 30 * 2s = 60s max wait
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { stdout } = await execFileAsync(
        OPENCLAW_BIN,
        ["gateway", "call", "sessions.get", "--json", "--params", JSON.stringify({ key: sessionKey })],
        { maxBuffer: 4 * 1024 * 1024, env: GATEWAY_ENV }
      );
      const data = JSON.parse(stdout);
      const status = data?.status;
      if (status === "done" || status === "completed" || status === "failed" || status === "error" || status === "cancelled") {
        return data;
      }
      // Not done yet — wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch {
      // sessions.get failed — wait and retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  // Timeout — try one final read
  try {
    const { stdout } = await execFileAsync(
      OPENCLAW_BIN,
      ["gateway", "call", "sessions.get", "--json", "--params", JSON.stringify({ key: sessionKey })],
      { maxBuffer: 4 * 1024 * 1024, env: GATEWAY_ENV }
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function parseActionsFromText(text: string): { actions: McAction[]; plainText: string } {
  const actions: McAction[] = [];
  // Match ```mc-action ... ``` blocks
  const pattern = /```mc-action\s*\n([\s\S]*?)```/g;
  let plainText = text;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === "object" && parsed.action) {
        actions.push(parsed as McAction);
      }
    } catch {
      // Not valid JSON — skip
    }
    // Remove the action block from plain text
    plainText = plainText.replace(match[0], "");
  }

  return { actions, plainText };
}

function importCommentOnTask(
  taskId: string,
  agentId: string,
  body: string,
  type: string,
  runId: string,
  db: Database.Database
): void {
  const now = new Date().toISOString();
  const commentId = randomUUID();
  const externalRef = `engine:heartbeat:${runId}:${commentId.slice(0, 8)}`;

  // Check task exists (taskKey might be a task ID)
  const task = db.prepare("SELECT id FROM tasks WHERE id = ? LIMIT 1").get(taskId) as { id: string } | undefined;
  if (!task) return; // Skip if task doesn't exist (e.g. __heartbeat__)

  db.prepare(
    `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'openclaw', ?, ?, ?)`
  ).run(commentId, taskId, agentId, body, type, externalRef, now, now);

  // Log task event
  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, (SELECT project_id FROM tasks WHERE id = ?), ?, ?, 'task.comment_added', ?, ?)`
  ).run(randomUUID(), taskId, taskId, agentId, JSON.stringify({ source: "engine_heartbeat", runId }), now);
}

function executeCreateTask(
  action: Extract<McAction, { action: "create_task" }>,
  input: { agentId: string; agentName: string; companyId: string; taskKey: string; runId: string },
  db: Database.Database
): string | null {
  const now = new Date().toISOString();
  const taskId = randomUUID();

  // Resolve project: use action.project slug, or fall back to the same project as the direction task
  let projectId: string | null = null;

  if (action.project) {
    const proj = db
      .prepare("SELECT id FROM projects WHERE (slug = ? OR name = ?) AND company_id = ? AND archived_at IS NULL LIMIT 1")
      .get(action.project, action.project, input.companyId) as { id: string } | undefined;
    if (proj) projectId = proj.id;
  }

  if (!projectId) {
    // Fall back to the direction task's project
    const dirTask = db
      .prepare("SELECT project_id FROM tasks WHERE id = ? LIMIT 1")
      .get(input.taskKey) as { project_id: string } | undefined;
    if (dirTask) projectId = dirTask.project_id;
  }

  if (!projectId) {
    // Final fallback: first active project in company
    const proj = db
      .prepare("SELECT id FROM projects WHERE company_id = ? AND archived_at IS NULL AND status = 'active' LIMIT 1")
      .get(input.companyId) as { id: string } | undefined;
    projectId = proj?.id ?? null;
  }

  if (!projectId) return null;

  // Resolve assignee by name
  let assigneeId: string | null = null;
  if (action.assignee) {
    const agent = db
      .prepare("SELECT id FROM agents WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND company_id = ? AND archived_at IS NULL LIMIT 1")
      .get(action.assignee, input.companyId) as { id: string } | undefined;
    assigneeId = agent?.id ?? null;
  }

  // Get next task number
  const maxRow = db
    .prepare("SELECT MAX(task_number) AS max_num FROM tasks t INNER JOIN projects p ON p.id = t.project_id WHERE p.company_id = ?")
    .get(input.companyId) as { max_num: number | null } | undefined;
  const nextNum = (maxRow?.max_num ?? 0) + 1;

  const codeRow = db.prepare("SELECT company_code FROM companies WHERE id = ? LIMIT 1").get(input.companyId) as { company_code: string | null } | undefined;
  const code = codeRow?.company_code ?? "MC";
  const taskKeyNew = `${code}-${nextNum}`;

  // Map priority
  const priorityMap: Record<string, string> = { critical: "critical", high: "high", medium: "medium", low: "low" };
  const priority = priorityMap[action.priority?.toLowerCase() ?? ""] ?? "medium";

  // Map type
  const typeMap: Record<string, string> = { feature: "feature", bug: "bug", maintenance: "maintenance", research: "research", infrastructure: "infrastructure", directive: "directive" };
  const taskType = typeMap[action.type?.toLowerCase() ?? ""] ?? "feature";

  const status = assigneeId ? "on_deck" : "backlog";

  db.prepare(
    `INSERT INTO tasks
       (id, project_id, title, description, priority, type, status,
        assignee_agent_id, assigned_at, created_by,
        execution_mode, task_number, task_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?,
             'openclaw', ?, ?, ?, ?)`
  ).run(
    taskId, projectId,
    (action.title ?? "Untitled task").slice(0, 255),
    (action.description ?? "").slice(0, 10000),
    priority, taskType, status,
    assigneeId, assigneeId ? now : null,
    `agent:${input.agentId}`,
    nextNum, taskKeyNew,
    now, now
  );

  // Log events
  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.created', ?, ?, ?)`
  ).run(randomUUID(), projectId, taskId, input.agentId, status, JSON.stringify({ source: "ceo_heartbeat", runId: input.runId }), now);

  if (assigneeId) {
    db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.assigned', ?, ?)`
    ).run(randomUUID(), projectId, taskId, input.agentId, JSON.stringify({ assignee: action.assignee, source: "ceo_heartbeat" }), now);
  }

  return taskId;
}

function executeHireAgent(
  action: Extract<McAction, { action: "hire_agent" }>,
  input: { agentId: string; agentName: string; companyId: string; runId: string },
  db: Database.Database
): string | null {
  const now = new Date().toISOString();
  const approvalId = randomUUID();

  const payload = {
    name: action.name ?? "Unnamed Agent",
    role: action.role ?? "General",
    capabilities: action.capabilities ?? "",
    reason: action.reason ?? "Requested by CEO during heartbeat",
    requestedDuring: input.runId,
  };

  db.prepare(
    `INSERT INTO approvals
       (id, company_id, type, status, requested_by_agent_id, payload_json, created_at, updated_at)
     VALUES (?, ?, 'hire_agent', 'pending', ?, ?, ?, ?)`
  ).run(approvalId, input.companyId, input.agentId, JSON.stringify(payload), now, now);

  return approvalId;
}

/* ── Run Finalization ── */

function finishRun(
  runId: string,
  run: HeartbeatRunRow,
  status: HeartbeatRunStatus,
  error: string | null,
  startTime: number,
  db: Database.Database,
  sessionId?: string
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

  return {
    runId,
    agentId: run.agent_id,
    status,
    sessionId: sessionId ?? null,
    error,
    durationMs,
  };
}

/* ─��� Task Key Resolution ── */

function resolveTaskKey(
  contextSnapshot: Record<string, unknown>,
  agentId: string,
  db: Database.Database
): string {
  // If context has a specific task/issue, use that as the task key
  const directionTaskId = contextSnapshot.directionTaskId as string | undefined;
  if (directionTaskId) return directionTaskId;

  const issueId = contextSnapshot.issueId as string | undefined;
  if (issueId) return issueId;

  const taskKey = contextSnapshot.taskKey as string | undefined;
  if (taskKey) return taskKey;

  // Fallback: find the agent's highest-priority active task
  const activeTask = db
    .prepare(
      `SELECT id FROM tasks
       WHERE assignee_agent_id = ? AND archived_at IS NULL
         AND status IN ('in_progress', 'on_deck')
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

/* ── Query Helpers ── */

export function listHeartbeatRuns(
  input: { companyId: string; agentId?: string; limit?: number },
  db = getOrchestrationDb()
): HeartbeatRun[] {
  const clauses = ["company_id = ?"];
  const params: unknown[] = [input.companyId];

  if (input.agentId) {
    clauses.push("agent_id = ?");
    params.push(input.agentId);
  }

  const limit = input.limit ?? 50;

  const rows = db
    .prepare(
      `SELECT id, agent_id, company_id, invocation_source, trigger_detail, status,
              started_at, finished_at, wakeup_request_id,
              session_id_before, session_id_after,
              usage_json, result_json, exit_code, error, context_snapshot_json,
              created_at
       FROM heartbeat_runs
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params, limit) as HeartbeatRunRow[];

  return rows.map(mapHeartbeatRunRow);
}

export function listWakeupRequests(
  input: { companyId: string; agentId?: string; status?: WakeupStatus; limit?: number },
  db = getOrchestrationDb()
): WakeupRequest[] {
  const clauses = ["company_id = ?"];
  const params: unknown[] = [input.companyId];

  if (input.agentId) {
    clauses.push("agent_id = ?");
    params.push(input.agentId);
  }
  if (input.status) {
    clauses.push("status = ?");
    params.push(input.status);
  }

  const rows = db
    .prepare(
      `SELECT * FROM agent_wakeup_requests
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params, input.limit ?? 50) as WakeupRequestRow[];

  return rows.map(mapWakeupRequestRow);
}

export function getHeartbeatRun(
  runId: string,
  db = getOrchestrationDb()
): HeartbeatRun | null {
  const row = db
    .prepare(
      `SELECT id, agent_id, company_id, invocation_source, trigger_detail, status,
              started_at, finished_at, wakeup_request_id,
              session_id_before, session_id_after,
              usage_json, result_json, exit_code, error, context_snapshot_json,
              created_at
       FROM heartbeat_runs WHERE id = ? LIMIT 1`
    )
    .get(runId) as HeartbeatRunRow | undefined;

  return row ? mapHeartbeatRunRow(row) : null;
}

/* ── Internal Row Types & Mappers ── */

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

type WakeupRequestRow = {
  id: string;
  agent_id: string;
  company_id: string;
  source: string;
  reason: string | null;
  trigger_detail: string | null;
  payload_json: string;
  status: string;
  coalesced_count: number;
  idempotency_key: string | null;
  run_id: string | null;
  requested_at: string;
  claimed_at: string | null;
  finished_at: string | null;
};

type TaskSessionRow = {
  id: string;
  agent_id: string;
  company_id: string;
  adapter_type: string;
  task_key: string;
  session_params_json: string;
  session_display_id: string | null;
  last_run_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type RuntimeStateRow = {
  agent_id: string;
  company_id: string;
  adapter_type: string;
  session_id: string | null;
  state_json: string;
  last_run_id: string | null;
  last_run_status: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_cents: number;
  last_error: string | null;
};

type AgentRow = {
  id: string;
  name: string;
  role: string;
  personality: string;
  company_id: string;
  openclaw_agent_id: string | null;
  adapter_type: string;
  adapter_config_json: string;
  runtime_config_json: string;
  capabilities: string;
};

function mapHeartbeatRunRow(row: HeartbeatRunRow): HeartbeatRun {
  return {
    id: row.id,
    agentId: row.agent_id,
    companyId: row.company_id,
    invocationSource: row.invocation_source as InvocationSource,
    triggerDetail: row.trigger_detail,
    status: row.status as HeartbeatRunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    wakeupRequestId: row.wakeup_request_id,
    sessionIdBefore: row.session_id_before,
    sessionIdAfter: row.session_id_after,
    usage: parseJson(row.usage_json),
    result: parseJson(row.result_json),
    exitCode: row.exit_code,
    error: row.error,
    contextSnapshot: parseJson(row.context_snapshot_json),
    createdAt: row.created_at,
  };
}

function mapWakeupRequestRow(row: WakeupRequestRow): WakeupRequest {
  return {
    id: row.id,
    agentId: row.agent_id,
    companyId: row.company_id,
    source: row.source as WakeupSource,
    reason: row.reason,
    triggerDetail: row.trigger_detail,
    payload: parseJson(row.payload_json),
    status: row.status as WakeupStatus,
    coalescedCount: row.coalesced_count,
    idempotencyKey: row.idempotency_key,
    runId: row.run_id,
    requestedAt: row.requested_at,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
  };
}

function mapTaskSessionRow(row: TaskSessionRow): TaskSession {
  return {
    id: row.id,
    agentId: row.agent_id,
    companyId: row.company_id,
    adapterType: row.adapter_type,
    taskKey: row.task_key,
    sessionParams: parseJson(row.session_params_json),
    sessionDisplayId: row.session_display_id,
    lastRunId: row.last_run_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRuntimeStateRow(row: RuntimeStateRow): RuntimeState {
  return {
    agentId: row.agent_id,
    companyId: row.company_id,
    adapterType: row.adapter_type,
    sessionId: row.session_id,
    state: parseJson(row.state_json),
    lastRunId: row.last_run_id,
    lastRunStatus: row.last_run_status,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCostCents: row.total_cost_cents,
    lastError: row.last_error,
  };
}
