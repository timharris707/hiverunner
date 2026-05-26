/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { readTasks, writeTasks } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tasks = readTasks();
    const task = tasks.find((t: any) => t.id === id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ comments: task.comments || [] });
  } catch (error) {
    console.error("Error reading comments:", error);
    return NextResponse.json({ error: "Failed to load comments" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { author, authorEmoji, text, type } = body;

    if (!author || !text || !type) {
      return NextResponse.json(
        { error: "Missing required fields: author, text, type" },
        { status: 400 }
      );
    }

    const validTypes = ["note", "review", "rejection", "resolution"];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const tasks = readTasks();
    const idx = tasks.findIndex((t: any) => t.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const comment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      author,
      authorEmoji: authorEmoji || "🤖",
      text,
      timestamp: new Date().toISOString(),
      type,
    };

    if (!Array.isArray(tasks[idx].comments)) {
      tasks[idx].comments = [];
    }
    tasks[idx].comments.push(comment);
    tasks[idx].updated = new Date().toISOString();
    writeTasks(tasks);

    return NextResponse.json({ comment, comments: tasks[idx].comments });
  } catch (error) {
    console.error("Error adding comment:", error);
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 });
  }
}
