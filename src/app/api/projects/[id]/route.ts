import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { readTasks } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

const PROJECTS_FILE = join(process.cwd(), "data", "projects.json");

type LegacyProject = {
  id: string;
  created?: string;
  [key: string]: unknown;
};

type LegacyTask = {
  id: string;
  project?: string;
  status?: string;
  [key: string]: unknown;
};

function readJSON<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projects = readJSON<LegacyProject[]>(PROJECTS_FILE, []);
    const tasks = readTasks() as LegacyTask[];

    const project = projects.find((p) => p.id === id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const projectTasks = tasks.filter((t) => t.project === id);

    return NextResponse.json({
      project: {
        ...project,
        taskCount: projectTasks.length,
        inProgress: projectTasks.filter((t) => t.status === "in-progress").length,
        completed: projectTasks.filter((t) => t.status === "done").length,
        backlog: projectTasks.filter((t) => t.status === "backlog").length,
        review: projectTasks.filter((t) => t.status === "review").length,
      },
      tasks: projectTasks,
    });
  } catch (error) {
    console.error("Error reading project:", error);
    return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
  }
}
