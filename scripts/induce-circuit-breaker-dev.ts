/**
 * Induce an in-progress-loop circuit-breaker trip against the live dev DB
 * (app/data-dev/orchestration.db) and verify end-to-end that:
 *
 *   1. A synthetic task seeded as `in-progress` increments consecutive_noop_wakes
 *      from 0 → 1 → 2 on successive no-op wakes (no structural events in window).
 *   2. On wake #3 the breaker flips task.status to `blocked`, resets the counter
 *      to 0, emits a task.status_changed event with source=engine_circuit_breaker,
 *      and posts exactly one [AWAITING_HUMAN] blocker comment.
 *
 * Calls the same production `checkAndTripCircuitBreaker` that `finishRun` uses.
 * Runs against the live dev DB while dev (3010) is serving — SQLite WAL tolerates
 * a second writer. Fixture rows are archived at the end so this leaves no real
 * data behind.
 *
 * Run:
 *   cd app && npx tsx scripts/induce-circuit-breaker-dev.ts
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

async function main() {
  // Safety: this script ONLY writes to data-dev. Without an explicit dev DB
  // target we refuse to run rather than fall back to the default (data/ =
  // stable/production). Caller can set MC_DATA_DIR or ORCHESTRATION_DB_PATH;
  // otherwise we pin to app/data-dev/orchestration.db.
  if (!process.env.ORCHESTRATION_DB_PATH && !process.env.MC_DATA_DIR) {
    const devDb = path.resolve(__dirname, "..", "data-dev", "orchestration.db");
    process.env.ORCHESTRATION_DB_PATH = devDb;
  }
  const resolved =
    process.env.ORCHESTRATION_DB_PATH ??
    path.join(process.env.MC_DATA_DIR ?? "", "orchestration.db");
  if (!/\/data-dev\//.test(resolved)) {
    console.error(
      `[induce-circuit-breaker-dev] refusing to run against non-dev DB: ${resolved}`,
    );
    process.exit(2);
  }
  console.log(`[induce-circuit-breaker-dev] DB=${resolved}`);

  const { createProject, createProjectAgent, createTask } = await import(
    "../src/lib/orchestration/service"
  );
  const { getOrchestrationDb } = await import("../src/lib/orchestration/db");
  const { checkAndTripCircuitBreaker } = await import(
    "../src/lib/orchestration/engine/engine"
  );

  const db = getOrchestrationDb();
  const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f"; // Harris Autonomous

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  console.log(`\n[induce-circuit-breaker-dev] stamp=${stamp}`);

  const project = createProject({
    companyId,
    name: `CB induction ${stamp}`,
    description: "Circuit-breaker induction fixture — safe to archive",
    color: "#ef4444",
    emoji: "🚨",
    status: "active",
  }).project;
  console.log(`[induce-circuit-breaker-dev] project=${project.id}`);

  const agent = createProjectAgent({
    projectId: project.id,
    name: `CB Induction Agent ${stamp.slice(-8)}`,
    emoji: "🔧",
    role: "Backend Engineer",
    personality: "Deterministic no-op fixture",
    openclawAgentId: `cb-induction-${randomUUID().slice(0, 8)}`,
    status: "idle",
    skills: ["orchestration"],
  }).agent;
  console.log(`[induce-circuit-breaker-dev] agent=${agent.id}`);

  const task = createTask({
    projectId: project.id,
    title: `CB induction target ${stamp.slice(-8)}`,
    description: "Fixture — do not work",
    priority: "P2",
    type: "feature",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "induce-circuit-breaker-dev",
  }).task;
  console.log(`[induce-circuit-breaker-dev] task=${task.id}`);

  function readTask() {
    return db
      .prepare(
        `SELECT id, status, consecutive_noop_wakes AS noop, blocked_reason
           FROM tasks WHERE id = ? LIMIT 1`,
      )
      .get(task.id) as {
      id: string;
      status: string;
      noop: number;
      blocked_reason: string | null;
    };
  }

  function countBlockerComments() {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM comments
             WHERE task_id = ? AND body LIKE '[AWAITING_HUMAN]%'`,
        )
        .get(task.id) as { n: number }
    ).n;
  }

  function tripStatusEvent() {
    // Target the breaker's status-change event directly. The whole synthetic flow can
    // complete within a single millisecond, tying created_at with the initial
    // task.created event, so ORDER BY created_at DESC LIMIT 1 without a tiebreaker
    // is non-deterministic.
    return db
      .prepare(
        `SELECT event_type, from_status, to_status, metadata_json, created_at
           FROM task_events
          WHERE task_id = ?
            AND event_type = 'task.status_changed'
            AND to_status = 'blocked'
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1`,
      )
      .get(task.id) as
      | {
          event_type: string;
          from_status: string | null;
          to_status: string | null;
          metadata_json: string | null;
          created_at: string;
        }
      | undefined;
  }

  const before = readTask();
  console.log(
    `[induce-circuit-breaker-dev] initial: status=${before.status} noop=${before.noop}`,
  );

  for (let i = 1; i <= 3; i += 1) {
    const runWindowStart = new Date().toISOString();
    const runId = randomUUID();
    const tripped = checkAndTripCircuitBreaker(
      {
        taskId: task.id,
        runId,
        agentId: agent.id,
        runWindowStart,
      },
      db,
    );
    const snap = readTask();
    console.log(
      `[induce-circuit-breaker-dev] wake #${i}: tripped=${tripped} status=${snap.status} noop=${snap.noop}`,
    );
  }

  const finalTask = readTask();
  const blockerCount = countBlockerComments();
  const evt = tripStatusEvent();

  const problems: string[] = [];
  if (finalTask.status !== "blocked") {
    problems.push(`expected status=blocked, got ${finalTask.status}`);
  }
  if (finalTask.noop !== 0) {
    problems.push(`expected noop=0 after trip, got ${finalTask.noop}`);
  }
  if (blockerCount !== 1) {
    problems.push(
      `expected exactly 1 [AWAITING_HUMAN] blocker comment, got ${blockerCount}`,
    );
  }
  if (
    !evt ||
    evt.event_type !== "task.status_changed" ||
    evt.to_status !== "blocked" ||
    !/engine_circuit_breaker/.test(evt.metadata_json ?? "")
  ) {
    problems.push(
      `expected latest event task.status_changed→blocked with source=engine_circuit_breaker, got ${JSON.stringify(evt)}`,
    );
  }

  console.log(`\n[induce-circuit-breaker-dev] final task: ${JSON.stringify(finalTask)}`);
  console.log(`[induce-circuit-breaker-dev] blocker_comments=${blockerCount}`);
  console.log(`[induce-circuit-breaker-dev] last_event=${JSON.stringify(evt)}`);

  console.log(
    `\n[induce-circuit-breaker-dev] HTTP verify: curl -sS http://127.0.0.1:3010/api/tasks/${task.id} | jq '{id, status, blocked_reason}'`,
  );

  const archiveAt = new Date().toISOString();
  db.prepare("UPDATE tasks SET archived_at = ? WHERE id = ?").run(archiveAt, task.id);
  db.prepare("UPDATE agents SET archived_at = ? WHERE id = ?").run(
    archiveAt,
    agent.id,
  );
  db.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").run(
    archiveAt,
    project.id,
  );
  console.log(
    `[induce-circuit-breaker-dev] fixture archived (task=${task.id}, agent=${agent.id}, project=${project.id})`,
  );

  if (problems.length > 0) {
    console.error("\nFAIL:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nPASS: end-to-end circuit breaker tripped on live dev DB.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
