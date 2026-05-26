import { randomUUID } from "crypto";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import { markInboxThreadRead, resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { recordCompanyAuditEvent } from "@/lib/orchestration/service/audit";
import { moveTask } from "@/lib/orchestration/service/task";
import type {
  OrchestrationApproval,
  OrchestrationApprovalComment,
  ApprovalStatus,
  ApprovalType,
} from "@/lib/orchestration/types";

/* ── Row shapes ── */

type ApprovalRow = {
  id: string;
  company_id: string;
  type: string;
  status: string;
  requested_by_agent_id: string | null;
  approver_agent_id?: string | null;
  approval_route_reason?: string | null;
  payload_json: string;
  decision_note: string | null;
  decided_by_user_id: string | null;
  decided_at: string | null;
  linked_task_id: string | null;
  linked_task_key?: string | null;
  linked_task_title?: string | null;
  created_at: string;
  updated_at: string;
  agent_name?: string | null;
  approver_agent_name?: string | null;
  approver_agent_role?: string | null;
};

type CommentRow = {
  id: string;
  approval_id: string;
  author_agent_id: string | null;
  author_user_id: string | null;
  body: string;
  created_at: string;
  agent_name?: string | null;
};

type ApprovalCascadeRow = {
  approval_id: string;
  company_id: string;
  status: string;
  decision_note: string | null;
  linked_task_id: string;
  task_status: string;
  blocked_reason: string | null;
  assignee_agent_id: string | null;
};

/* ── Mappers ── */

function approvalFromRow(row: ApprovalRow): OrchestrationApproval {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payload_json || "{}"); } catch { /* */ }
  return {
    id: row.id,
    companyId: row.company_id,
    type: row.type as ApprovalType,
    status: row.status as ApprovalStatus,
    requestedByAgentId: row.requested_by_agent_id,
    requestedByAgentName: row.agent_name ?? null,
    approverAgentId: row.approver_agent_id ?? null,
    approverAgentName: row.approver_agent_name ?? null,
    approverAgentRole: row.approver_agent_role ?? null,
    approvalRouteReason: row.approval_route_reason ?? null,
    payload,
    decisionNote: row.decision_note,
    decidedByUserId: row.decided_by_user_id,
    decidedAt: row.decided_at,
    linkedTaskId: row.linked_task_id,
    linkedTaskKey: row.linked_task_key ?? null,
    linkedTaskTitle: row.linked_task_title ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ApprovalRoute = {
  approverAgentId: string | null;
  routeReason: string | null;
};

type ApprovalRoutingAgent = {
  id: string;
  name: string;
  role: string;
  status: string;
  reporting_to: string | null;
};

type ApprovalRoutingTask = {
  title: string;
  description: string | null;
  type: string;
  project_name: string | null;
};

function commentFromRow(row: CommentRow): OrchestrationApprovalComment {
  return {
    id: row.id,
    approvalId: row.approval_id,
    authorAgentId: row.author_agent_id,
    authorAgentName: row.agent_name ?? null,
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

/* ── Helpers ── */

function resolveCompany(db: ReturnType<typeof getOrchestrationDb>, companyIdOrSlug: string) {
  const resolved = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (resolved) return resolved.id;

  throw new OrchestrationApiError(404, "company_not_found", "Company not found");
}

function loadRoutingAgents(db: ReturnType<typeof getOrchestrationDb>, companyId: string): ApprovalRoutingAgent[] {
  return db.prepare(
    `SELECT id, name, role, status, reporting_to
     FROM agents
     WHERE company_id = ?
       AND archived_at IS NULL
     ORDER BY
       CASE WHEN status IN ('offline', 'paused') THEN 1 ELSE 0 END,
       name COLLATE NOCASE ASC`
  ).all(companyId) as ApprovalRoutingAgent[];
}

function loadRoutingTask(
  db: ReturnType<typeof getOrchestrationDb>,
  linkedTaskId?: string,
): ApprovalRoutingTask | null {
  if (!linkedTaskId) return null;
  const row = db.prepare(
    `SELECT t.title, t.description, t.type, p.name AS project_name
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.id = ?
       AND t.archived_at IS NULL
     LIMIT 1`
  ).get(linkedTaskId) as ApprovalRoutingTask | undefined;
  return row ?? null;
}

function routeToAgent(
  agents: ApprovalRoutingAgent[],
  routeReason: string,
  predicates: Array<(agent: ApprovalRoutingAgent) => boolean>,
): ApprovalRoute | null {
  for (const predicate of predicates) {
    const agent = agents.find(predicate);
    if (agent) {
      return { approverAgentId: agent.id, routeReason };
    }
  }
  return null;
}

function agentText(agent: ApprovalRoutingAgent): string {
  return `${agent.name} ${agent.role}`.toLowerCase();
}

function nameIs(name: string): (agent: ApprovalRoutingAgent) => boolean {
  const expected = name.toLowerCase();
  return (agent) => agent.name.toLowerCase() === expected;
}

function textHas(pattern: RegExp): (agent: ApprovalRoutingAgent) => boolean {
  return (agent) => pattern.test(agentText(agent));
}

function routeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "agent";
}

function rerouteSelfApproval(input: {
  route: ApprovalRoute;
  agents: ApprovalRoutingAgent[];
  requestedByAgentId?: string | null;
}): ApprovalRoute {
  const requesterId = input.requestedByAgentId?.trim();
  if (!requesterId || input.route.approverAgentId !== requesterId) return input.route;

  const requester = input.agents.find((agent) => agent.id === requesterId);
  const rerouteReason = `self_approval_rerouted_from_${routeSlug(requester?.name ?? requesterId)}`;
  const managerId = requester?.reporting_to?.trim();
  const candidates = [
    managerId ? input.agents.find((agent) => agent.id === managerId && agent.id !== requesterId) : undefined,
    input.agents.find((agent) => agent.name.toLowerCase() === "oracle" && agent.id !== requesterId),
    input.agents.find((agent) => /\b(ceo|product lead|product orchestrator|lead)\b/.test(agentText(agent)) && agent.id !== requesterId),
  ].filter(Boolean) as ApprovalRoutingAgent[];

  const next = candidates[0];
  return {
    approverAgentId: next?.id ?? null,
    routeReason: next
      ? `${rerouteReason}; routed to ${next.name}.`
      : `${rerouteReason}; routed to operator.`,
  };
}

function routeApproval(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  companyId: string;
  type: string;
  payload?: Record<string, unknown>;
  linkedTaskId?: string | null;
  requestedByAgentId?: string | null;
  explicitApproverAgentId?: string | null;
  explicitRouteReason?: string | null;
}): ApprovalRoute {
  const agents = loadRoutingAgents(input.db, input.companyId);
  const route = input.explicitApproverAgentId
    ? { approverAgentId: input.explicitApproverAgentId, routeReason: input.explicitRouteReason ?? "Explicit approval owner." }
    : resolveApprovalRoute({
        db: input.db,
        companyIdOrSlug: input.companyId,
        type: input.type,
        payload: input.payload,
        linkedTaskId: input.linkedTaskId ?? undefined,
        requestedByAgentId: input.requestedByAgentId,
      });
  return rerouteSelfApproval({
    route,
    agents,
    requestedByAgentId: input.requestedByAgentId,
  });
}

function enqueueApprovalWake(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  approvalId: string;
  companyId: string;
  approverAgentId: string | null | undefined;
  type: string;
  routeReason?: string | null;
}): void {
  if (!input.approverAgentId) return;
  const now = new Date().toISOString();
  input.db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, payload_json, status, idempotency_key, requested_at, created_at, updated_at)
     VALUES (?, ?, ?, 'api', 'approval_requested', ?, 'queued', ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).run(
    randomUUID(),
    input.approverAgentId,
    input.companyId,
    JSON.stringify({
      approvalId: input.approvalId,
      approvalType: input.type,
      routeReason: input.routeReason ?? null,
    }),
    `approval:${input.approvalId}:${input.approverAgentId}`,
    now,
    now,
    now,
  );
  input.db.prepare(
    `UPDATE agent_wakeup_requests
     SET payload_json = ?,
         updated_at = ?
     WHERE idempotency_key = ?
       AND status IN ('queued', 'claimed')`,
  ).run(
    JSON.stringify({
      approvalId: input.approvalId,
      approvalType: input.type,
      routeReason: input.routeReason ?? null,
    }),
    now,
    `approval:${input.approvalId}:${input.approverAgentId}`,
  );
}

