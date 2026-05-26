/**
 * Regression coverage for agent-created tasks assigned to unavailable agents.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-create-task-offline-assignee.db \
 *     node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-create-task-offline-assignee.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration create_task offline assignee routing\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } =
      await import("@/lib/orchestration/service");
    const { ensureCompanyExecutionHives } =
      await import("@/lib/orchestration/service/execution-hives");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { executeCreateTask } = await import("@/lib/orchestration/engine/engine");

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb();
    db.prepare("UPDATE companies SET status = 'active', archived_at = NULL WHERE id = ?").run(companyId);
    ensureCompanyExecutionHives({ companyIdOrSlug: companyId }, db);

    function makeProject(tag: string) {
      return createProject({
        companyId,
        name: `Offline assignee ${tag} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: "Offline assignee fixture",
        color: "#0f766e",
        emoji: "O",
        status: "active",
      }).project;
    }

    function makeAgent(projectId: string, tag: string, status: "idle" | "offline" = "idle") {
      const slug = tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return createProjectAgent({
        projectId,
        name: `${tag}-${Math.random().toString(36).slice(2, 6)}`,
        emoji: "A",
        role: "Implementation Engineer",
        personality: "Deterministic",
        openclawAgentId: `offline-assignee-${slug}-${randomUUID()}`,
        status,
        skills: ["orchestration"],
      }).agent;
    }

    await test("new task assigned to an offline agent reroutes to an online executor and queues one wake", async () => {
      const project = makeProject("fallback");
      const source = makeAgent(project.id, "Zed Source");
      const offline = makeAgent(project.id, "Corey Offline", "offline");
      const fallback = makeAgent(project.id, "Aaron Online");
      const parent = createTask({
        projectId: project.id,
        title: `Parent rollup ${Date.now()}`,
        description: "Parent waits on child work.",
        priority: "P1",
        type: "directive",
        status: "to-do",
        assignee: source.id,
        labels: [],
        createdBy: "offline-assignee-test",
      }).task;

      const childTitle = `Frontend child assigned offline ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const childTaskId = await executeCreateTask(
        {
          action: "create_task",
          title: childTitle,
          description: "Frontend implementation should not stall on the offline requested assignee.",
          assignee: offline.name,
          parent: parent.key,
        },
        {
          agentId: source.id,
          agentName: source.name,
          companyId: project.companyId,
          taskKey: parent.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(childTaskId, "create_task should create the child task");

      const child = db
        .prepare("SELECT status, assignee_agent_id, parent_task_id FROM tasks WHERE id = ?")
        .get(childTaskId) as { status: string; assignee_agent_id: string | null; parent_task_id: string | null };
      assert.equal(child.parent_task_id, parent.id);
      assert.equal(child.status, "in_progress");
      assert.equal(child.assignee_agent_id, fallback.id, "offline assignee should be replaced by the online fallback");

      const fallbackWakes = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM agent_wakeup_requests
           WHERE agent_id = ?
             AND json_extract(payload_json, '$.taskId') = ?
             AND status IN ('queued', 'claimed')`,
        )
        .get(fallback.id, childTaskId) as { n: number };
      assert.equal(fallbackWakes.n, 1, "fallback executor should receive exactly one active wake");

      const offlineWakes = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM agent_wakeup_requests
           WHERE agent_id = ?
             AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(offline.id, childTaskId) as { n: number };
      assert.equal(offlineWakes.n, 0, "offline assignee should not receive a silent queued wake");

      const reassignment = db
        .prepare(
          `SELECT metadata_json
           FROM task_events
           WHERE task_id = ? AND event_type = 'task.reassigned'
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(childTaskId) as { metadata_json: string } | undefined;
      assert.ok(reassignment, "fallback should leave a reassignment event");
      const metadata = JSON.parse(reassignment.metadata_json) as Record<string, unknown>;
      assert.equal(metadata.source, "create_task_unavailable_assignee_fallback");
      assert.equal(metadata.from, offline.id);
      assert.equal(metadata.to, fallback.id);

      const parentRow = db
        .prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?")
        .get(parent.id) as { status: string; assignee_agent_id: string | null };
      assert.equal(parentRow.status, "in_progress", "parent reflects child progress as roll-up state");
      assert.equal(parentRow.assignee_agent_id, source.id);
      const parentWake = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM agent_wakeup_requests
           WHERE agent_id = ?
             AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(source.id, parent.id) as { n: number };
      assert.equal(parentWake.n, 0, "parent roll-up in_progress should not imply a parent run was queued");

      const duplicate = await executeCreateTask(
        {
          action: "create_task",
          title: childTitle,
          description: "Duplicate retry should be deduped.",
          assignee: offline.name,
          parent: parent.key,
        },
        {
          agentId: source.id,
          agentName: source.name,
          companyId: project.companyId,
          taskKey: parent.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.equal(duplicate, null, "duplicate create_task retry should be skipped");
      const postRetryWakes = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM agent_wakeup_requests
           WHERE agent_id = ?
             AND json_extract(payload_json, '$.taskId') = ?
             AND status IN ('queued', 'claimed')`,
        )
        .get(fallback.id, childTaskId) as { n: number };
      assert.equal(postRetryWakes.n, 1, "duplicate retry should not create another wake");
    });

    await test("new task assigned to an offline agent is explicitly blocked when no fallback is available", async () => {
      const project = makeProject("blocked");
      const source = makeAgent(project.id, "Offline Source", "offline");
      const offline = makeAgent(project.id, "Corey Solo", "offline");
      const parent = createTask({
        projectId: project.id,
        title: `Blocked parent ${Date.now()}`,
        description: "No online fallback exists.",
        priority: "P1",
        type: "directive",
        status: "to-do",
        assignee: source.id,
        labels: [],
        createdBy: "offline-assignee-test",
      }).task;

      const taskId = await executeCreateTask(
        {
          action: "create_task",
          title: `No fallback child ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          description: "This should surface an explicit routing block.",
          assignee: offline.name,
          parent: parent.key,
        },
        {
          agentId: source.id,
          agentName: source.name,
          companyId: project.companyId,
          taskKey: parent.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(taskId, "create_task should create the child task");

      const child = db
        .prepare("SELECT status, assignee_agent_id, blocked_reason FROM tasks WHERE id = ?")
        .get(taskId) as { status: string; assignee_agent_id: string | null; blocked_reason: string | null };
      assert.equal(child.status, "blocked");
      assert.equal(child.assignee_agent_id, offline.id);
      assert.match(child.blocked_reason ?? "", /Needs routing/);

      const wakes = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(taskId) as { n: number };
      assert.equal(wakes.n, 0, "blocked no-fallback path should not enqueue a dead wake");
    });
  } catch (err) {
    console.error("Test harness crashed:", err);
    process.exitCode = 1;
  } finally {
    const total = passed + failed;
    console.log(`\nResult: ${passed}/${total} passed`);
    if (failed > 0) process.exitCode = 1;
  }
}

void run();
