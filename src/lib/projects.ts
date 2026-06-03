import { readFileSync } from "fs";
import { join } from "path";

import { readTasks } from "@/lib/build-queue";

type LegacyProject = {
  id: string;
  status?: string;
  created?: string;
  [key: string]: unknown;
};

type LegacyTask = {
  project?: string;
  status?: string;
  updated?: string;
  created?: string;
  [key: string]: unknown;
};

type EnrichedLegacyProject = LegacyProject & {
  lastActivity: string | null;
  taskCount: number;
  inProgress: number;
  completed: number;
  backlog: number;
  review: number;
};

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

function readJSON<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function getProjects() {
  const projects = readJSON<LegacyProject[]>(PROJECTS_FILE, []);
  const tasks = readTasksSafely() as LegacyTask[];

  const INACTIVE_DAYS = 7;
  const now = new Date();

  const enriched: EnrichedLegacyProject[] = projects.map((project) => {
    const projectTasks = tasks.filter((task) => task.project === project.id);

    const lastActivity = projectTasks.reduce<string | null>((latest, task) => {
      const next = task.updated || task.created;
      if (!next) return latest;
      return !latest || next > latest ? next : latest;
    }, null);

    let effectiveStatus = project.status;
    if (project.status !== "archived") {
      if (lastActivity) {
        const daysSince = (now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);
        effectiveStatus = daysSince > INACTIVE_DAYS ? "inactive" : "active";
      } else {
        const createdAt = project.created || now.toISOString();
        const daysSinceCreated = (now.getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
        effectiveStatus = daysSinceCreated > INACTIVE_DAYS ? "inactive" : "active";
      }
    }

    return {
      ...project,
      status: effectiveStatus,
      lastActivity,
      taskCount: projectTasks.length,
      inProgress: projectTasks.filter((task) => task.status === "in-progress").length,
      completed: projectTasks.filter((task) => task.status === "done").length,
      backlog: projectTasks.filter((task) => task.status === "backlog").length,
      review: projectTasks.filter((task) => task.status === "review").length,
    };
  });

  enriched.sort((a, b) => {
    const aTime = a.lastActivity || a.created || "";
    const bTime = b.lastActivity || b.created || "";
    return bTime.localeCompare(aTime);
  });

  return enriched;
}
