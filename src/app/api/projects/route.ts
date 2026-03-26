import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const PROJECTS_FILE = join(process.cwd(), "data", "projects.json");
const TASKS_FILE = join(process.cwd(), "data", "tasks.json");

function readJSON(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const projects = readJSON(PROJECTS_FILE);
    const tasks = readJSON(TASKS_FILE);

    const enriched = projects.map((p: any) => {
      const projectTasks = tasks.filter((t: any) => t.project === p.id);
      return {
        ...p,
        taskCount: projectTasks.length,
        inProgress: projectTasks.filter((t: any) => t.status === "in-progress").length,
        completed: projectTasks.filter((t: any) => t.status === "done").length,
        backlog: projectTasks.filter((t: any) => t.status === "backlog").length,
        review: projectTasks.filter((t: any) => t.status === "review").length,
      };
    });

    return NextResponse.json({ projects: enriched });
  } catch (error) {
    console.error("Error reading projects:", error);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}
