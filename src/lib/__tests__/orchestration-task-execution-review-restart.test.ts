import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { NextRequest } from "next/server";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  pass ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  fail ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

async function run() {
  console.log("\nTask Execution Review Restart Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mc-task-execution-review-restart-"));
  const previousEnv = {
    ORCHESTRATION_DB_PATH: process.env.ORCHESTRATION_DB_PATH,
    MC_WORKSPACE_ROOT: process.env.MC_WORKSPACE_ROOT,
    MC_DEV_EXECUTION_TEST_MODE: process.env.MC_DEV_EXECUTION_TEST_MODE,
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
  };

  Object.assign(process.env, {
    ORCHESTRATION_DB_PATH: path.join(tempRoot, "orchestration.db"),
    MC_WORKSPACE_ROOT: path.join(tempRoot, ".mission-control", "dev", "workspaces"),
    MC_DEV_EXECUTION_TEST_MODE: "1",
    PORT: "3010",
    NODE_ENV: "development",
  });

  try {
    const { POST } = await import("@/app/api/orchestration/tasks/[id]/execution/route");
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");
    const {
      createProject,
      createProjectAgent,
      createTask,
      getTask,
    } = await import("@/lib/orchestration/service");
    const { updateDevExecutionTestMode } = await import("@/lib/orchestration/service/dev-execution-test-mode");
    const {
      configureCompanyExecutionHive,
      ensureCompanyExecutionHives,
    } = await import("@/lib/orchestration/service/execution-hives");

    const db = getOrchestrationDb();
    const company = createCompany({
      name: `Review Restart Co ${Date.now()}`,
      description: "Review restart fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Review Restart Project",
      description: "Fixture project",
      color: "#0ea5e9",
      emoji: "R",
      status: "active",
    }).project;
    const reviewer = createProjectAgent({
      projectId: project.id,
      name: "Review Runner",
      emoji: "R",
      role: "Reviewer",
      personality: "Reviews work.",
      status: "idle",
      skills: [],
    }).agent;

    db.prepare("UPDATE agents SET adapter_type = 'codex', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), reviewer.id);
    ensureCompanyExecutionHives({ companyIdOrSlug: company.id }, db);
    configureCompanyExecutionHive({
      companyIdOrSlug: company.id,
      hiveId: "balanced-builder",
      orchestrationMode: "symphony",
      runtimeProvider: "codex",
      runtimeLabel: "Codex",
      modelRouting: "hive-managed",
      modelRoutingLabel: "Hive managed",
    }, db);
    updateDevExecutionTestMode({
      companyIdOrSlug: company.id,
      enabled: true,
      durationMinutes: 10,
      actor: "test",
      note: "Review restart route test",
    }, db);

    await test("POST run-now queues review execution without moving the task to in-progress", async () => {
      const task = createTask({
        projectId: project.id,
        title: "Review restart candidate",
        description: "Should keep review state while queuing the reviewer.",
        priority: "P1",
        type: "feature",
        status: "review",
        assignee: reviewer.id,
        labels: ["review"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      const response = await POST(
        new Request(`http://localhost/api/orchestration/tasks/${task.id}/execution`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actorUserId: "test-operator",
            reason: "review_restart_test",
          }),
        }) as unknown as NextRequest,
        { params: Promise.resolve({ id: task.id }) },
      );
      const payload = await response.json() as {
        task: { id: string; status: string };
        transition: { from: string; to: string; statusChanged: boolean };
        execution: { queued: boolean; status: string; runId?: string; reason?: string };
      };

      assert.equal(response.status, 200);
      assert.equal(payload.task.id, task.id);
      assert.equal(payload.task.status, "review");
      assert.deepEqual(payload.transition, {
        from: "review",
        to: "review",
        statusChanged: false,
      });
      assert.equal(payload.execution.queued, true);
      assert.equal(payload.execution.status, "queued");
      assert.ok(payload.execution.runId, "expected queued heartbeat run id");
      assert.equal(payload.execution.reason, "review_restart_test");
      assert.equal(getTask(task.id).task.status, "review");

      const executionRun = db
        .prepare(
          `SELECT status, provider, execution_engine, runner_provider
           FROM execution_runs
           WHERE task_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(task.id) as {
          status: string;
          provider: string;
          execution_engine: string | null;
          runner_provider: string | null;
        } | undefined;
      assert.ok(executionRun, "expected execution run to be created");
      assert.equal(executionRun.status, "pending");
      assert.equal(executionRun.provider, "symphony");
      assert.equal(executionRun.execution_engine, "symphony");
      assert.equal(executionRun.runner_provider, "codex");

      const heartbeatRun = db
        .prepare(
          `SELECT status, context_snapshot_json
           FROM heartbeat_runs
           WHERE id = ?
           LIMIT 1`,
        )
        .get(payload.execution.runId) as {
          status: string;
          context_snapshot_json: string;
        } | undefined;
      assert.ok(heartbeatRun, "expected heartbeat run to be queued");
      assert.equal(heartbeatRun.status, "queued");
      const contextSnapshot = JSON.parse(heartbeatRun.context_snapshot_json) as {
        taskId?: string;
        taskStatus?: string;
        assigneeAgentId?: string;
      };
      assert.equal(contextSnapshot.taskId, task.id);
      assert.equal(contextSnapshot.taskStatus, "review");
      assert.equal(contextSnapshot.assigneeAgentId, reviewer.id);
    });

    closeOrchestrationDb();
  } finally {
    if (previousEnv.ORCHESTRATION_DB_PATH === undefined) {
      delete process.env.ORCHESTRATION_DB_PATH;
    } else {
      process.env.ORCHESTRATION_DB_PATH = previousEnv.ORCHESTRATION_DB_PATH;
    }
    if (previousEnv.MC_WORKSPACE_ROOT === undefined) {
      delete process.env.MC_WORKSPACE_ROOT;
    } else {
      process.env.MC_WORKSPACE_ROOT = previousEnv.MC_WORKSPACE_ROOT;
    }
    if (previousEnv.MC_DEV_EXECUTION_TEST_MODE === undefined) {
      delete process.env.MC_DEV_EXECUTION_TEST_MODE;
    } else {
      process.env.MC_DEV_EXECUTION_TEST_MODE = previousEnv.MC_DEV_EXECUTION_TEST_MODE;
    }
    if (previousEnv.PORT === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousEnv.PORT;
    }
    if (previousEnv.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousEnv.NODE_ENV;
    }
    rmSync(tempRoot, { force: true, recursive: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
