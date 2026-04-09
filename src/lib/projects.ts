import { readFileSync } from "fs";
import { join } from "path";

import { readTasks } from "@/lib/build-queue";

function readTasksSafely() {
  try {
    return readTasks();
  } catch (error) {
    // Legacy tasks.db read — degrade gracefully but log loudly.
    // This is the OLD task system (build-queue / tasks.db). Its failure must
    // not crash the app or block project enrichment. The live task
    // experience now runs on orchestration.db via /api/orchestration/tasks.
    console.error("[projects] LEGACY tasks.db read failed — returning [] (legacy system degradation):", error);
    return [];
  }
}

const PROJECTS_FILE = join(process.cwd(), "data", "projects.json");

function readJSON(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export function getProjects() {
  const projects = readJSON(PROJECTS_FILE);
  const tasks = readTasksSafely();

  const INACTIVE_DAYS = 7;
  const now = new Date();

  const enriched = projects.map((project: any) => {
    const projectTasks = tasks.filter((task: any) => task.project === project.id);

    const lastActivity = projectTasks.reduce((latest: string | null, task: any) => {
      const next = task.updated || task.created;
      return !latest || next > latest ? next : latest;
    }, null);

    let effectiveStatus = project.status;
    if (project.status !== "archived") {
      if (lastActivity) {
        const daysSince = (now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);
        effectiveStatus = daysSince > INACTIVE_DAYS ? "inactive" : "active";
      } else {
        const daysSinceCreated = (now.getTime() - new Date(project.created).getTime()) / (1000 * 60 * 60 * 24);
        effectiveStatus = daysSinceCreated > INACTIVE_DAYS ? "inactive" : "active";
      }
    }

    return {
      ...project,
      status: effectiveStatus,
      lastActivity,
      taskCount: projectTasks.length,
      inProgress: projectTasks.filter((task: any) => task.status === "in-progress").length,
      completed: projectTasks.filter((task: any) => task.status === "done").length,
      backlog: projectTasks.filter((task: any) => task.status === "backlog").length,
      review: projectTasks.filter((task: any) => task.status === "review").length,
    };
  });

  enriched.sort((a: any, b: any) => {
    const aTime = a.lastActivity || a.created || "";
    const bTime = b.lastActivity || b.created || "";
    return bTime.localeCompare(aTime);
  });

  return enriched;
}