function insertSystemTaskComment(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    taskId: string;
    body: string;
    externalRef: string;
    now?: string;
  },
): void {
  const now = input.now ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO comments
       (id, task_id, author_agent_id, author_user_id, body, type, source, external_ref, created_at, updated_at)
     SELECT ?, ?, NULL, 'system:approval-cascade', ?, 'status_update', 'engine', ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM comments WHERE task_id = ? AND external_ref = ?
     )`,
  ).run(
    randomUUID(),
    input.taskId,
    input.body,
    input.externalRef,
    now,
    now,
    input.taskId,
    input.externalRef,
  );
}

function enqueueApprovalCascadeWake(
  db: ReturnType<typeof getOrchestrationDb>,
  row: ApprovalCascadeRow,
): void {
  if (!row.assignee_agent_id) return;
  const now = new Date().toISOString();
  const wakeupId = randomUUID();
  const runId = randomUUID();
  const idempotencyKey = `approval-cascade:${row.approval_id}:${row.linked_task_id}`;
  const payload = {
    taskId: row.linked_task_id,
    approvalId: row.approval_id,
    approvalStatus: row.status,
    taskStatus: "in_progress",
  };

  db.prepare(
    `UPDATE agent_wakeup_requests
     SET idempotency_key = NULL
     WHERE idempotency_key = ?
       AND status IN ('finished', 'failed', 'cancelled', 'claimed')`,
  ).run(idempotencyKey);

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, payload_json, status, idempotency_key, run_id, requested_at, created_at, updated_at)
     VALUES (?, ?, ?, 'api', 'approval_unblocked_task', ?, 'queued', ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(
    wakeupId,
    row.assignee_agent_id,
    row.company_id,
    JSON.stringify(payload),
    idempotencyKey,
    runId,
    now,
    now,
    now,
  );

  const inserted = db.prepare("SELECT id FROM agent_wakeup_requests WHERE id = ?").get(wakeupId) as { id: string } | undefined;
  if (!inserted) return;

  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status, wakeup_request_id, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', ?, 'queued', ?, ?, ?, ?)`,
  ).run(
    runId,
    row.assignee_agent_id,
    row.company_id,
    `Approval ${row.approval_id} unblocked linked task`,
    wakeupId,
    JSON.stringify({
      wakeSource: "api",
      wakeReason: "approval_unblocked_task",
      ...payload,
    }),
    now,
    now,
  );
}

