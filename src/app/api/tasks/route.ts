/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { queueOrStartBuild, readTasks, writeTasks } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
    tasks[idx] = { ...tasks[idx], ...updates, updated: new Date().toISOString() };
    writeTasks(tasks);

    const shouldTriggerBuild =
      tasks[idx].status === "in-progress" &&
      (
        previousTask.status !== "in-progress" ||
        !previousTask.buildTriggeredAt ||
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
