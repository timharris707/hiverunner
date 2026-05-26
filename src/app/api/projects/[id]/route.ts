import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { readTasks } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

const PROJECTS_FILE = join(process.cwd(), "data", "projects.json");

function readJSON(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projects = readJSON(PROJECTS_FILE);
    const tasks = readTasks();

    const project = projects.find((p: any) => p.id === id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const projectTasks = tasks.filter((t: any) => t.project === id);

    return NextResponse.json({
      project: {
        ...project,
        taskCount: projectTasks.length,
        inProgress: projectTasks.filter((t: any) => t.status === "in-progress").length,
        completed: projectTasks.filter((t: any) => t.status === "done").length,
        backlog: projectTasks.filter((t: any) => t.status === "backlog").length,
        review: projectTasks.filter((t: any) => t.status === "review").length,
      },
      tasks: projectTasks,
    });
  } catch (error) {
    console.error("Error reading project:", error);
    return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
  }
}
