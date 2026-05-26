import { NextRequest, NextResponse } from "next/server";
import { readJSON, readTasks, writeTasks } from "@/lib/build-queue";
import { writeFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const ARCHIVE_FILE = join(process.cwd(), "data", "tasks-archive.json");

function readArchive(): any[] {
  return readJSON(ARCHIVE_FILE, [] as any[]);
}

function writeArchive(tasks: any[]) {
  writeFileSync(ARCHIVE_FILE, JSON.stringify(tasks, null, 2));
}

export async function GET() {
  try {
    const archived = readArchive();
    return NextResponse.json({ tasks: archived });
  } catch (error) {
    console.error("Error reading archive:", error);
    return NextResponse.json({ error: "Failed to load archive" }, { status: 500 });
  }
}

// POST body: { ids?: string[], olderThanHours?: number, all?: boolean }
// - ids: archive specific tasks by id
// - all: true => archive all done tasks
// - olderThanHours: archive done tasks completed more than N hours ago
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ids, olderThanHours, all } = body as {
      ids?: string[];
      olderThanHours?: number;
      all?: boolean;
    };

    const tasks = readTasks();
    const archive = readArchive();
    const now = Date.now();

    const toArchive: any[] = [];
    const remaining: any[] = [];

    for (const task of tasks) {
      let shouldArchive = false;

      if (ids && ids.includes(task.id)) {
        shouldArchive = true;
      } else if (all && task.status === "done") {
        shouldArchive = true;
      } else if (olderThanHours !== undefined && task.status === "done") {
        const completedAt = task.completedAt || task.updated;
        if (completedAt) {
          const ageMs = now - new Date(completedAt).getTime();
          if (ageMs > olderThanHours * 60 * 60 * 1000) {
            shouldArchive = true;
          }
        }
      }

      if (shouldArchive) {
        toArchive.push({ ...task, archivedAt: new Date().toISOString() });
      } else {
        remaining.push(task);
      }
    }

    writeTasks(remaining);
    writeArchive([...toArchive, ...archive]);

    return NextResponse.json({ archived: toArchive.length, remaining: remaining.length });
  } catch (error) {
    console.error("Error archiving tasks:", error);
    return NextResponse.json({ error: "Failed to archive tasks" }, { status: 500 });
  }
}

// DELETE: restore a task from archive back to tasks
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    const tasks = readTasks();
    const archive = readArchive();

    const taskIdx = archive.findIndex((t: any) => t.id === id);
    if (taskIdx === -1) {
      return NextResponse.json({ error: "Task not found in archive" }, { status: 404 });
    }

    const [task] = archive.splice(taskIdx, 1);
    const { archivedAt: _, ...restoredTask } = task;
    tasks.unshift({ ...restoredTask, updated: new Date().toISOString() });

    writeTasks(tasks);
    writeArchive(archive);

    return NextResponse.json({ task: restoredTask });
  } catch (error) {
    console.error("Error restoring task:", error);
    return NextResponse.json({ error: "Failed to restore task" }, { status: 500 });
  }
}