function loadApprovalCascadeRow(
  db: ReturnType<typeof getOrchestrationDb>,
  approvalId: string,
): ApprovalCascadeRow | null {
  const row = db.prepare(
    `SELECT
       ap.id AS approval_id,
       ap.company_id,
       ap.status,
       ap.decision_note,
       COALESCE(ap.linked_task_id, t.id) AS linked_task_id,
       t.status AS task_status,
       t.blocked_reason,
       t.assignee_agent_id
     FROM approvals ap
     JOIN tasks t ON (
       t.id = ap.linked_task_id
       OR (ap.linked_task_id IS NULL AND t.blocked_reason LIKE '%' || ap.id || '%')
     )
     WHERE ap.id = ?
       AND t.archived_at IS NULL
     LIMIT 1`,
  ).get(approvalId) as ApprovalCascadeRow | undefined;
  return row ?? null;
}

function taskBlockedOnApproval(row: ApprovalCascadeRow): boolean {
  if (row.task_status !== "blocked") return false;
  const reason = row.blocked_reason ?? "";
  return reason.includes(row.approval_id);
}

export function cascadeApprovalDecisionToLinkedTask(input: {
  approvalId: string;
  db?: ReturnType<typeof getOrchestrationDb>;
}): { changed: boolean; taskId?: string; toStatus?: string; reason?: string } {
  const db = input.db ?? getOrchestrationDb();
  const row = loadApprovalCascadeRow(db, input.approvalId);
  if (!row || !["approved", "rejected", "cancelled"].includes(row.status) || !taskBlockedOnApproval(row)) {
    return { changed: false, reason: "not_applicable" };
  }

  if (row.status === "approved") {
    moveTask({
      taskId: row.linked_task_id,
      status: "in-progress",
      actorUserId: "system:approval-cascade",
    });
    insertSystemTaskComment(db, {
      taskId: row.linked_task_id,
      body: `[APPROVAL_UNBLOCKED] Approval ${row.approval_id} was approved. Moving the task back to in progress and waking the assignee.`,
      externalRef: `approval-cascade:${row.approval_id}:approved`,
    });
    enqueueApprovalCascadeWake(db, row);
    return { changed: true, taskId: row.linked_task_id, toStatus: "in_progress" };
  }

  const body = row.status === "rejected"
    ? `[APPROVAL_UNBLOCKED] Required approval was rejected: ${row.decision_note ?? "No decision note provided."} Moving the task to backlog for replanning.`
    : "[APPROVAL_UNBLOCKED] Required approval was cancelled - original work scope no longer applies. Reassess from backlog.";
  moveTask({
    taskId: row.linked_task_id,
    status: "backlog",
    actorUserId: "system:approval-cascade",
  });
  insertSystemTaskComment(db, {
    taskId: row.linked_task_id,
    body,
    externalRef: `approval-cascade:${row.approval_id}:${row.status}`,
  });
  return { changed: true, taskId: row.linked_task_id, toStatus: "backlog" };
}

