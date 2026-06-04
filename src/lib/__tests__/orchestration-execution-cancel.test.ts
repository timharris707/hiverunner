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

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
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

const { finish, test } = createTestRunner({ passLabel: "OK", failLabel: "FAIL" });

type SubprocessProvider = "codex" | "anthropic" | "gemini" | "hermes";

type SubprocessCancellationFixture = {
  db: ReturnType<typeof getOrchestrationDb>;
  task: ReturnType<typeof createTask>["task"];
  runId: string;
};

type ExecutionRunCancellationRow = {
  status: string;
  failure_class: string | null;
  process_pid: number | null;
};

const subprocessProviderFixtures: Record<
  SubprocessProvider,
  { label: string; emoji: string; fixtureLabel?: string; companyDescription?: string }
> = {
  codex: {
    label: "Codex",
    emoji: "C",
    fixtureLabel: "Contract",
    companyDescription: "Provider-neutral cancellation fixture",
  },
  anthropic: { label: "Anthropic", emoji: "A" },
  gemini: { label: "Gemini", emoji: "G" },
  hermes: { label: "Hermes", emoji: "H" },
};

async function withRunningSubprocessCancellationFixture(
  provider: SubprocessProvider,
  fn: (fixture: SubprocessCancellationFixture) => Promise<void> | void,
) {
  const { companyDescription, emoji, fixtureLabel, label } = subprocessProviderFixtures[provider];
  const fixtureName = fixtureLabel ?? label;
  const db = getOrchestrationDb();
  const company = createCompany({
    name: `Cancel ${fixtureName} ${Date.now()}`,
    description: companyDescription ?? "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Cancel ${fixtureName} Project`,
    description: "fixture",
    color: "#0ea5e9",
    emoji,
    status: "active",
  }).project;
  configureCompanyExecutionHive(
    {
      companyIdOrSlug: company.id,
      hiveId: "balanced-builder",
      orchestrationMode: "hiverunner",
      runtimeProvider: provider,
      runtimeLabel: label,
      modelRouting: "runtime-managed",
      modelRoutingLabel: "Runtime managed",
    },
    db,
  );
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Cancel ${fixtureName} Agent`,
    emoji,
    role: "Engineer",
    personality: "Cancels subprocesses.",
    status: "idle",
    skills: [],
  }).agent;
  db.prepare("UPDATE agents SET adapter_type = ? WHERE id = ?").run(provider, agent.id);
  const task = createTask({
    projectId: project.id,
    title: `Cancel ${label} run`,
    description: "Cancel a subprocess-backed run",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    labels: ["orchestration"],
    createdBy: "test-suite",
  }).task;

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  const pid = child.pid;
  assert.ok(pid, "fixture child process should have a PID");
  const runId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO execution_runs
      (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, process_pid)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
  ).run(runId, task.id, agent.id, provider, now, now, now, pid);

  try {
    await fn({ db, task, runId });
  } finally {
    if (executionRunStillHasProcess(db, runId)) {
      killChildProcess(child);
    }
  }
}

function assertExecutionRunCancelled(db: ReturnType<typeof getOrchestrationDb>, runId: string) {
  const row = db
    .prepare("SELECT status, failure_class, process_pid FROM execution_runs WHERE id = ?")
    .get(runId) as ExecutionRunCancellationRow | undefined;
  assert.ok(row, "expected execution run row");
  assert.strictEqual(row.status, "cancelled");
  assert.strictEqual(row.failure_class, "cancelled");
  assert.strictEqual(row.process_pid, null);
}

function executionRunStillHasProcess(db: ReturnType<typeof getOrchestrationDb>, runId: string) {
  const row = db
    .prepare("SELECT process_pid FROM execution_runs WHERE id = ?")
    .get(runId) as { process_pid: number | null } | undefined;
  return row?.process_pid !== null;
}

function killChildProcess(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(child.pid, "SIGKILL");
  } catch {
    // Already terminated by the adapter.
  }
}

async function run() {
  const originalCancelGrace = process.env.MC_CANCEL_SIGKILL_GRACE_MS;
  process.env.MC_CANCEL_SIGKILL_GRACE_MS = "25";

  try {
    resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

    await test("cancelTaskExecution cancels subprocess-backed Codex runs through the adapter", async () => {
      const { cancelTaskExecution } = await import("@/lib/orchestration/execution");

      await withRunningSubprocessCancellationFixture("codex", async ({ db, task, runId }) => {
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

        assertExecutionRunCancelled(db, runId);

        const comments = listTaskComments(task.id).comments;
        assert.ok(
          comments.some((comment) => /Codex cancellation requested by HiveRunner/.test(comment.text)),
          "expected provider-neutral cancellation comment",
        );
      });
    });

    for (const provider of ["anthropic", "gemini", "hermes"] as const) {
      const { label } = subprocessProviderFixtures[provider];

      await test(`cancelTaskExecution cancels subprocess-backed ${label} runs through the adapter`, async () => {
        const { cancelTaskExecution } = await import("@/lib/orchestration/execution");

        await withRunningSubprocessCancellationFixture(provider, async ({ db, task, runId }) => {
          const cancelled = await cancelTaskExecution({
            taskId: task.id,
            actorUserId: "test-suite",
            note: "Operator canceled subprocess run",
          });

          assert.strictEqual(cancelled.mode, provider);
          assert.strictEqual(cancelled.cancelled.acknowledged, true);
          assertExecutionRunCancelled(db, runId);
        });
      });
    }

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

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
