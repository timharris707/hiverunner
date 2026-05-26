/**
 * Contract tests for provider-neutral execution cancellation.
 *
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-execution-cancel.db
 * npx tsx src/lib/__tests__/orchestration-execution-cancel.test.ts
 */

import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  configureCompanyExecutionHive,
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listTaskComments,
} from "@/lib/orchestration/service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  OK ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCancelGrace = process.env.MC_CANCEL_SIGKILL_GRACE_MS;
  process.env.MC_CANCEL_SIGKILL_GRACE_MS = "25";

  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }

    await test("cancelTaskExecution cancels subprocess-backed Codex runs through the adapter", async () => {
      const { cancelTaskExecution } = await import("@/lib/orchestration/execution");
      const db = getOrchestrationDb();
      const company = createCompany({
        name: `Cancel Contract ${Date.now()}`,
        description: "Provider-neutral cancellation fixture",
        status: "active",
      }).company;
      const project = createProject({
        companyId: company.id,
        name: "Cancel Contract Project",
        description: "fixture",
        color: "#0ea5e9",
        emoji: "C",
        status: "active",
      }).project;
      configureCompanyExecutionHive({
        companyIdOrSlug: company.id,
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "codex",
        runtimeLabel: "Codex",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }, db);
      const agent = createProjectAgent({
        projectId: project.id,
        name: "Cancel Contract Agent",
        emoji: "C",
        role: "Engineer",
        personality: "Cancels subprocesses.",
        status: "idle",
        skills: [],
      }).agent;
      db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id = ?").run(agent.id);
      const task = createTask({
        projectId: project.id,
        title: "Cancel Codex run",
        description: "Cancel a subprocess-backed run",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["orchestration"],
        createdBy: "test-suite",
      }).task;

      let child: ChildProcess | null = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      assert.ok(child.pid, "fixture child process should have a PID");
      const runId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
          (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, process_pid)
         VALUES (?, ?, ?, 'codex', 'running', ?, ?, ?, ?)`,
      ).run(runId, task.id, agent.id, now, now, now, child.pid);

      try {
        const cancelled = await cancelTaskExecution({
          taskId: task.id,
          actorUserId: "test-suite",
          note: "Operator canceled subprocess run",
        });

        assert.strictEqual(cancelled.mode, "codex");
        assert.strictEqual(cancelled.cancelled.attempted, true);
        assert.strictEqual(cancelled.cancelled.acknowledged, true);
        assert.strictEqual(cancelled.cancelled.status, "cancelled");
        assert.strictEqual(cancelled.transition.changed, true);
        assert.strictEqual(cancelled.transition.to, "to-do");
        assert.strictEqual(getTask(task.id).task.status, "to-do");

        const row = db
          .prepare("SELECT status, failure_class, process_pid FROM execution_runs WHERE id = ?")
          .get(runId) as { status: string; failure_class: string | null; process_pid: number | null };
        assert.strictEqual(row.status, "cancelled");
        assert.strictEqual(row.failure_class, "cancelled");
        assert.strictEqual(row.process_pid, null);

        const comments = listTaskComments(task.id).comments;
        assert.ok(
          comments.some((comment) => /Codex cancellation requested by HiveRunner/.test(comment.text)),
          "expected provider-neutral cancellation comment",
        );

        child = null;
      } finally {
        if (child?.pid) {
          try {
            process.kill(child.pid, "SIGKILL");
          } catch {
            // Already terminated by the adapter.
          }
        }
      }
    });

    await test("cancelTaskExecution cancels subprocess-backed Anthropic runs through the adapter", async () => {
      const { cancelTaskExecution } = await import("@/lib/orchestration/execution");
      const db = getOrchestrationDb();
      const company = createCompany({
        name: `Cancel Anthropic ${Date.now()}`,
        description: "fixture",
        status: "active",
      }).company;
      const project = createProject({
        companyId: company.id,
        name: "Cancel Anthropic Project",
        description: "fixture",
        color: "#0ea5e9",
        emoji: "A",
        status: "active",
      }).project;
      configureCompanyExecutionHive({
        companyIdOrSlug: company.id,
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "anthropic",
        runtimeLabel: "Anthropic",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }, db);
      const agent = createProjectAgent({
        projectId: project.id,
        name: "Cancel Anthropic Agent",
        emoji: "A",
        role: "Engineer",
        personality: "Cancels subprocesses.",
        status: "idle",
        skills: [],
      }).agent;
      db.prepare("UPDATE agents SET adapter_type = 'anthropic' WHERE id = ?").run(agent.id);
      const task = createTask({
        projectId: project.id,
        title: "Cancel Anthropic run",
        description: "Cancel a subprocess-backed run",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["orchestration"],
        createdBy: "test-suite",
      }).task;

      let child: ChildProcess | null = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      assert.ok(child.pid, "fixture child process should have a PID");
      const runId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
          (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, process_pid)
         VALUES (?, ?, ?, 'anthropic', 'running', ?, ?, ?, ?)`,
      ).run(runId, task.id, agent.id, now, now, now, child.pid);

      try {
        const cancelled = await cancelTaskExecution({
          taskId: task.id,
          actorUserId: "test-suite",
          note: "Operator canceled subprocess run",
        });

        assert.strictEqual(cancelled.mode, "anthropic");
        assert.strictEqual(cancelled.cancelled.acknowledged, true);
        const row = db
          .prepare("SELECT status, failure_class, process_pid FROM execution_runs WHERE id = ?")
          .get(runId) as { status: string; failure_class: string | null; process_pid: number | null };
        assert.strictEqual(row.status, "cancelled");
        assert.strictEqual(row.failure_class, "cancelled");
        assert.strictEqual(row.process_pid, null);
        child = null;
      } finally {
        if (child?.pid) {
          try { process.kill(child.pid, "SIGKILL"); } catch {}
        }
      }
    });

    await test("cancelTaskExecution cancels subprocess-backed Gemini runs through the adapter", async () => {
      const { cancelTaskExecution } = await import("@/lib/orchestration/execution");
      const db = getOrchestrationDb();
      const company = createCompany({ name: `Cancel Gemini ${Date.now()}`, description: "fixture", status: "active" }).company;
      const project = createProject({ companyId: company.id, name: "Cancel Gemini Project", description: "fixture", color: "#0ea5e9", emoji: "G", status: "active" }).project;
      configureCompanyExecutionHive({
        companyIdOrSlug: company.id,
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "gemini",
        runtimeLabel: "Gemini",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }, db);
      const agent = createProjectAgent({ projectId: project.id, name: "Cancel Gemini Agent", emoji: "G", role: "Engineer", personality: "Cancels subprocesses.", status: "idle", skills: [] }).agent;
      db.prepare("UPDATE agents SET adapter_type = 'gemini' WHERE id = ?").run(agent.id);
      const task = createTask({ projectId: project.id, title: "Cancel Gemini run", description: "Cancel a subprocess-backed run", priority: "P1", type: "infrastructure", status: "in-progress", assignee: agent.id, labels: ["orchestration"], createdBy: "test-suite" }).task;

      let child: ChildProcess | null = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      assert.ok(child.pid, "fixture child process should have a PID");
      const runId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
          (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, process_pid)
         VALUES (?, ?, ?, 'gemini', 'running', ?, ?, ?, ?)`,
      ).run(runId, task.id, agent.id, now, now, now, child.pid);

      try {
        const cancelled = await cancelTaskExecution({ taskId: task.id, actorUserId: "test-suite", note: "Operator canceled subprocess run" });
        assert.strictEqual(cancelled.mode, "gemini");
        assert.strictEqual(cancelled.cancelled.acknowledged, true);
        const row = db
          .prepare("SELECT status, failure_class, process_pid FROM execution_runs WHERE id = ?")
          .get(runId) as { status: string; failure_class: string | null; process_pid: number | null };
        assert.strictEqual(row.status, "cancelled");
        assert.strictEqual(row.failure_class, "cancelled");
        assert.strictEqual(row.process_pid, null);
        child = null;
      } finally {
        if (child?.pid) {
          try { process.kill(child.pid, "SIGKILL"); } catch {}
        }
      }
    });

    await test("cancelTaskExecution cancels subprocess-backed Hermes runs through the adapter", async () => {
      const { cancelTaskExecution } = await import("@/lib/orchestration/execution");
      const db = getOrchestrationDb();
      const company = createCompany({ name: `Cancel Hermes ${Date.now()}`, description: "fixture", status: "active" }).company;
      const project = createProject({ companyId: company.id, name: "Cancel Hermes Project", description: "fixture", color: "#0ea5e9", emoji: "H", status: "active" }).project;
      configureCompanyExecutionHive({
        companyIdOrSlug: company.id,
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "hermes",
        runtimeLabel: "Hermes",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }, db);
      const agent = createProjectAgent({ projectId: project.id, name: "Cancel Hermes Agent", emoji: "H", role: "Engineer", personality: "Cancels subprocesses.", status: "idle", skills: [] }).agent;
      db.prepare("UPDATE agents SET adapter_type = 'hermes' WHERE id = ?").run(agent.id);
      const task = createTask({ projectId: project.id, title: "Cancel Hermes run", description: "Cancel a subprocess-backed run", priority: "P1", type: "infrastructure", status: "in-progress", assignee: agent.id, labels: ["orchestration"], createdBy: "test-suite" }).task;

      let child: ChildProcess | null = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      assert.ok(child.pid, "fixture child process should have a PID");
      const runId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
          (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, process_pid)
         VALUES (?, ?, ?, 'hermes', 'running', ?, ?, ?, ?)`,
      ).run(runId, task.id, agent.id, now, now, now, child.pid);

      try {
        const cancelled = await cancelTaskExecution({ taskId: task.id, actorUserId: "test-suite", note: "Operator canceled subprocess run" });
        assert.strictEqual(cancelled.mode, "hermes");
        assert.strictEqual(cancelled.cancelled.acknowledged, true);
        const row = db
          .prepare("SELECT status, failure_class, process_pid FROM execution_runs WHERE id = ?")
          .get(runId) as { status: string; failure_class: string | null; process_pid: number | null };
        assert.strictEqual(row.status, "cancelled");
        assert.strictEqual(row.failure_class, "cancelled");
        assert.strictEqual(row.process_pid, null);
        child = null;
      } finally {
        if (child?.pid) {
          try { process.kill(child.pid, "SIGKILL"); } catch {}
        }
      }
    });

    await test("cancelTaskExecution terminalizes linked heartbeat run and wake request", async () => {
      const { cancelTaskExecution } = await import("@/lib/orchestration/execution");
      const db = getOrchestrationDb();
      const company = createCompany({ name: `Cancel Heartbeat ${Date.now()}`, description: "fixture", status: "active" }).company;
      const project = createProject({ companyId: company.id, name: "Cancel Heartbeat Project", description: "fixture", color: "#0ea5e9", emoji: "H", status: "active" }).project;
      configureCompanyExecutionHive({
        companyIdOrSlug: company.id,
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "symphony",
        runtimeLabel: "Symphony",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }, db);
      const agent = createProjectAgent({ projectId: project.id, name: "Cancel Heartbeat Agent", emoji: "H", role: "Engineer", personality: "Uses heartbeat-backed execution.", status: "idle", skills: [] }).agent;
      db.prepare("UPDATE agents SET adapter_type = 'symphony' WHERE id = ?").run(agent.id);
      const task = createTask({ projectId: project.id, title: "Cancel heartbeat-backed run", description: "Cancel heartbeat-backed execution", priority: "P1", type: "infrastructure", status: "in-progress", assignee: agent.id, labels: ["orchestration"], createdBy: "test-suite" }).task;

      const executionRunId = randomUUID();
      const heartbeatRunId = randomUUID();
      const wakeupRequestId = randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO execution_runs
          (id, task_id, agent_id, provider, execution_engine, runner_provider, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'symphony', 'symphony', 'symphony', 'running', ?, ?, ?)`,
      ).run(executionRunId, task.id, agent.id, now, now, now);
      db.prepare(
        `INSERT INTO agent_wakeup_requests
          (id, agent_id, company_id, source, reason, payload_json, status, run_id, requested_at, claimed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'issue_assigned', 'task_created_in_progress', ?, 'claimed', ?, ?, ?, ?, ?)`,
      ).run(
        wakeupRequestId,
        agent.id,
        company.id,
        JSON.stringify({ taskId: task.id, executionRunId }),
        heartbeatRunId,
        now,
        now,
        now,
        now,
      );
      db.prepare(
        `INSERT INTO heartbeat_runs
          (id, agent_id, company_id, invocation_source, trigger_detail, status, started_at, wakeup_request_id, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'issue_assigned', 'cancel fixture', 'running', ?, ?, ?, ?, ?)`,
      ).run(
        heartbeatRunId,
        agent.id,
        company.id,
        now,
        wakeupRequestId,
        JSON.stringify({ taskId: task.id, executionRunId }),
        now,
        now,
      );

      const cancelled = await cancelTaskExecution({ taskId: task.id, actorUserId: "test-suite", note: "Operator canceled heartbeat-backed run" });
      assert.strictEqual(cancelled.mode, "symphony");
      assert.strictEqual(cancelled.cancelled.acknowledged, true);

      const heartbeat = db
        .prepare("SELECT status, finished_at, error FROM heartbeat_runs WHERE id = ?")
        .get(heartbeatRunId) as { status: string; finished_at: string | null; error: string | null };
      assert.strictEqual(heartbeat.status, "cancelled");
      assert.ok(heartbeat.finished_at, "heartbeat run should be finished");
      assert.match(heartbeat.error ?? "", /cancelled/i);

      const wakeup = db
        .prepare("SELECT status, finished_at FROM agent_wakeup_requests WHERE id = ?")
        .get(wakeupRequestId) as { status: string; finished_at: string | null };
      assert.strictEqual(wakeup.status, "failed");
      assert.ok(wakeup.finished_at, "wake request should be finished");
    });
  } finally {
    if (originalCancelGrace === undefined) {
      delete process.env.MC_CANCEL_SIGKILL_GRACE_MS;
    } else {
      process.env.MC_CANCEL_SIGKILL_GRACE_MS = originalCancelGrace;
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
  console.log(`\n${passed} passed, ${failed} failed`);
}

run().catch((error) => {
  failed += 1;
  console.error(error);
  process.exitCode = 1;
});