export function cascadeResolvedApprovalsToLinkedTasks(input: {
  db?: ReturnType<typeof getOrchestrationDb>;
  companySlugs?: string[] | null;
} = {}): { changed: number } {
  const db = input.db ?? getOrchestrationDb();
  const companyFilter = input.companySlugs && input.companySlugs.length > 0
    ? ` AND c.slug IN (${input.companySlugs.map(() => "?").join(",")})`
    : "";
  const rows = db.prepare(
    `SELECT ap.id
     FROM approvals ap
     JOIN tasks t ON (
       t.id = ap.linked_task_id
       OR (ap.linked_task_id IS NULL AND t.blocked_reason LIKE '%' || ap.id || '%')
     )
     JOIN projects p ON p.id = t.project_id
     JOIN companies c ON c.id = p.company_id
     WHERE ap.status IN ('approved', 'rejected', 'cancelled')
       AND t.status = 'blocked'
       AND t.blocked_reason LIKE '%' || ap.id || '%'
       AND t.archived_at IS NULL
       ${companyFilter}
     ORDER BY ap.updated_at ASC`,
  ).all(...(input.companySlugs ?? [])) as Array<{ id: string }>;
  let changed = 0;
  for (const row of rows) {
    const result = cascadeApprovalDecisionToLinkedTask({ approvalId: row.id, db });
    if (result.changed) changed += 1;
  }
  return { changed };
}

function assertApproverBelongsToCompany(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  approverAgentId: string,
): void {
  const row = db.prepare(
    `SELECT id
     FROM agents
     WHERE id = ?
       AND company_id = ?
       AND archived_at IS NULL
     LIMIT 1`
  ).get(approverAgentId, companyId) as { id: string } | undefined;
  if (!row) {
    throw new OrchestrationApiError(400, "invalid_approver", "Approver agent must belong to this company");
  }
}

export function resolveApprovalRoute(input: {
  companyIdOrSlug: string;
  type: string;
  payload?: Record<string, unknown>;
  linkedTaskId?: string;
  requestedByAgentId?: string | null;
  db?: ReturnType<typeof getOrchestrationDb>;
}): ApprovalRoute {
  const db = input.db ?? getOrchestrationDb();
  const companyId = resolveCompany(db, input.companyIdOrSlug);
  const agents = loadRoutingAgents(db, companyId);
  const payload = input.payload ?? {};
  const task = loadRoutingTask(db, input.linkedTaskId);
  const riskCodes = Array.isArray(payload.risks)
    ? payload.risks
        .map((risk) => typeof risk === "object" && risk !== null && "code" in risk ? String((risk as { code?: unknown }).code ?? "") : "")
        .filter(Boolean)
    : [];
  const text = [
    typeof payload.summary === "string" ? payload.summary : "",
    typeof payload.command === "string" ? payload.command : "",
    typeof payload.reason === "string" ? payload.reason : "",
    typeof payload.currentProvider === "string" ? payload.currentProvider : "",
    typeof payload.targetProvider === "string" ? payload.targetProvider : "",
    task?.title ?? "",
    task?.description ?? "",
    task?.type ?? "",
    task?.project_name ?? "",
    ...riskCodes,
  ].join(" ").toLowerCase();

  const fallbackToRequester = (): ApprovalRoute => {
    if (input.requestedByAgentId && agents.some((agent) => agent.id === input.requestedByAgentId)) {
      return { approverAgentId: input.requestedByAgentId, routeReason: "Fallback to requesting agent; no specialist matched." };
    }
    return { approverAgentId: null, routeReason: "No approval specialist matched." };
  };

  const leadership = [
    nameIs("Lead"),
    textHas(/\b(ceo|product lead|product orchestrator|lead)\b/),
    nameIs("Oracle"),
  ];

  if (input.type === "provider_switch") {
    return routeToAgent(agents, "Provider switch routed to runtime governance.", [
      nameIs("Oracle"),
      textHas(/\b(runtime|provider|orchestrator|product)\b/),
      ...leadership,
    ]) ?? fallbackToRequester();
  }

  if (input.type === "protected_runtime_command") {
    if (/\b(providers?|models?|runtime routing|routing policy|hives?|lanes?)\b/.test(text)) {
      return routeToAgent(agents, "Runtime policy request routed to orchestration owner.", [
        nameIs("Oracle"),
        textHas(/\b(runtime|provider|orchestrator|product)\b/),
        ...leadership,
      ]) ?? fallbackToRequester();
    }
    if (/\b(legal|compliance|financial|finance|audit|lending|loan agreement|disclosure)\b/.test(text)) {
      return routeToAgent(agents, "Compliance-sensitive runtime request routed to compliance/legal owner.", [
        nameIs("Castor"),
        textHas(/\b(legal|compliance|finance|financial|audit|lending)\b/),
        ...leadership,
      ]) ?? fallbackToRequester();
    }
    if (/\b(release|deploy|deployment|production|prod|dry run|ship|publish)\b/.test(text)) {
      return routeToAgent(agents, "Production/release runtime request routed to release stewardship.", [
        nameIs("Ralph"),
        nameIs("Release"),
        textHas(/\b(repo steward|release|deployment)\b/),
        nameIs("Gator"),
        textHas(/\b(qa|verification)\b/),
        ...leadership,
      ]) ?? fallbackToRequester();
    }
    if (/\b(qa|verification|visual|test|review)\b/.test(text)) {
      return routeToAgent(agents, "Verification request routed to QA owner.", [
        nameIs("Gator"),
        textHas(/\b(qa|verification|quality)\b/),
        ...leadership,
      ]) ?? fallbackToRequester();
    }
    return routeToAgent(agents, "Protected runtime request routed to orchestration owner.", [
      nameIs("Oracle"),
      textHas(/\b(runtime|orchestrator|product)\b/),
      ...leadership,
    ]) ?? fallbackToRequester();
  }

  if (input.type === "budget_override_required") {
    return routeToAgent(agents, "Budget approval routed to leadership.", leadership) ?? fallbackToRequester();
  }

  if (input.type === "hire_agent" || input.type === "approve_ceo_strategy") {
    return routeToAgent(agents, "Governance approval routed to leadership.", leadership) ?? fallbackToRequester();
  }

  return fallbackToRequester();
}

