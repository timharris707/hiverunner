/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAgentByAnyId, getDisplayName } from "@/config/agents";

export interface NarrativeItem {
  id: string;
  timestamp: string;
  text: string;
  agentId?: string;
  taskId?: string;
  type:
    | "task_started"
    | "task_review"
    | "task_done"
    | "task_blocked"
    | "build_passed"
    | "build_failed"
    | "daily_summary"
    | "activity";
}

export type NarrativeTask = {
  id: string;
  title?: string;
  status?: string;
  updated?: string;
  completedAt?: string;
  assignedAgent?: string;
  assignee?: string;
  reviewAssignedTo?: string;
  reviewStatus?: string;
  lastReviewVerdict?: string;
  lastReviewerAgent?: string;
  lastReviewNotes?: string;
  lastReviewAt?: string;
};

export type NarrativeActivity = {
  id: string;
  timestamp: string;
  type?: string;
  description?: string;
  status?: string;
  agent?: string | null;
};

function shortTitle(title: string, max = 48): string {
  if (!title) return "a task";
  return title.length > max ? title.slice(0, max).trimEnd() + "…" : title;
}

function agentLabel(agentId: string): string {
  const agent = getAgentByAnyId(agentId);
  if (!agent) return agentId;
  return getDisplayName(agent);
}

function reviewerId(task: NarrativeTask): string | undefined {
  return task.lastReviewerAgent || task.reviewAssignedTo || undefined;
}

function reviewerLabel(task: NarrativeTask): string {
  const id = reviewerId(task);
  return id ? agentLabel(id) : "Gater";
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function buildNarrativeItems(tasks: NarrativeTask[], activities: NarrativeActivity[] = []) {
  const items: NarrativeItem[] = [];
  const now = Date.now();
  const today = todayStart();

  let doneToday = 0;
  let inProgressCount = 0;
  let blockedCount = 0;

  for (const task of tasks) {
    const updated = task.updated ? new Date(task.updated) : null;
    const ageMs = updated ? now - updated.getTime() : Infinity;
    const status = task.status ?? "";
    const hasActiveReviewSignal = status === "review" || Boolean(task.lastReviewAt && task.lastReviewVerdict);
    const isOngoingTask = status === "in-progress" || status === "blocked" || hasActiveReviewSignal;

    if (ageMs > 7 * 24 * 60 * 60 * 1000 && !isOngoingTask) {
      if (status === "done" && updated && updated >= today) doneToday++;
      if (status === "in-progress") inProgressCount++;
      if (status === "blocked") blockedCount++;
      continue;
    }

    const title = shortTitle(task.title || "a task");
    const assignee = task.assignedAgent || task.assignee || "";
    const actorAgent = assignee ? getAgentByAnyId(assignee)?.id : undefined;
    const actorLabel = assignee ? agentLabel(assignee) : null;
    const ts = updated?.toISOString() ?? new Date().toISOString();

    if (task.lastReviewAt && task.lastReviewVerdict) {
      const reviewTs = new Date(task.lastReviewAt).toISOString();
      const reviewer = reviewerLabel(task);
      const reviewAgentId = getAgentByAnyId(reviewerId(task) || "")?.id;
      const reviewNotes = task.lastReviewNotes?.trim();

      if (task.lastReviewVerdict === "APPROVED") {
        items.push({
          id: `task-review-approved-${task.id}`,
          timestamp: reviewTs,
          text: `${reviewer} approved "${title}"`,
          agentId: reviewAgentId,
          taskId: task.id,
          type: "task_review",
        });
      } else if (task.lastReviewVerdict === "NEEDS_FIX") {
        items.push({
          id: `task-review-rejected-${task.id}`,
          timestamp: reviewTs,
          text: reviewNotes
            ? `${reviewer} sent "${title}" back: ${shortTitle(reviewNotes, 72)}`
            : `${reviewer} sent "${title}" back for fixes`,
          agentId: reviewAgentId,
          taskId: task.id,
          type: "task_review",
        });
      }
    }

    if (task.status === "in-progress") {
      inProgressCount++;
      const text = actorLabel
        ? `${actorLabel} picked up "${title}"`
        : `"${title}" is in progress`;
      items.push({
        id: `task-inprog-${task.id}`,
        timestamp: ts,
        text,
        agentId: actorAgent,
        taskId: task.id,
        type: "task_started",
      });
    } else if (task.status === "review") {
      const reviewer = reviewerLabel(task);
      const reviewAgentId = getAgentByAnyId(reviewerId(task) || "")?.id;
      const text = task.reviewStatus === "gater-reviewing"
        ? `${reviewer} is reviewing "${title}"`
        : actorLabel
        ? `${actorLabel} sent "${title}" to ${reviewer} for review`
        : `"${title}" is awaiting review by ${reviewer}`;
      items.push({
        id: `task-review-${task.id}`,
        timestamp: ts,
        text,
        agentId: reviewAgentId ?? actorAgent,
        taskId: task.id,
        type: "task_review",
      });
    } else if (task.status === "done") {
      if (updated && updated >= today) doneToday++;
      const text = actorLabel
        ? `${actorLabel} shipped "${title}"`
        : `"${title}" shipped`;
      items.push({
        id: `task-done-${task.id}`,
        timestamp: ts,
        text,
        agentId: actorAgent,
        taskId: task.id,
        type: "task_done",
      });
    } else if (task.status === "blocked") {
      blockedCount++;
      const reviewer = reviewerLabel(task);
      const text = task.reviewStatus === "blocked"
        ? `${reviewer} blocked "${title}"`
        : `"${title}" hit a blocker`;
      items.push({
        id: `task-blocked-${task.id}`,
        timestamp: ts,
        text,
        agentId: getAgentByAnyId(reviewerId(task) || "")?.id ?? actorAgent,
        taskId: task.id,
        type: "task_blocked",
      });
    }
  }

  for (const act of activities) {
    if (act.type === "build" || act.description?.toLowerCase().includes("build")) {
      const passed = act.status === "success";
      const text = passed
        ? `Build passed${act.description ? ` · ${shortTitle(act.description, 40)}` : ""}`
        : `Build failed${act.description ? ` · ${shortTitle(act.description, 40)}` : ""}`;
      items.push({
        id: `act-build-${act.id}`,
        timestamp: act.timestamp,
        text,
        agentId: act.agent ?? undefined,
        type: passed ? "build_passed" : "build_failed",
      });
    }
  }

  if (doneToday > 0 || inProgressCount > 0 || blockedCount > 0) {
    const parts: string[] = [];
    if (doneToday > 0) parts.push(`${doneToday} task${doneToday !== 1 ? "s" : ""} shipped today`);
    if (inProgressCount > 0) parts.push(`${inProgressCount} in progress`);
    if (blockedCount > 0) parts.push(`${blockedCount} blocked`);
    items.push({
      id: "daily-summary",
      timestamp: today.toISOString(),
      text: parts.join(" · "),
      type: "daily_summary",
    });
  }

  const seen = new Set<string>();
  const deduped: NarrativeItem[] = [];
  for (const item of items.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )) {
    const key = item.taskId ? `${item.taskId}:${item.type}` : item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const summary = deduped.filter((i) => i.type === "daily_summary");
  const rest = deduped.filter((i) => i.type !== "daily_summary");

  return {
    items: [...rest, ...summary].slice(0, 20),
    meta: { doneToday, inProgress: inProgressCount, blocked: blockedCount },
  };
}
