/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET /api/narrative
 * Synthesizes tasks + recent activities into human-readable narrative items.
 * "Pixel picked up auth redesign." not "file_write: src/components/auth.tsx"
 */
import { NextResponse } from "next/server";
import { readTasks } from "@/lib/build-queue";
import { getActivities } from "@/lib/activities-db";
import { getAgentByAnyId, getDisplayName } from "@/config/agents";

export const dynamic = "force-dynamic";

export interface NarrativeItem {
  id: string;
  timestamp: string;
  /** Display sentence shown in the feed */
  text: string;
  /** Which agent performed the action (for avatar) */
  agentId?: string;
  /** Linked task ID */
  taskId?: string;
  /** Category for icon/color */
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

/** Truncate task title to max N chars for clean narrative display */
function shortTitle(title: string, max = 48): string {
  if (!title) return "a task";
  return title.length > max ? title.slice(0, max).trimEnd() + "…" : title;
}

/** Resolve agent name from any agent ID string */
function agentLabel(agentId: string): string {
  const agent = getAgentByAnyId(agentId);
  if (!agent) return agentId;
  return getDisplayName(agent);
}

/** Today midnight UTC */
function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET() {
  const items: NarrativeItem[] = [];

  // ── 1. Task-derived narratives ──────────────────────────────────────────
  let tasks: any[] = [];
  try {
    tasks = readTasks();
  } catch {
    tasks = [];
  }

  const now = Date.now();
  const today = todayStart();

  // Track done-today count
  let doneToday = 0;
  let inProgressCount = 0;
  let blockedCount = 0;

  for (const task of tasks) {
    const updated = task.updated ? new Date(task.updated) : null;
    const ageMs = updated ? now - updated.getTime() : Infinity;

    // Only generate narrative for recent tasks (last 7 days) to keep feed relevant
    if (ageMs > 7 * 24 * 60 * 60 * 1000) {
      // Still count statuses for summary
      if (task.status === "done" && updated && updated >= today) doneToday++;
      if (task.status === "in-progress") inProgressCount++;
      if (task.status === "blocked") blockedCount++;
      continue;
    }

    const title = shortTitle(task.title || "a task");
    const assignee = task.assignedAgent || task.assignee || "";
    const agentId = assignee ? getAgentByAnyId(assignee)?.id : undefined;
    const actorLabel = assignee ? agentLabel(assignee) : null;
    const ts = updated?.toISOString() ?? new Date().toISOString();

    if (task.status === "in-progress") {
      inProgressCount++;
      const text = actorLabel
        ? `${actorLabel} picked up "${title}"`
        : `"${title}" is in progress`;
      items.push({
        id: `task-inprog-${task.id}`,
        timestamp: ts,
        text,
        agentId,
        taskId: task.id,
        type: "task_started",
      });
    } else if (task.status === "review") {
      const reviewer = task.reviewAssignedTo
        ? getAgentByAnyId(task.reviewAssignedTo)
        : null;
      const reviewerLabel = reviewer ? getDisplayName(reviewer) : "Gater";
      const text = actorLabel
        ? `${actorLabel} sent "${title}" to ${reviewerLabel} for review`
        : `"${title}" is awaiting review by ${reviewerLabel}`;
      items.push({
        id: `task-review-${task.id}`,
        timestamp: ts,
        text,
        agentId,
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
        agentId,
        taskId: task.id,
        type: "task_done",
      });
    } else if (task.status === "blocked") {
      blockedCount++;
      const text = `"${title}" hit a blocker`;
      items.push({
        id: `task-blocked-${task.id}`,
        timestamp: ts,
        text,
        agentId,
        taskId: task.id,
        type: "task_blocked",
      });
    }
  }

  // ── 2. Activity-derived narratives ──────────────────────────────────────
  try {
    const { activities } = getActivities({ limit: 30, sort: "newest" });

    for (const act of activities) {
      // Build pass/fail events
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
  } catch {
    // Activities DB optional — narratives still work without it
  }

  // ── 3. Daily summary ────────────────────────────────────────────────────
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

  // ── 4. Sort newest first, dedupe ─────────────────────────────────────────
  // Dedup: keep only one item per taskId (the most-recent one)
  const seen = new Set<string>();
  const deduped: NarrativeItem[] = [];
  for (const item of items.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )) {
    const key = item.taskId ?? item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  // Keep daily summary at end
  const summary = deduped.filter((i) => i.type === "daily_summary");
  const rest = deduped.filter((i) => i.type !== "daily_summary");

  return NextResponse.json({
    items: [...rest, ...summary].slice(0, 20),
    meta: { doneToday, inProgress: inProgressCount, blocked: blockedCount },
  });
}
