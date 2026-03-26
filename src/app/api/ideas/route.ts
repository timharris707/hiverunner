import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const IDEAS_PATH = path.join(
  process.env.HOME || "/Users/timharris",
  ".openclaw/workspace/projects/idea-intake/ideas.json"
);

async function readIdeas() {
  try {
    const raw = await fs.readFile(IDEAS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { ideas: [], meta: { last_updated: new Date().toISOString(), total_ideas: 0, next_id: 1 } };
  }
}

async function writeIdeas(data: Record<string, unknown>) {
  await fs.writeFile(IDEAS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export async function GET() {
  const data = await readIdeas();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { url, title, notes, source } = body as {
    url?: string;
    title?: string;
    notes?: string;
    source?: string;
  };

  if (!title && !url) {
    return NextResponse.json({ error: "title or url is required" }, { status: 400 });
  }

  const data = await readIdeas();
  const nextId = data.meta?.next_id ?? data.ideas.length + 1;

  const newIdea = {
    id: `idea-${String(nextId).padStart(3, "0")}`,
    title: title || url || "Untitled Idea",
    source: source || "manual",
    source_url: url || "",
    discovered_at: new Date().toISOString(),
    discovered_by: "tim",
    status: "idea",
    summary: notes || "",
    priority: "medium",
    effort: "medium",
    tags: [],
    github_issue: "",
    assigned_to: "",
  };

  data.ideas.push(newIdea);
  data.meta = {
    last_updated: new Date().toISOString(),
    total_ideas: data.ideas.length,
    next_id: nextId + 1,
  };

  await writeIdeas(data);
  return NextResponse.json(newIdea, { status: 201 });
}
