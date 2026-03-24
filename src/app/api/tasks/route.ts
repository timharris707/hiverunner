import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const TASKS_FILE = join(process.cwd(), "data", "tasks.json");

function readTasks() {
  try {
    return JSON.parse(readFileSync(TASKS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

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
    writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
    return NextResponse.json({ task: newTask });
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
    tasks[idx] = { ...tasks[idx], ...updates, updated: new Date().toISOString() };
    writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
    return NextResponse.json({ task: tasks[idx] });
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
