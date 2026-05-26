/**
 * Regression coverage for immediate dependent-task wakeups.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-dependent-unblock-wakeup.db \
 *     npx tsx src/lib/__tests__/orchestration-dependent-unblock-wakeup.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

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

console.log("\nOrchestration dependent unblock wakeup test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask, moveTask } =
      await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb();
    db.prepare("UPDATE companies SET status = 'active', archived_at = NULL WHERE id = ?").run(companyId);

    function makeProject(tag: string) {
      return createProject({
        companyId,
        name: `Dependent unblock ${tag} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: "Dependent unblock fixture",
        color: "#2563eb",
        emoji: "D",
        status: "active",
      }).project;
    }

    function makeAgent(projectId: string, tag: string) {
      return createProjectAgent({
        projectId,
        name: `Dependent Agent ${tag}-${Math.random().toString(36).slice(2, 6)}`,
        emoji: "A",
        role: "Implementation Engineer",
        personality: "Deterministic",
        openclawAgentId: `dependent-${tag}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
    }

    function setDependsOn(taskId: string, dependencyIds: string[]) {
      db.prepare("UPDATE tasks SET depends_on_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(dependencyIds), new Date().toISOString(), taskId);
    }

    await test("done transition queues issue_assigned wake for newly runnable assigned dependent", () => {
      const project = makeProject("done");
      const producer = makeAgent(project.id, "producer-done");
      const assignee = makeAgent(project.id, "assignee-done");
      const dependency = createTask({
        projectId: project.id,
        title: "Implement prerequisite",
        description: "Upstream work",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: producer.id,
        labels: [],
        createdBy: "dependent-unblock-test",
      }).task;
      const dependent = createTask({
        projectId: project.id,
        title: "Continue after prerequisite",
        description: "Downstream work",
        priority: "P2",
        type: "feature",
        status: "to-do",
        assignee: assignee.id,
        labels: [],
        createdBy: "dependent-unblock-test",
      }).task;
      setDependsOn(dependent.id, [dependency.id]);

      moveTask({ taskId: dependency.id, status: "done", actorUserId: "dependent-unblock-test" });

      const wake = db
        .prepare(
          `SELECT source, reason, status, idempotency_key, run_id, payload_json
           FROM agent_wakeup_requests
           WHERE agent_id = ?
             AND json_extract(payload_json, '$.taskId') = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(assignee.id, dependent.id) as
          | { source: string; reason: string; status: string; idempotency_key: string; run_id: string; payload_json: string }
          | undefined;

      assert.ok(wake, "dependent assignee should receive an immediate wake");
      assert.equal(wake.source, "issue_assigned");
      assert.equal(wake.reason, "dependency_unblocked_assigned_task");
      assert.equal(wake.status, "queued");
      assert.equal(wake.idempotency_key, `sweep:${dependent.id}:to-do`);

      const run = db
        .prepare(
          `SELECT invocation_source, status, context_snapshot_json
           FROM heartbeat_runs
           WHERE id = ?
           LIMIT 1`,
        )
        .get(wake.run_id) as { invocation_source: string; status: string; context_snapshot_json: string } | undefined;
      assert.equal(run?.invocation_source, "issue_assigned");
      assert.equal(run?.status, "queued");
      const snapshot = JSON.parse(run?.context_snapshot_json ?? "{}") as Record<string, unknown>;
      assert.equal(snapshot.wakeSource, "issue_assigned");
      assert.equal(snapshot.taskId, dependent.id);
      assert.equal(snapshot.unblockedByTaskId, dependency.id);
    });

    await test("review transition does not satisfy dependency gates", () => {
      const project = makeProject("review");
      const producer = makeAgent(project.id, "producer-review");
      const qaAssignee = makeAgent(project.id, "qa-review");
      const featureAssignee = makeAgent(project.id, "feature-review");
      const dependency = createTask({
        projectId: project.id,
        title: "Build reviewed artifact",
        description: "Upstream implementation",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: producer.id,
        labels: [],
        createdBy: "dependent-unblock-test",
      }).task;
      const qaDependent = createTask({
        projectId: project.id,
        title: "QA verification of reviewed artifact",
        description: "QA can start at review.",
        priority: "P2",
        type: "qa",
        status: "to-do",
        assignee: qaAssignee.id,
        labels: [],
        createdBy: "dependent-unblock-test",
      }).task;
      const featureDependent = createTask({
        projectId: project.id,
        title: "Package final implementation",
        description: "Non-QA work still waits for done.",
        priority: "P2",
        type: "feature",
        status: "to-do",
        assignee: featureAssignee.id,
        labels: [],
        createdBy: "dependent-unblock-test",
      }).task;
      setDependsOn(qaDependent.id, [dependency.id]);
      setDependsOn(featureDependent.id, [dependency.id]);

      moveTask({ taskId: dependency.id, status: "review", actorUserId: "dependent-unblock-test" });

      const qaWake = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM agent_wakeup_requests
           WHERE agent_id = ?
             AND json_extract(payload_json, '$.taskId') = ?
           LIMIT 1`,
        )
        .get(qaAssignee.id, qaDependent.id) as { n: number };
      assert.equal(qaWake.n, 0, "review is not complete enough to unlock dependent work");

      const featureWake = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM agent_wakeup_requests
           WHERE agent_id = ?
             AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(featureAssignee.id, featureDependent.id) as { n: number };
      assert.equal(featureWake.n, 0, "non-verification dependents should still wait for done");
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
