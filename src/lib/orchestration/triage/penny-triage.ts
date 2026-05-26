import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
};

type RunnableAgentRow = {
  id: string;
  name: string;
  status: string | null;
  adapter_type: string | null;
};

const PENNY_AGENT_NAME = "Penny";

function findAgentByName(
  runnableAgents: RunnableAgentRow[],
  name: string,
): RunnableAgentRow | undefined {
  const needle = name.trim().toLowerCase();
  return runnableAgents.find((agent) => agent.name.trim().toLowerCase() === needle);
}

/**
 * Spawns a Penny triage micro-task for an ambiguous, unassigned task.
 *
 * 1. Finds the "Penny" agent.
 * 2. Creates a new task of type 'triage' assigned to Penny.
 * 3. Sets the original task as the parent of the new micro-task.
 * 4. Adds a 'triage_pending' guard to the parent task to prevent re-sweeping.
 */
export function spawnPennyTriageMicroTask(
  db: Database.Database,
  parentTask: TaskRow,
  runnableAgents: RunnableAgentRow[],
): { spawned: boolean; reason?: string } {
  const penny = findAgentByName(runnableAgents, PENNY_AGENT_NAME);
  if (!penny) {
    return { spawned: false, reason: "Penny agent not found or not runnable." };
  }

  const now = new Date().toISOString();
  const microTaskId = randomUUID();

  const tx = db.transaction(() => {
    // Create the Penny micro-task
    db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, type, status, priority, assignee_agent_id, parent_task_id, created_at, updated_at, assigned_at)
       VALUES (?, ?, ?, ?, 'triage', 'to-do', 'low', ?, ?, ?, ?, ?)`,
    ).run(
      microTaskId,
      parentTask.project_id,
      `Triage: ${parentTask.title}`,
      `Review the following task and assign it to the correct agent:

---

**Title:** ${parentTask.title}

**Description:**
${parentTask.description ?? "No description."}`,
      penny.id,
      parentTask.id,
      now,
      now,
      now,
    );

    // Add a 'triage_pending' guard to the parent task.
    db.prepare(
      `UPDATE tasks
       SET blocked_reason = 'triage_pending', updated_at = ?
       WHERE id = ?`,
    ).run(now, parentTask.id);

    // Add a comment to the parent task
    db.prepare(
      `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'comment', 'engine', ?, ?)`,
    ).run(
      randomUUID(),
      parentTask.id,
      `[ORCHESTRATION] No direct assignee found. Spawning a triage micro-task for Penny to route.`,
      now,
      now,
    );
  });

  try {
    tx();
    return { spawned: true };
  } catch (err: unknown) {
    return { spawned: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
