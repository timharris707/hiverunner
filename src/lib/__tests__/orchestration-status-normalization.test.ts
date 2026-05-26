/**
 * Regression test for NEVA-113:
 * normalize legacy/invalid orchestration status tokens in SQLite.
 *
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-status-normalization.db
 * npx tsx src/lib/__tests__/orchestration-status-normalization.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Status Normalization Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for this test");
  }

  rmSync(dbPath, { force: true });

  const { getOrchestrationDb, normalizeOrchestrationStatusValues } = await import(
    "@/lib/orchestration/db"
  );
  const db = getOrchestrationDb();

  const companyId = randomUUID();
  const projectId = randomUUID();
  const agentId = randomUUID();
  const taskId = randomUUID();
  const eventId = randomUUID();

  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO companies (
      id, slug, name, description, status, theme_name, theme_prompt_template, theme_keywords_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, '[]', ?, ?)`
  ).run(companyId, `status-norm-${Date.now()}`, "Status Norm Co", "", "Corporate Noir", "prompt", now, now);

  db.prepare(
    `INSERT INTO projects (
      id, company_id, slug, name, description, color, status, owner_user_id, settings_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', '#0ea5e9', 'active', 'test', '{}', ?, ?)`
  ).run(projectId, companyId, `status-norm-project-${Date.now()}`, "Status Norm Project", now, now);

  db.prepare(
    `INSERT INTO agents (
      id, company_id, project_id, name, emoji, role, personality, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'Forge', '🔧', 'Backend Engineer', '', 'idle', ?, ?)`
  ).run(agentId, companyId, projectId, now, now);

  db.prepare(
    `INSERT INTO tasks (
      id, project_id, title, description, priority, type, status, column_order, assignee_agent_id, created_by, labels_json, depends_on_json, created_at, updated_at
    ) VALUES (?, ?, 'Legacy status task', '', 'medium', 'feature', 'backlog', 1000, ?, 'test', '[]', '[]', ?, ?)`
  ).run(taskId, projectId, agentId, now, now);

  db.prepare(
    `INSERT INTO task_events (
      id, project_id, task_id, event_type, from_status, to_status, metadata_json, created_at
    ) VALUES (?, ?, ?, 'task.status_changed', 'backlog', 'to-do', '{}', ?)`
  ).run(eventId, projectId, taskId, now);

  db.pragma("ignore_check_constraints = ON");
  db.prepare("UPDATE tasks SET status = 'in-progress' WHERE id = ?").run(taskId);
  db.prepare("UPDATE task_events SET from_status = 'to-do', to_status = 'in-progress' WHERE id = ?").run(eventId);
  db.prepare(
    `INSERT OR REPLACE INTO status_transition_rules (
      from_status, to_status, requires_assignee, requires_review, is_terminal
    ) VALUES ('to-do', 'in-progress', 1, 0, 0)`
  ).run();
  db.pragma("ignore_check_constraints = OFF");

  await test("normalizes task and task_event status values to canonical DB format", () => {
    const result = normalizeOrchestrationStatusValues(db);
    assert.ok(result.tasksNormalized >= 1, "expected at least one task row to normalize");
    assert.ok(result.taskEventsNormalized >= 2, "expected at least two task_event columns to normalize");

    const taskRow = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string };
    assert.strictEqual(taskRow.status, "in_progress");

    const eventRow = db
      .prepare("SELECT from_status, to_status FROM task_events WHERE id = ?")
      .get(eventId) as { from_status: string | null; to_status: string | null };
    assert.strictEqual(eventRow.from_status, "to-do");
    assert.strictEqual(eventRow.to_status, "in_progress");
  });

  await test("normalizes status_transition_rules and keeps only canonical statuses", () => {
    const invalidCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM status_transition_rules
         WHERE from_status NOT IN ('backlog','to-do','in_progress','review','done','blocked')
            OR to_status NOT IN ('backlog','to-do','in_progress','review','done','blocked')`
      )
      .get() as { count: number };

    assert.strictEqual(invalidCount.count, 0);

    const normalizedRule = db
      .prepare(
        `SELECT from_status, to_status
         FROM status_transition_rules
         WHERE from_status = 'to-do' AND to_status = 'in_progress'
         LIMIT 1`
      )
      .get() as { from_status: string; to_status: string } | undefined;
    assert.ok(normalizedRule, "expected normalized to-do -> in_progress rule to exist");
  });

  await test("normalization is idempotent on second run", () => {
    const second = normalizeOrchestrationStatusValues(db);
    assert.strictEqual(second.tasksNormalized, 0);
    assert.strictEqual(second.taskEventsNormalized, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

