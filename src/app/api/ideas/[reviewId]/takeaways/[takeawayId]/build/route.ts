import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { readReviews, writeReviews } from "../../../../route";

const TASKS_FILE = join(process.cwd(), "data", "tasks.json");

function readTasks() {
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

// Map agent names to display names
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

// Map priority strings to P-levels
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
  // body can contain: { action: "build-now" | "add-to-queue" | "schedule", project?: string, scheduledDate?: string }
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

  // Create the task
  const tasks = readTasks();
  const newTask = {
    id: `TASK-${Date.now()}`,
    title: tw.title,
    description: tw.description,
    status: action === "build-now" ? "in-progress" : "backlog",
    priority: PRIORITY_MAP[tw.priority] || "P1",
    assignee: AGENT_MAP[tw.assigned_to] || tw.assigned_to,
    project: project,
    type: "feature",
    tags: ["from-idea", `idea-${tw.id}`],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    source_review: reviewId,
    source_takeaway: takeawayId,
    github_issue: tw.github_issue || "",
    ...(body.scheduledDate ? { scheduled_date: body.scheduledDate } : {}),
  };

  tasks.unshift(newTask);
  writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));

  // Update the takeaway status
  tw.status = action === "build-now" ? "building" : "approved";
  tw.notes = (tw.notes || "") + `\nTask created: ${newTask.id} (${action})`;
  data.meta.last_updated = new Date().toISOString();
  await writeReviews(data);

  return NextResponse.json({ task: newTask, takeaway: tw });
}
