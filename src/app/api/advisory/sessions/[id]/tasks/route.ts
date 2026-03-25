/**
 * /api/advisory/sessions/[id]/tasks
 *
 * CRUD operations on the review loop task list.
 *
 * GET    — Return the current task list and loop state
 * POST   — Add a new task (body: { description, insertAfter? })
 * PATCH  — Update a task (body: { taskId, description?, status?, notes? })
 * DELETE — Delete a task (body: { taskId })
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

interface ReviewTask {
  id: number;
  description: string;
  status: "pending" | "in-progress" | "in-review" | "approved" | "rejected" | "retrying" | "blocked";
  attempts: number;
  notes: string;
  overriddenBy: string | null;
  workerOutput?: string;
  reviewerFeedback?: string;
}

interface ReviewLoop {
  tasks: ReviewTask[];
  currentTaskIndex: number;
  workerAgent: string;
  reviewerAgent: string;
  supervisorAgent: string;
  supervisorInterval: number;
  totalApproved: number;
  totalRejected: number;
  autoContinue: boolean;
  paused: boolean;
  maxRetries: number;
}

function readSession(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function writeSession(filePath: string, session: Record<string, unknown>) {
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

// ─── GET — return tasks and loop state ────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = readSession(filePath);
  const loop: ReviewLoop | undefined = session.reviewLoop;

  if (!loop) {
    return NextResponse.json({ error: "No review loop in this session" }, { status: 400 });
  }

  return NextResponse.json({
    tasks: loop.tasks,
    currentTaskIndex: loop.currentTaskIndex,
    workerAgent: loop.workerAgent,
    reviewerAgent: loop.reviewerAgent,
    supervisorAgent: loop.supervisorAgent,
    totalApproved: loop.totalApproved,
    totalRejected: loop.totalRejected,
    totalTasks: loop.tasks.length,
    autoContinue: loop.autoContinue ?? true,
    paused: loop.paused ?? false,
    maxRetries: loop.maxRetries ?? 3,
  });
}

// ─── POST — add a new task ────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = readSession(filePath);
  const loop: ReviewLoop | undefined = session.reviewLoop;

  if (!loop) {
    return NextResponse.json({ error: "No review loop in this session" }, { status: 400 });
  }

  const { description, insertAfter } = await req.json();

  if (!description?.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  // Generate next task ID
  const maxId = loop.tasks.reduce((max, t) => Math.max(max, t.id), 0);
  const newTask: ReviewTask = {
    id: maxId + 1,
    description: description.trim(),
    status: "pending",
    attempts: 0,
    notes: "",
    overriddenBy: null,
  };

  if (typeof insertAfter === "number") {
    const insertIndex = loop.tasks.findIndex((t) => t.id === insertAfter);
    if (insertIndex >= 0) {
      loop.tasks.splice(insertIndex + 1, 0, newTask);
    } else {
      loop.tasks.push(newTask);
    }
  } else {
    loop.tasks.push(newTask);
  }

  session.reviewLoop = loop;
  writeSession(filePath, session);

  return NextResponse.json({ task: newTask, totalTasks: loop.tasks.length });
}

// ─── PATCH — update a task ────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = readSession(filePath);
  const loop: ReviewLoop | undefined = session.reviewLoop;

  if (!loop) {
    return NextResponse.json({ error: "No review loop in this session" }, { status: 400 });
  }

  const { taskId, description, status, notes } = await req.json();

  if (typeof taskId !== "number") {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const task = loop.tasks.find((t) => t.id === taskId);
  if (!task) {
    return NextResponse.json({ error: `Task ${taskId} not found` }, { status: 404 });
  }

  if (description !== undefined) task.description = String(description);
  if (notes !== undefined) task.notes = String(notes);
  if (status !== undefined) {
    const validStatuses = ["pending", "in-progress", "in-review", "approved", "rejected", "retrying", "blocked"];
    if (validStatuses.includes(status)) {
      task.status = status;
    }
  }

  session.reviewLoop = loop;
  writeSession(filePath, session);

  return NextResponse.json({ task });
}

// ─── DELETE — remove a task ───────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = readSession(filePath);
  const loop: ReviewLoop | undefined = session.reviewLoop;

  if (!loop) {
    return NextResponse.json({ error: "No review loop in this session" }, { status: 400 });
  }

  const { taskId } = await req.json();

  if (typeof taskId !== "number") {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const taskIndex = loop.tasks.findIndex((t) => t.id === taskId);
  if (taskIndex < 0) {
    return NextResponse.json({ error: `Task ${taskId} not found` }, { status: 404 });
  }

  // Don't allow deleting tasks that are currently in progress or in review
  const task = loop.tasks[taskIndex];
  if (task.status === "in-progress" || task.status === "in-review") {
    return NextResponse.json({ error: "Cannot delete a task that is currently being processed" }, { status: 400 });
  }

  loop.tasks.splice(taskIndex, 1);

  // Adjust currentTaskIndex if needed
  if (taskIndex < loop.currentTaskIndex) {
    loop.currentTaskIndex = Math.max(0, loop.currentTaskIndex - 1);
  }

  session.reviewLoop = loop;
  writeSession(filePath, session);

  return NextResponse.json({ ok: true, totalTasks: loop.tasks.length });
}
