import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { routeTask, getAvailableTiers, type TaskInput } from "@/lib/llm-router";

export const dynamic = "force-dynamic";

const TASKS_FILE = join(process.cwd(), "data", "tasks.json");

function readTasks() {
  try {
    return JSON.parse(readFileSync(TASKS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * GET /api/tasks/route-model?taskId=TASK-xxx
 * Returns the routing decision for a specific task.
 *
 * GET /api/tasks/route-model?all=true
 * Returns routing decisions for all non-done tasks (for dashboard overview).
 *
 * GET /api/tasks/route-model?tiers=true
 * Returns available model tiers and their pricing.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Return available tiers
  if (searchParams.get("tiers") === "true") {
    return NextResponse.json({ tiers: getAvailableTiers() });
  }

  const tasks = readTasks();

  // Route a specific task
  const taskId = searchParams.get("taskId");
  if (taskId) {
    const task = tasks.find((t: any) => t.id === taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const decision = routeTask(task as TaskInput);
    return NextResponse.json({ taskId, decision });
  }

  // Route all active tasks (for dashboard/overview)
  if (searchParams.get("all") === "true") {
    const activeTasks = tasks.filter(
      (t: any) => t.status !== "done" && t.status !== "review"
    );
    const routed = activeTasks.map((t: any) => ({
      taskId: t.id,
      title: t.title,
      priority: t.priority,
      project: t.project,
      decision: routeTask(t as TaskInput),
    }));

    // Compute aggregate stats
    const tierCounts: Record<string, number> = {};
    let totalSavings = 0;
    for (const r of routed) {
      tierCounts[r.decision.tier] = (tierCounts[r.decision.tier] || 0) + 1;
      totalSavings += r.decision.savingsPercent;
    }
    const avgSavings = routed.length > 0 ? Math.round(totalSavings / routed.length) : 0;

    return NextResponse.json({
      tasks: routed,
      stats: {
        total: routed.length,
        tierCounts,
        avgSavingsPercent: avgSavings,
      },
    });
  }

  return NextResponse.json({ error: "Provide ?taskId=X or ?all=true or ?tiers=true" }, { status: 400 });
}

/**
 * POST /api/tasks/route-model
 * Preview routing for an ad-hoc task (before creating it).
 * Body: { title, description?, type?, priority?, project?, tags? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const decision = routeTask(body as TaskInput);
    return NextResponse.json({ decision });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
