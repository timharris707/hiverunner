/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { queueOrStartBuild, readTasks, writeTasks } from "@/lib/build-queue";
import { readReviews, writeReviews } from "@/lib/ideas-store";

const TASKS_FILE = join(process.cwd(), "data", "tasks.json");

function legacyReadTasks() {
  try {
    return JSON.parse(readFileSync(TASKS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

interface Takeaway {
  id: string;
  title: string;
  description: string;
  priority: string;
  assigned_to: string;
  status: string;
  github_issue: string;
  [key: string]: unknown;
}

const AGENT_MAP: Record<string, string> = {
  henry: "Henry ⚡",
  scout: "Scout 🔭",
  forge: "Forge 🔧",
  pixel: "Pixel 💻",
  quill: "Quill ✍️",
  cipher: "Cipher ₿",
  nimbus: "Nimbus 🌤️",
  atlas: "Atlas 📈",
  quant: "Quant 📊",
  counsel: "Counsel ⚖️",
};

const PRIORITY_MAP: Record<string, string> = {
  high: "P0",
  medium: "P1",
  low: "P2",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string; takeawayId: string }> }
) {
  const { reviewId, takeawayId } = await params;
  const body = await req.json();
  const action = body.action || "add-to-queue";
  const project = body.project || "mission-control";

  const data = await readReviews();
  const review = data.reviews.find((r: { id: string }) => r.id === reviewId);
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  const tw = review.takeaways.find((t: Takeaway) => t.id === takeawayId);
  if (!tw) {
    return NextResponse.json({ error: "Takeaway not found" }, { status: 404 });
  }

  const tasks = readTasks() || legacyReadTasks();
  const newTask = {
    id: `TASK-${Date.now()}`,
    title: tw.title,
    description: tw.description,
    status: action === "build-now" ? "in-progress" : "backlog",
    priority: PRIORITY_MAP[tw.priority] || "P1",
    assignee: AGENT_MAP[tw.assigned_to] || tw.assigned_to,
    project,
    type: "feature",
    tags: ["from-idea", `idea-${tw.id}`],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    source_review: reviewId,
    source_takeaway: takeawayId,
    source_url: tw.video_url || "",
    github_issue: tw.github_issue || "",
    ...(body.scheduledDate ? { scheduled_date: body.scheduledDate } : {}),
  };

  tasks.unshift(newTask);
  writeTasks(tasks);

  if (action === "build-now") {
    await queueOrStartBuild(newTask.id, { source: "ideas-build-now" });
  }

  tw.status = action === "build-now" ? "building" : "approved";
  tw.notes = (tw.notes || "") + `\nTask created: ${newTask.id} (${action})`;
  data.meta.last_updated = new Date().toISOString();
  await writeReviews(data);

  return NextResponse.json({ task: readTasks().find((t: any) => t.id === newTask.id) || newTask, takeaway: tw });
}
