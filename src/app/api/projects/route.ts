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

    const INACTIVE_DAYS = 7;
    const now = new Date();

    const enriched = projects.map((p: any) => {
      const projectTasks = tasks.filter((t: any) => t.project === p.id);

      // Auto-detect activity: find most recently updated task
      const lastActivity = projectTasks.reduce((latest: string | null, t: any) => {
        const d = t.updated || t.created;
        return !latest || d > latest ? d : latest;
      }, null);

      // Compute effective status: archived stays archived, otherwise auto-detect
      let effectiveStatus = p.status;
      if (p.status !== "archived") {
        if (lastActivity) {
          const daysSince = (now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);
          effectiveStatus = daysSince > INACTIVE_DAYS ? "inactive" : "active";
        } else {
          // No tasks yet — use project creation date
          const daysSinceCreated = (now.getTime() - new Date(p.created).getTime()) / (1000 * 60 * 60 * 24);
          effectiveStatus = daysSinceCreated > INACTIVE_DAYS ? "inactive" : "active";
        }
      }

      return {
        ...p,
        status: effectiveStatus,
        lastActivity,
        taskCount: projectTasks.length,
        inProgress: projectTasks.filter((t: any) => t.status === "in-progress").length,
        completed: projectTasks.filter((t: any) => t.status === "done").length,
        backlog: projectTasks.filter((t: any) => t.status === "backlog").length,
        review: projectTasks.filter((t: any) => t.status === "review").length,
      };
    });

    // Sort by most recent activity first (lastActivity desc), then by created desc
    enriched.sort((a: any, b: any) => {
      const aTime = a.lastActivity || a.created || "";
      const bTime = b.lastActivity || b.created || "";
      return bTime.localeCompare(aTime);
    });

    return NextResponse.json({ projects: enriched });
  } catch (error) {
    console.error("Error reading projects:", error);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}
