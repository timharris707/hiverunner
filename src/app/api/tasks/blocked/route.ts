/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { readTasks, writeTasks, transitionTask } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/blocked — List all blocked tasks for operator triage
 */
export async function GET() {
  try {
    const tasks = readTasks();
    const blocked = tasks
      .filter((t: any) => t.status === "blocked" || t.blocker)
      .map((t: any) => ({
        id: t.id,
        title: t.title,
        project: t.project,
        priority: t.priority,
        assignedAgent: t.assignedAgent,
        blocker: t.blocker,
        escalatedToLead: t.escalatedToLead || false,
        updated: t.updated,
      }));

    return NextResponse.json({
      count: blocked.length,
      tasks: blocked,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/tasks/blocked — Resolve a blocker on a task
 * Body: { taskId: string, resolution: string, resolvedBy?: string }
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { taskId, resolution, resolvedBy } = body;

    if (!taskId || !resolution) {
      return NextResponse.json(
        { error: "taskId and resolution are required" },
        { status: 400 },
      );
    }

    const tasks = readTasks();
    const task = tasks.find((t: any) => t.id === taskId);

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (!task.blocker) {
      return NextResponse.json({ error: "Task has no blocker" }, { status: 400 });
    }

    const now = new Date().toISOString();
    task.blocker.resolved = true;
    task.blocker.resolvedAt = now;
    task.blocker.resolvedBy = resolvedBy || "operator";
    task.blocker.resolutionNotes = resolution;
    transitionTask(task, "in-progress", "blocker-resolve");
    task.buildState = undefined;
    task.updated = now;

    writeTasks(tasks);

    return NextResponse.json({
      success: true,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        blocker: task.blocker,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
