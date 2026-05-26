import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { resolveReviewProducerAssigneeId } from "@/lib/orchestration/service/review-assignment";
import { recordTaskSkillReviewOutcome } from "@/lib/orchestration/skill-effectiveness";
import {
  isExecutableAgentRuntime,
  normalizeRuntimeAdapter,
  runtimeProviderLabel,
} from "@/lib/orchestration/runtime-readiness";
import { enqueueWakeup } from "@/lib/orchestration/engine/wakeup-queue";

export type ReviewHandlerTask = {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  sprint_id: string | null;
  status: string;
  assignee_agent_id: string | null;
  task_key: string | null;
  title: string | null;
  type: string | null;
  labels_json: string | null;
  company_id: string | null;
};

type ReviewRunEvent = (runId: string, agentId: string, type: "action_executed" | "action_skipped", message: string, db: Database.Database) => void;

export function safeJsonStringArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function reviewAgentScore(
  agent: { name: string; role: string | null; review_specialist_categories?: string | null; review_load?: number },
  desiredCategories: string[],
): number {
  const name = agent.name.trim().toLowerCase();
  const role = (agent.role ?? "").trim().toLowerCase();
  const combined = `${name} ${role}`;
  const tags = safeJsonStringArray(agent.review_specialist_categories);
  let score = 100;
  if (desiredCategories.some((category) => tags.includes(category))) score -= 60;
  if (desiredCategories.includes("visual") && (tags.includes("visual") || name === "lens")) score -= 35;
  if (desiredCategories.includes("second_pass") && (tags.includes("second_pass") || name === "clarity")) score -= 35;
  if (tags.includes("qa") || /\bqa\b/.test(combined)) score -= 20;
  if (/\b(quality|verification|verify|validation|test|testing|review)\b/.test(combined)) score -= 10;
  if (name === "gator") score -= 5;
  if (!tags.includes("qa") && !/\b(qa|quality|verification|verify|validation|test|testing|review)\b/.test(combined)) {
    return Number.POSITIVE_INFINITY;
  }
  return score + Number(agent.review_load ?? 0) * 12;
}

function hasRunnableRegisteredRuntime(
  db: Database.Database,
  agent: { id: string; adapter_type: string | null },
): boolean {
  const adapterType = normalizeRuntimeAdapter(agent.adapter_type);
  const rows = db
    .prepare(
      `SELECT provider, status
       FROM agent_runtimes
       WHERE agent_id = ?`,
    )
    .all(agent.id) as Array<{ provider: string; status: string }>;

  if (rows.length === 0) return true;

  return rows.some((row) => {
    const provider = normalizeRuntimeAdapter(row.provider);
    if (row.status !== "online") return false;
    if (adapterType === "symphony") return provider === "symphony";
    return provider === adapterType;
  });
}

export function routeForReview(
  input: { companyId: string; producerAgentId: string; task?: { title?: string | null; type?: string | null; labelsJson?: string | null } },
  db: Database.Database,
): { id: string; name: string } | null {
  const labels = safeJsonStringArray(input.task?.labelsJson);
  const taskText = `${input.task?.title ?? ""} ${input.task?.type ?? ""} ${labels.join(" ")}`.toLowerCase();
  const desiredCategories = new Set<string>(["qa"]);
  if (/\b(visual|ui|frontend|interface|screen|layout|css|design)\b/.test(taskText)) desiredCategories.add("visual");
  if (/\b(second[-\s]?pass|audit|final|regression)\b/.test(taskText)) desiredCategories.add("second_pass");
  if (/\b(general|backend|api|integration)\b/.test(taskText)) desiredCategories.add("general");
  const candidates = db
    .prepare(
      `SELECT
         a.id,
         a.name,
         a.role,
         a.status,
         a.adapter_type,
         COALESCE(a.review_specialist_categories, '[]') AS review_specialist_categories,
         COUNT(t.id) AS review_load
       FROM agents a
       LEFT JOIN tasks t
         ON t.assignee_agent_id = a.id
        AND t.status = 'review'
        AND t.archived_at IS NULL
       WHERE a.company_id = ?
         AND a.archived_at IS NULL
         AND a.id != ?
       GROUP BY a.id
       ORDER BY lower(a.name) ASC`,
    )
    .all(input.companyId, input.producerAgentId) as Array<{
      id: string;
      name: string;
      role: string | null;
      status: string;
      adapter_type: string | null;
      review_specialist_categories: string | null;
      review_load: number;
    }>;

  let selected: { id: string; name: string; score: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.status === "paused" || candidate.status === "offline" || candidate.status === "error") continue;
    if (!isExecutableAgentRuntime(candidate.adapter_type)) continue;
    if (!hasRunnableRegisteredRuntime(db, candidate)) continue;
    const score = reviewAgentScore(candidate, Array.from(desiredCategories));
    if (!Number.isFinite(score)) continue;
    if (!selected || score < selected.score) {
      selected = { id: candidate.id, name: candidate.name, score };
    }
  }

  return selected ? { id: selected.id, name: selected.name } : null;
}