function backfillExistingApprovalRoute(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  approvalId: string;
  companyId: string;
  type: string;
  payload: Record<string, unknown>;
  linkedTaskId: string | null;
  requestedByAgentId: string | null;
}): void {
  const routed = routeApproval({
    db: input.db,
    companyId: input.companyId,
    type: input.type,
    payload: input.payload,
    linkedTaskId: input.linkedTaskId,
    requestedByAgentId: input.requestedByAgentId,
  });
  input.db.prepare(
    `UPDATE approvals
     SET approver_agent_id = ?,
         approval_route_reason = ?,
         updated_at = updated_at
     WHERE id = ?`
  ).run(routed.approverAgentId, routed.routeReason, input.approvalId);
  enqueueApprovalWake({
    db: input.db,
    approvalId: input.approvalId,
    companyId: input.companyId,
    approverAgentId: routed.approverAgentId,
    type: input.type,
    routeReason: routed.routeReason,
  });
}

export function backfillApprovalRoutes(input: {
  companyIdOrSlug: string;
  status?: string;
  force?: boolean;
  db?: ReturnType<typeof getOrchestrationDb>;
}): { updated: number } {
  const db = input.db ?? getOrchestrationDb();
  const companyId = resolveCompany(db, input.companyIdOrSlug);
  const where = ["company_id = ?"];
  const args: unknown[] = [companyId];
  if (!input.force) {
    where.push("(approver_agent_id IS NULL OR approval_route_reason IS NULL)");
  }
  if (input.status) {
    where.push("status = ?");
    args.push(input.status);
  }
  const rows = db.prepare(
    `SELECT id, company_id, type, requested_by_agent_id, payload_json, linked_task_id
     FROM approvals
     WHERE ${where.join(" AND ")}`
  ).all(...args) as Array<{
    id: string;
    company_id: string;
    type: string;
    requested_by_agent_id: string | null;
    payload_json: string;
    linked_task_id: string | null;
  }>;

  let updated = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(row.payload_json || "{}"); } catch { /* ignore malformed payload */ }
      backfillExistingApprovalRoute({
        db,
        approvalId: row.id,
        companyId: row.company_id,
        type: row.type,
        payload,
        linkedTaskId: row.linked_task_id,
        requestedByAgentId: row.requested_by_agent_id,
      });
      updated += 1;
    }
  });
  tx();
  return { updated };
}

/* ── Approval CRUD ── */

