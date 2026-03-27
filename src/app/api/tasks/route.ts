/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { queueOrStartBuild, readTasks, reconcileBuildQueue, writeTasks } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await reconcileBuildQueue({ source: "tasks-get" });
    const tasks = readTasks();
    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("Error reading tasks:", error);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const task = await req.json();
    const tasks = readTasks();
    const newTask = {
      id: `TASK-${Date.now()}`,
      ...task,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    tasks.unshift(newTask);
    writeTasks(tasks);

    if (newTask.status === "in-progress") {
      await queueOrStartBuild(newTask.id, { source: "tasks-post" });
    }

    return NextResponse.json({ task: readTasks().find((t: any) => t.id === newTask.id) || newTask });
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...updates } = await req.json();
    const tasks = readTasks();
    const idx = tasks.findIndex((t: any) => t.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const previousTask = { ...tasks[idx] };
    const now = new Date().toISOString();
    tasks[idx] = { ...tasks[idx], ...updates, updated: now };

    if (tasks[idx].status === "review" && previousTask.status !== "review") {
      tasks[idx].reviewRequired = true;
      tasks[idx].reviewStatus = updates.reviewStatus || "pending";
      tasks[idx].reviewRequestedAt = tasks[idx].reviewRequestedAt || now;
      delete tasks[idx].completedAt;
    }

    if (previousTask.status === "review" && tasks[idx].status === "done") {
      tasks[idx].reviewRequired = true;
      tasks[idx].reviewStatus = updates.reviewStatus || "approved";
      tasks[idx].reviewCompletedAt = now;
      tasks[idx].completedAt = tasks[idx].completedAt || now;
    }

    if (previousTask.status === "review" && tasks[idx].status === "in-progress") {
      tasks[idx].reviewRequired = true;
      tasks[idx].reviewStatus = updates.reviewStatus || "changes-requested";
      tasks[idx].reviewCompletedAt = now;
      delete tasks[idx].completedAt;
    }

    writeTasks(tasks);

    const shouldTriggerBuild =
      tasks[idx].status === "in-progress" &&
      (
        (!previousTask.buildTriggeredAt && previousTask.status !== "in-progress") ||
        previousTask.buildState === "failed"
      );

    if (shouldTriggerBuild) {
      await queueOrStartBuild(id, { source: "tasks-patch" });
    }

    return NextResponse.json({ task: readTasks().find((t: any) => t.id === id) || tasks[idx] });
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