export function autoRouteReviewHandoff(input: {
  db: Database.Database;
  task: ReviewHandlerTask;
  producerAgentId: string;
  runId: string;
  normalizedStatus: string;
  emitRunEvent: ReviewRunEvent;
  enqueueEngineReassignmentWakeup: (input: {
    db: Database.Database;
    agentId: string | null | undefined;
    companyId: string | null | undefined;
    taskId: string;
    taskStatus: string;
    projectId: string | null;
    runId: string;
    reason: "engine_default_review_handoff";
  }) => unknown;
}): { assigneeApplied: boolean } {
  if (
    input.normalizedStatus !== "review" ||
    !input.task.company_id ||
    input.task.assignee_agent_id === undefined
  ) {
    return { assigneeApplied: false };
  }

  const reviewer = routeForReview({
    companyId: input.task.company_id,
    producerAgentId: input.producerAgentId,
    task: { title: input.task.title, type: input.task.type, labelsJson: input.task.labels_json },
  }, input.db);
  if (!reviewer || reviewer.id === input.task.assignee_agent_id) return { assigneeApplied: false };

  const now = new Date().toISOString();
  input.db.prepare(
    `UPDATE tasks
       SET assignee_agent_id = ?,
           assigned_at = ?,
           updated_at = ?
     WHERE id = ?`,
  ).run(reviewer.id, now, now, input.task.id);
  input.db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.assigned', ?, ?)`,
  ).run(
    randomUUID(),
    input.task.project_id,
    input.task.id,
    input.producerAgentId,
    JSON.stringify({
      source: "engine_default_review_handoff",
      runId: input.runId,
      newAssignee: reviewer.id,
      previousAssignee: input.task.assignee_agent_id,
      assigneeName: reviewer.name,
    }),
    now,
  );
  input.enqueueEngineReassignmentWakeup({
    db: input.db,
    agentId: reviewer.id,
    companyId: input.task.company_id,
    taskId: input.task.id,
    taskStatus: input.normalizedStatus,
    projectId: input.task.project_id,
    runId: input.runId,
    reason: "engine_default_review_handoff",
  });
  input.emitRunEvent(
    input.runId,
    input.producerAgentId,
    "action_executed",
    `Assigned ${input.task.task_key ?? input.task.id} review to ${reviewer.name}.`,
    input.db,
  );
  return { assigneeApplied: true };
}