export function listApprovals(input: {
  companyIdOrSlug: string;
  status?: string;
  type?: string;
  linkedTaskId?: string;
}): { approvals: OrchestrationApproval[] } {
  const db = getOrchestrationDb();
  const companyId = resolveCompany(db, input.companyIdOrSlug);
  const where = ["a.company_id = ?"];
  const args: unknown[] = [companyId];
  if (input.status) { where.push("a.status = ?"); args.push(input.status); }
  if (input.type) { where.push("a.type = ?"); args.push(input.type); }
  if (input.linkedTaskId) { where.push("a.linked_task_id = ?"); args.push(input.linkedTaskId); }
  const rows = db.prepare(
    `SELECT
       a.*,
       ag.name AS agent_name,
       approver.name AS approver_agent_name,
       approver.role AS approver_agent_role,
       t.task_key AS linked_task_key,
       t.title AS linked_task_title
     FROM approvals a
     LEFT JOIN agents ag ON ag.id = a.requested_by_agent_id
     LEFT JOIN agents approver ON approver.id = a.approver_agent_id
     LEFT JOIN tasks t ON t.id = a.linked_task_id
     WHERE ${where.join(" AND ")}
     ORDER BY a.created_at DESC`
  ).all(...args) as ApprovalRow[];
  return { approvals: rows.map(approvalFromRow) };
}

