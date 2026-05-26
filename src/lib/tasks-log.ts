/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * tasks-log.ts — Bidirectional sync between tasks.json and tasks-log.md
 *
 * Outbound: when a task completes in HiveRunner -> append done/failed to tasks-log.md
 * Inbound:  when tasks-log.md has external entries not in tasks.json → import them
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { HIVE_RUNNER_WORKSPACE } from "@/lib/paths";

const WORKSPACE = HIVE_RUNNER_WORKSPACE;
const TASKS_LOG_PATH = join(WORKSPACE, "memory", "tasks-log.md");

export interface LogEntry {
  id: string;        // e.g. "TASK-001" or "TASK-1740000000"
  date: string;      // "YYYY-MM-DD"
  outcome: "done" | "failed";
  description: string;
  rawLine: string;
}

// ─── Outbound: append a task completion to tasks-log.md ─────────────────────

export function appendTaskToLog(
  task: { id: string; title: string; project?: string },
  outcome: "done" | "failed"
): void {
  try {
    const today = new Date().toISOString().split("T")[0];
    const icon = outcome === "done" ? "✅" : "❌";
    const projectSuffix = task.project ? ` → ${task.project}` : "";
    const line = `- ${icon} ${task.id}: ${task.title}${projectSuffix}`;

    let content = "";
    if (existsSync(TASKS_LOG_PATH)) {
      content = readFileSync(TASKS_LOG_PATH, "utf-8");
    } else {
      content =
        "# tasks-log.md — Completed Tasks (append-only)\n" +
        "# Sub-agents: ALWAYS append to the END. Never edit existing lines.\n" +
        "# Main session: archive old entries weekly to memory/tasks-archive/\n\n";
    }

    // Don't double-log — if this task ID already appears in the file, skip
    const idPattern = new RegExp(`(✅|❌)\\s+${escapeRegex(task.id)}:`);
    if (idPattern.test(content)) return;

    const sectionHeader = `### ${today}`;
    if (content.includes(sectionHeader)) {
      // Find the end of today's section (next ### or EOF)
      const sectionIdx = content.indexOf(sectionHeader);
      const nextSectionIdx = content.indexOf("\n### ", sectionIdx + 1);
      const insertAt = nextSectionIdx === -1 ? content.length : nextSectionIdx;
      content =
        content.slice(0, insertAt).trimEnd() +
        "\n" +
        line +
        "\n" +
        (nextSectionIdx === -1 ? "" : content.slice(nextSectionIdx));
    } else {
      // Append a new date section at the end
      content = content.trimEnd() + "\n\n" + sectionHeader + "\n" + line + "\n";
    }

    writeFileSync(TASKS_LOG_PATH, content, "utf-8");
  } catch (err) {
    console.error("[tasks-log] Failed to append to tasks-log.md:", err);
  }
}

// ─── Parse: read all entries from tasks-log.md ──────────────────────────────

export function parseTasksLog(): LogEntry[] {
  if (!existsSync(TASKS_LOG_PATH)) return [];

  const content = readFileSync(TASKS_LOG_PATH, "utf-8");
  const entries: LogEntry[] = [];
  let currentDate = "";

  for (const line of content.split("\n")) {
    if (line.startsWith("### ")) {
      const m = line.match(/###\s+(\d{4}-\d{2}-\d{2})/);
      if (m) currentDate = m[1];
      continue;
    }

    const doneMatch = line.match(/^-\s+✅\s+(TASK-[\w-]+):\s+(.+)$/);
    if (doneMatch) {
      entries.push({
        id: doneMatch[1],
        date: currentDate,
        outcome: "done",
        description: doneMatch[2].trim(),
        rawLine: line,
      });
      continue;
    }

    const failedMatch = line.match(/^-\s+❌\s+(TASK-[\w-]+):\s+(.+)$/);
    if (failedMatch) {
      entries.push({
        id: failedMatch[1],
        date: currentDate,
        outcome: "failed",
        description: failedMatch[2].trim(),
        rawLine: line,
      });
    }
  }

  return entries;
}

// ─── Inbound: import external log entries not yet in tasks.json ─────────────

/**
 * Returns new task objects for any tasks-log.md entries that:
 * 1. Use sequential IDs (TASK-001 … TASK-9999) — i.e. written by external agents
 * 2. Don't already exist in the provided tasks array
 */
export function importExternalTasks(existingTasks: any[]): any[] {
  const logEntries = parseTasksLog();
  const existingIds = new Set(existingTasks.map((t: any) => t.id));
  const newTasks: any[] = [];

  for (const entry of logEntries) {
    // Only auto-import short sequential IDs (TASK-001 style) — not MC timestamp IDs
    if (!/^TASK-\d{1,6}$/.test(entry.id)) continue;
    if (existingIds.has(entry.id)) continue;

    const created = entry.date
      ? `${entry.date}T00:00:00.000Z`
      : new Date().toISOString();

    // Parse project from "→ project-name" or "→ projects/project-name/..."
    const project = extractProject(entry.description);

    newTasks.push({
      id: entry.id,
      title: entry.description.split(" → ")[0].trim(),
      description: entry.description,
      status: entry.outcome === "done" ? "done" : "in-progress",
      priority: "P2",
      assignee: "HiveRunner",
      project: project || undefined,
      type: "feature",
      tags: ["log-import"],
      source: "tasks-log",
      buildState: entry.outcome === "done" ? "completed" : "failed",
      completedAt: entry.outcome === "done" ? created : undefined,
      created,
      updated: created,
    });
  }

  return newTasks;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractProject(description: string): string | undefined {
  const arrow = description.split(" → ")[1];
  if (!arrow) return undefined;
  const parts = arrow.trim().split("/");
  if (parts[0] === "projects" && parts.length > 1) return parts[1];
  // If no path structure, use the first word of the arrow part as project hint
  const first = parts[0].trim().split(" ")[0];
  return first || undefined;
}