export function applyReviewDecision(input: {
  db: Database.Database;
  task: ReviewHandlerTask;
  reviewerAgentId: string;
  runId: string;
  normalizedStatus: string;
  actionAssigneeProvided: boolean;
  requestedAssigneeId: string | null;
  emitRunEvent: ReviewRunEvent;
  enqueueEngineReassignmentWakeup: (input: {
    db: Database.Database;
    agentId: string | null | undefined;
    companyId: string | null | undefined;
    taskId: string;
    taskStatus: string;
    projectId: string | null;
    runId: string;
    reason: "engine_review_completion_return_to_producer";
  }) => unknown;
}): { assigneeApplied: boolean } {
  if (input.task.status !== "review") return { assigneeApplied: false };

  let assigneeApplied = false;
  if (input.normalizedStatus === "in_progress" || input.normalizedStatus === "done") {
    const producerAssigneeId = resolveReviewProducerAssigneeId(input.db, input.task.id);
    if (producerAssigneeId && producerAssigneeId !== input.task.assignee_agent_id) {
      const now = new Date().toISOString();
      input.db.prepare(
        `UPDATE tasks
           SET assignee_agent_id = ?,
               assigned_at = ?,
               updated_at = ?
         WHERE id = ?`,
      ).run(producerAssigneeId, now, now, input.task.id);
      input.db.prepare(
        `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.assigned', ?, ?)`,
      ).run(
        randomUUID(),
        input.task.project_id,
        input.task.id,
        input.reviewerAgentId,
        JSON.stringify({
          source: "engine_review_completion_return_to_producer",
          runId: input.runId,
          reviewer: input.reviewerAgentId,
          status: input.normalizedStatus,
          newAssignee: producerAssigneeId,
          previousAssignee: input.task.assignee_agent_id,
        }),
        now,
      );
      assigneeApplied = true;
      if (input.normalizedStatus === "in_progress") {
        input.enqueueEngineReassignmentWakeup({
          db: input.db,
          agentId: producerAssigneeId,
          companyId: input.task.company_id,
          taskId: input.task.id,
          taskStatus: input.normalizedStatus,
          projectId: input.task.project_id,
          runId: input.runId,
          reason: "engine_review_completion_return_to_producer",
        });
      }
    }
  }

  const outcome = input.normalizedStatus === "done"
    ? "pass"
    : input.normalizedStatus === "blocked"
      ? "blocked"
      : (input.normalizedStatus === "in_progress" || input.normalizedStatus === "to-do")
        ? "fail"
        : null;
  if (outcome) {
    const recorded = recordTaskSkillReviewOutcome(input.db, {
      taskId: input.task.id,
      outcome,
      reviewerAgentId: input.reviewerAgentId,
    });
    if (recorded > 0) {
      input.emitRunEvent(
        input.runId,
        input.reviewerAgentId,
        "action_executed",
        `Recorded ${recorded} skill effectiveness outcome${recorded === 1 ? "" : "s"} for ${input.task.task_key ?? input.task.id}.`,
        input.db,
      );
    }
  }

  if (input.normalizedStatus === "in_progress" || input.normalizedStatus === "to-do") {
    const rearm = rearmSiblingQATasksOnRework(input.task.id, input.reviewerAgentId, input.runId, input.db);
    if (rearm.cloned > 0) {
      input.emitRunEvent(
        input.runId,
        input.reviewerAgentId,
        "action_executed",
        `Re-armed ${rearm.cloned} sibling QA task(s) on ${input.task.task_key ?? input.task.id} rework.`,
        input.db,
      );
    }
    queueReviewReworkWake({
      taskId: input.task.id,
      projectId: input.task.project_id,
      companyId: input.task.company_id,
      assigneeId: input.actionAssigneeProvided ? input.requestedAssigneeId : input.task.assignee_agent_id,
      requestedByAgentId: input.reviewerAgentId,
      runId: input.runId,
      taskStatus: input.normalizedStatus,
      db: input.db,
      emitRunEvent: input.emitRunEvent,
    });
  }

  return { assigneeApplied };
}