export function createApproval(input: {
  companyIdOrSlug: string;
  type: string;
  requestedByAgentId?: string;
  approverAgentId?: string;
  approvalRouteReason?: string;
  payload?: Record<string, unknown>;
  linkedTaskId?: string;
  db?: ReturnType<typeof getOrchestrationDb>;
}): { approval: OrchestrationApproval } {
  const db = input.db ?? getOrchestrationDb();
  const companyId = resolveCompany(db, input.companyIdOrSlug);

  // Dedup: prevent duplicate pending approvals for the same target.
  // Key priority: linked_task_id > provider switch > payload agent_id > payload name+role.
  // Only pending/revision_requested approvals are considered open.
  const payload = input.payload ?? {};
  const existingId = (() => {
    // Most specific: same type + same linked task
    if (input.linkedTaskId) {
      if (input.type === "protected_runtime_command") {
        const fingerprint = typeof payload.fingerprint === "string" ? payload.fingerprint : "";
        if (fingerprint) {
          const row = db.prepare(
            `SELECT id
             FROM approvals
             WHERE company_id = ?
               AND type = 'protected_runtime_command'
               AND linked_task_id = ?
               AND status IN ('pending', 'revision_requested')
               AND json_extract(payload_json, '$.fingerprint') = ?
             LIMIT 1`,
          ).get(companyId, input.linkedTaskId, fingerprint) as { id: string } | undefined;
          if (row) return row.id;
        }
        return null;
      }
      const row = db.prepare(
        `SELECT id FROM approvals WHERE company_id = ? AND type = ? AND linked_task_id = ? AND status IN ('pending', 'revision_requested') LIMIT 1`
      ).get(companyId, input.type, input.linkedTaskId) as { id: string } | undefined;
      if (row) return row.id;
    }
    if (input.type === "provider_switch") {
      const agentId = typeof payload.agentId === "string" ? payload.agentId : "";
      const targetProvider = typeof payload.targetProvider === "string" ? payload.targetProvider : "";
      if (agentId && targetProvider) {
        const row = db.prepare(
          `SELECT id
           FROM approvals
           WHERE company_id = ?
             AND type = 'provider_switch'
             AND status IN ('pending', 'revision_requested')
             AND json_extract(payload_json, '$.agentId') = ?
             AND json_extract(payload_json, '$.targetProvider') = ?
           LIMIT 1`,
        ).get(companyId, agentId, targetProvider) as { id: string } | undefined;
        if (row) return row.id;
      }
    }
    // For hire_agent: match on payload agent_id if present, else name+role
    if (input.type === "hire_agent") {
      const targetId = payload.agentId ?? payload.agent_id;
      if (typeof targetId === "string" && targetId) {
        const row = db.prepare(
          `SELECT id FROM approvals WHERE company_id = ? AND type = 'hire_agent' AND status IN ('pending', 'revision_requested') AND json_extract(payload_json, '$.agentId') = ? LIMIT 1`
        ).get(companyId, targetId) as { id: string } | undefined;
        if (row) return row.id;
      }
      const name = typeof payload.name === "string"
        ? payload.name.trim().toLowerCase()
        : typeof payload.agentName === "string"
          ? payload.agentName.trim().toLowerCase()
          : "";
      const role = typeof payload.role === "string" ? payload.role.trim().toLowerCase() : "";
      if (name) {
        const row = db.prepare(
          `SELECT id FROM approvals WHERE company_id = ? AND type = 'hire_agent' AND status IN ('pending', 'revision_requested') AND LOWER(TRIM(json_extract(payload_json, '$.name'))) = ? AND LOWER(TRIM(json_extract(payload_json, '$.role'))) = ? LIMIT 1`
        ).get(companyId, name, role) as { id: string } | undefined;
        if (row) return row.id;
      }
    }
    return null;
  })();

  if (existingId) {
    const existing = getApproval(existingId, db);
    backfillExistingApprovalRoute({
      db,
      approvalId: existing.approval.id,
      companyId,
      type: existing.approval.type,
      payload: existing.approval.payload,
      linkedTaskId: existing.approval.linkedTaskId,
      requestedByAgentId: existing.approval.requestedByAgentId,
    });
    return getApproval(existingId, db);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  if (input.approverAgentId) {
    assertApproverBelongsToCompany(db, companyId, input.approverAgentId);
  }
  const route = input.approverAgentId
    ? routeApproval({
        db,
        companyId,
        type: input.type,
        payload,
        linkedTaskId: input.linkedTaskId,
        requestedByAgentId: input.requestedByAgentId,
        explicitApproverAgentId: input.approverAgentId,
        explicitRouteReason: input.approvalRouteReason,
      })
    : routeApproval({
        db,
        companyId,
        type: input.type,
        payload,
        linkedTaskId: input.linkedTaskId,
        requestedByAgentId: input.requestedByAgentId,
      });
  db.prepare(
    `INSERT INTO approvals (
       id, company_id, type, status, requested_by_agent_id, approver_agent_id,
       approval_route_reason, payload_json, linked_task_id, created_at, updated_at
     ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    companyId,
    input.type,
    input.requestedByAgentId ?? null,
    route.approverAgentId,
    route.routeReason,
    JSON.stringify(payload),
    input.linkedTaskId ?? null,
    now,
    now,
  );
  enqueueApprovalWake({
    db,
    approvalId: id,
    companyId,
    approverAgentId: route.approverAgentId,
    type: input.type,
    routeReason: route.routeReason,
  });
  return getApproval(id, db);
}

export function getApproval(approvalId: string, dbInput?: ReturnType<typeof getOrchestrationDb>): { approval: OrchestrationApproval } {
  const db = dbInput ?? getOrchestrationDb();
  const row = db.prepare(
    `SELECT
       a.*,
       ag.name AS agent_name,
       approver.name AS approver_agent_name,
       approver.role AS approver_agent_role,
       t.task_key AS linked_task_key,
       t.title AS linked_task_title
     FROM approvals a
     LEFT JOIN agents ag ON ag.id = a.requested_by_agent_id
     LEFT JOIN agents approver ON approver.id = a.approver_agent_id
     LEFT JOIN tasks t ON t.id = a.linked_task_id
     WHERE a.id = ?`
  ).get(approvalId) as ApprovalRow | undefined;
  if (!row) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  const approval = approvalFromRow(row);
  approval.comments = listApprovalComments(approvalId, db);
  return { approval };
}

export function resolveApprovalByTaskKey(input: {
  companyIdOrSlug: string;
  taskKey: string;
}):
  | { status: "not_found" }
  | { status: "ambiguous"; approvalIds: string[] }
  | { status: "unique"; approvalId: string } {
  const db = getOrchestrationDb();
  const companyId = resolveCompany(db, input.companyIdOrSlug);
  const taskKey = input.taskKey.trim();

  if (!taskKey) {
    return { status: "not_found" };
  }

  const rows = db.prepare(
    `SELECT a.id
     FROM approvals a
     INNER JOIN tasks t ON t.id = a.linked_task_id
     WHERE a.company_id = ?
       AND t.task_key = ?
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 2`
  ).all(companyId, taskKey) as Array<{ id: string }>;

  if (rows.length === 0) {
    return { status: "not_found" };
  }

  if (rows.length > 1) {
    return {
      status: "ambiguous",
      approvalIds: rows.map((row) => row.id),
    };
  }

  return {
    status: "unique",
    approvalId: rows[0].id,
  };
}

export function updateApprovalStatus(input: {
  approvalId: string;
  status: string;
  decidedByUserId?: string;
  decisionNote?: string;
}): { approval: OrchestrationApproval } {
  const db = getOrchestrationDb();
  const existing = db
    .prepare("SELECT id, status, company_id, type, requested_by_agent_id, linked_task_id FROM approvals WHERE id = ?")
    .get(input.approvalId) as {
      id: string;
      status: string;
      company_id: string;
      type: string;
      requested_by_agent_id: string | null;
      linked_task_id: string | null;
    } | undefined;
  if (!existing) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE approvals SET status = ?, decided_by_user_id = ?, decision_note = ?, decided_at = ?, updated_at = ? WHERE id = ?`
  ).run(input.status, input.decidedByUserId ?? null, input.decisionNote ?? null, now, now, input.approvalId);

  recordCompanyAuditEvent({
    companyId: existing.company_id,
    agentId: existing.requested_by_agent_id,
    taskId: existing.linked_task_id,
    approvalId: input.approvalId,
    eventType: "approval.status_changed",
    actorUserId: input.decidedByUserId ?? "operator",
    metadata: {
      type: existing.type,
      previousStatus: existing.status,
      status: input.status,
      decisionNote: input.decisionNote ?? null,
    },
  }, db);

  // Mark related inbox events as read when the approval is resolved
  // (approved, rejected, cancelled) — keeps inbox count in sync
  const resolved = ["approved", "rejected", "cancelled"].includes(input.status);
  if (resolved) {
    try {
      cascadeApprovalDecisionToLinkedTask({ approvalId: input.approvalId, db });
    } catch (error) {
      console.warn("[approval] linked task cascade failed:", error instanceof Error ? error.message : String(error));
    }
    try {
      markInboxThreadRead({
        companyIdOrSlug: existing.company_id,
        threadKey: input.approvalId,
        threadKind: "approval",
      });
    } catch { /* non-fatal — inbox sync is best-effort */ }
  }

  return getApproval(input.approvalId);
}

/* ── Revision requested flow ── */

export function requestRevision(input: {
  approvalId: string;
  decisionNote?: string;
  decidedByUserId?: string;
}): { approval: OrchestrationApproval } {
  const db = getOrchestrationDb();
  const existing = db.prepare("SELECT id, status FROM approvals WHERE id = ?").get(input.approvalId) as { id: string; status: string } | undefined;
  if (!existing) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  if (existing.status !== "pending") {
    throw new OrchestrationApiError(400, "not_pending", `Cannot request revision on ${existing.status} approval`);
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE approvals SET status = 'revision_requested', decided_by_user_id = ?, decision_note = ?, decided_at = ?, updated_at = ? WHERE id = ?`
  ).run(input.decidedByUserId ?? "operator", input.decisionNote ?? null, now, now, input.approvalId);
  return getApproval(input.approvalId);
}

export function resubmitApproval(input: {
  approvalId: string;
  payload?: Record<string, unknown>;
}): { approval: OrchestrationApproval } {
  const db = getOrchestrationDb();
  const existing = db.prepare("SELECT id, status, payload_json FROM approvals WHERE id = ?").get(input.approvalId) as { id: string; status: string; payload_json: string } | undefined;
  if (!existing) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  if (existing.status !== "revision_requested") {
    throw new OrchestrationApiError(400, "not_revision_requested", `Cannot resubmit: approval is ${existing.status}`);
  }
  const now = new Date().toISOString();
  const payloadJson = input.payload ? JSON.stringify(input.payload) : existing.payload_json;
  db.prepare(
    `UPDATE approvals SET status = 'pending', payload_json = ?, decision_note = NULL, decided_by_user_id = NULL, decided_at = NULL, updated_at = ? WHERE id = ?`
  ).run(payloadJson, now, input.approvalId);
  return getApproval(input.approvalId);
}

/* ── Comments ── */

export function listApprovalComments(approvalId: string, dbInput?: ReturnType<typeof getOrchestrationDb>): OrchestrationApprovalComment[] {
  const db = dbInput ?? getOrchestrationDb();
  const rows = db.prepare(
    `SELECT ac.*, ag.name AS agent_name FROM approval_comments ac LEFT JOIN agents ag ON ag.id = ac.author_agent_id WHERE ac.approval_id = ? ORDER BY ac.created_at ASC`
  ).all(approvalId) as CommentRow[];
  return rows.map(commentFromRow);
}

export function addApprovalComment(input: {
  approvalId: string;
  companyId: string;
  body: string;
  authorAgentId?: string;
  authorUserId?: string;
}): { comment: OrchestrationApprovalComment } {
  const db = getOrchestrationDb();
  const existing = db.prepare("SELECT id FROM approvals WHERE id = ?").get(input.approvalId) as { id: string } | undefined;
  if (!existing) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO approval_comments (id, company_id, approval_id, author_agent_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.companyId, input.approvalId, input.authorAgentId ?? null, input.authorUserId ?? null, input.body, now, now);
  const row = db.prepare(
    `SELECT ac.*, ag.name AS agent_name FROM approval_comments ac LEFT JOIN agents ag ON ag.id = ac.author_agent_id WHERE ac.id = ?`
  ).get(id) as CommentRow;
  return { comment: commentFromRow(row) };
}