function rearmSiblingQATasksOnRework(
  reworkedTaskId: string,
  triggeringAgentId: string,
  runId: string,
  db: Database.Database,
): { cloned: number } {
  const reworked = db
    .prepare(
      `SELECT id, parent_task_id, project_id, task_key
       FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1`,
    )
    .get(reworkedTaskId) as
      | { id: string; parent_task_id: string | null; project_id: string; task_key: string | null }
      | undefined;
  if (!reworked || !reworked.parent_task_id) return { cloned: 0 };

  const candidates = db
    .prepare(
      `SELECT id, title, description, type, priority, assignee_agent_id,
              depends_on_json, parent_task_id, project_id, labels_json
       FROM tasks
       WHERE parent_task_id = ?
         AND id != ?
         AND archived_at IS NULL
         AND type = 'research'
         AND status = 'done'`,
    )
    .all(reworked.parent_task_id, reworkedTaskId) as Array<{
      id: string;
      title: string;
      description: string;
      type: string;
      priority: string;
      assignee_agent_id: string | null;
      depends_on_json: string;
      parent_task_id: string;
      project_id: string;
      labels_json: string;
    }>;

  let cloned = 0;
  for (const sib of candidates) {
    if (cloned >= 5) break;
    let deps: unknown;
    try { deps = JSON.parse(sib.depends_on_json ?? "[]"); } catch { deps = []; }
    if (!Array.isArray(deps) || !deps.includes(reworkedTaskId)) continue;

    const baseTitle = sib.title.replace(/\s*\(round\s+\d+\)\s*$/i, "").trim();
    const liveExisting = db
      .prepare(
        `SELECT 1 FROM tasks
         WHERE parent_task_id = ? AND archived_at IS NULL
           AND status != 'done'
           AND (title = ? OR title LIKE ?)
         LIMIT 1`,
      )
      .get(sib.parent_task_id, baseTitle, `${baseTitle} (round %`);
    if (liveExisting) continue;

    const titleSiblings = db
      .prepare(
        `SELECT title FROM tasks
         WHERE parent_task_id = ? AND archived_at IS NULL
           AND (title = ? OR title LIKE ?)`,
      )
      .all(sib.parent_task_id, baseTitle, `${baseTitle} (round %`) as Array<{ title: string }>;
    let maxRound = 1;
    for (const row of titleSiblings) {
      const m = row.title.match(/\(round\s+(\d+)\)/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > maxRound) maxRound = n;
      }
    }
    const nextRound = maxRound + 1;
    const newTitle = `${baseTitle} (round ${nextRound})`.slice(0, 255);

    const codeRow = db
      .prepare(
        `SELECT c.id AS company_id, c.company_code AS code
         FROM projects p INNER JOIN companies c ON c.id = p.company_id
         WHERE p.id = ? LIMIT 1`,
      )
      .get(sib.project_id) as { company_id: string; code: string | null } | undefined;
    if (!codeRow) continue;
    const code = codeRow?.code ?? "MC";
    const maxNumRow = db
      .prepare(
        `SELECT MAX(t.task_number) AS max_num
         FROM tasks t INNER JOIN projects p ON p.id = t.project_id
         WHERE p.company_id = (SELECT company_id FROM projects WHERE id = ?)`,
      )
      .get(sib.project_id) as { max_num: number | null } | undefined;
    const nextNum = (maxNumRow?.max_num ?? 0) + 1;
    const newKey = `${code}-${nextNum}`;
    const newId = randomUUID();
    const cloneNow = new Date().toISOString();
    const initialStatus = sib.assignee_agent_id ? "to-do" : "backlog";

    db.prepare(
      `INSERT INTO tasks
         (id, company_id, project_id, parent_task_id, title, description, priority, type, status,
          assignee_agent_id, assigned_at, created_by, labels_json, depends_on_json,
          execution_mode, task_number, task_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               'openclaw', ?, ?, ?, ?)`,
    ).run(
      newId,
      codeRow?.company_id ?? null,
      sib.project_id,
      sib.parent_task_id,
      newTitle,
      sib.description,
      sib.priority,
      sib.type,
      initialStatus,
      sib.assignee_agent_id,
      sib.assignee_agent_id ? cloneNow : null,
      `agent:${triggeringAgentId}`,
      sib.labels_json,
      sib.depends_on_json,
      nextNum,
      newKey,
      cloneNow,
      cloneNow,
    );

    db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.created', ?, ?, ?)`,
    ).run(
      randomUUID(),
      sib.project_id,
      newId,
      triggeringAgentId,
      initialStatus,
      JSON.stringify({
        source: "g3_qa_rearm",
        runId,
        clonedFrom: sib.id,
        triggeredBy: reworked.task_key,
        round: nextRound,
      }),
      cloneNow,
    );

    cloned += 1;
  }

  return { cloned };
}

function queueReviewReworkWake(input: {
  taskId: string;
  projectId: string;
  companyId: string | null;
  assigneeId: string | null;
  requestedByAgentId: string;
  runId: string;
  taskStatus: string;
  db: Database.Database;
  emitRunEvent: ReviewRunEvent;
}): void {
  const assigneeId = input.assigneeId?.trim();
  const companyId = input.companyId?.trim();
  if (!assigneeId || !companyId || assigneeId === input.requestedByAgentId) return;

  const assignee = input.db
    .prepare(
      `SELECT status, archived_at, adapter_type
       FROM agents
       WHERE id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(assigneeId) as
      | { status: string; archived_at: string | null; adapter_type: string | null }
      | undefined;
  if (!assignee || assignee.archived_at) return;
  if (assignee.status === "paused" || assignee.status === "offline" || assignee.status === "error") return;
  if (!isExecutableAgentRuntime(assignee.adapter_type)) {
    input.emitRunEvent(
      input.runId,
      input.requestedByAgentId,
      "action_skipped",
      `Review rework wakeup skipped: target agent has no executable runtime (${runtimeProviderLabel(assignee.adapter_type)}).`,
      input.db,
    );
    return;
  }

  const wake = enqueueWakeup(
    {
      agentId: assigneeId,
      companyId,
      source: "api",
      reason: "review_rework_requested",
      payload: {
        taskId: input.taskId,
        taskStatus: input.taskStatus,
        projectId: input.projectId,
        requestedByAgentId: input.requestedByAgentId,
        runId: input.runId,
      },
      idempotencyKey: `review-rework:${input.taskId}:${input.runId}`,
    },
    input.db,
  );

  if (wake.heartbeatRunId && (wake.status === "queued" || wake.status === "coalesced")) {
    input.emitRunEvent(
      input.runId,
      input.requestedByAgentId,
      "action_executed",
      "Queued rework wakeup for assigned task",
      input.db,
    );
  }
}
