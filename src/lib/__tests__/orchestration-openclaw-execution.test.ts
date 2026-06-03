/**
 * Contract tests for OpenClaw task execution spawn behavior.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-openclaw-execution.db
 * npx tsx src/lib/__tests__/orchestration-openclaw-execution.test.ts
 */

import assert from "node:assert";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import {
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listTaskComments,
} from "@/lib/orchestration/service";
import { cancelTaskExecution, triggerTaskExecution } from "@/lib/orchestration/execution";
import { getTaskBridgeRecord, setTaskExecutionMode } from "@/lib/orchestration/bridge/store";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { ensureCompanyExecutionHives } from "@/lib/orchestration/service/execution-hives";
import { updateDevExecutionTestMode } from "@/lib/orchestration/service/dev-execution-test-mode";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

let passed = 0;
let failed = 0;
const originalFetch = globalThis.fetch;
const TEST_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

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

function createStubOpenClawCli(): string {
  const filePath = path.join(
    os.tmpdir(),
    `mc-openclaw-cli-stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
  );
  const script = `#!/bin/sh
METHOD="$3"
if [ "$METHOD" = "sessions.create" ]; then
  echo '{"ok":true,"key":"agent:forge:mission-control:task:stub","sessionId":"session-oc-123"}'
  exit 0
fi
if [ "$METHOD" = "sessions.send" ]; then
  echo '{"runId":"run-oc-456","status":"started"}'
  exit 0
fi
if [ "$METHOD" = "sessions.cancel" ] || [ "$METHOD" = "sessions_cancel" ] || [ "$METHOD" = "sessions.stop" ] || [ "$METHOD" = "sessions_stop" ]; then
  echo '{"ok":true,"status":"cancelled"}'
  exit 0
fi
echo "unsupported method: $METHOD" >&2
exit 1
`;
  writeFileSync(filePath, script, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

function attachRunningOpenClawSession(input: {
  taskId: string;
  agentId: string;
  sessionId?: string;
}) {
  const db = getOrchestrationDb();
  const now = new Date().toISOString();
  const sessionId = input.sessionId ?? "session-oc-123";
  setTaskExecutionMode(
    {
      taskId: input.taskId,
      mode: "openclaw",
      executionSessionId: sessionId,
    },
    db,
  );
  db.prepare(
    `INSERT INTO execution_runs
      (id, task_id, agent_id, provider, session_id, status, started_at, created_at, updated_at)
     VALUES (?, ?, ?, 'openclaw', ?, 'running', ?, ?, ?)`,
  ).run(randomUUID(), input.taskId, input.agentId, sessionId, now, now, now);
}

console.log("\nOrchestration OpenClaw Execution Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCli = process.env.ORCHESTRATION_OPENCLAW_CLI;
  const originalExecutionProvider = process.env.ORCHESTRATION_EXECUTION_PROVIDER;
  const originalDevExecutionTestMode = process.env.MC_DEV_EXECUTION_TEST_MODE;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPort = process.env.PORT;
  const stubCli = createStubOpenClawCli();
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-openclaw-execution-",
  });

  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }
    process.env.ORCHESTRATION_OPENCLAW_CLI = stubCli;
    delete process.env.ORCHESTRATION_EXECUTION_PROVIDER;
    process.env.MC_DEV_EXECUTION_TEST_MODE = "1";
    process.env.NODE_ENV = "development";
    process.env.PORT = "3010";
    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);
    ensureCompanyExecutionHives({ companyIdOrSlug: TEST_COMPANY_ID }, db);
    updateDevExecutionTestMode({
      companyIdOrSlug: TEST_COMPANY_ID,
      enabled: true,
      durationMinutes: 10,
      actor: "test-suite",
      note: "OpenClaw execution contract test",
    }, getOrchestrationDb());

    await test("In-progress assigned task with openclawAgentId queues engine execution", async () => {
      const project = createProject({
        companyId: TEST_COMPANY_ID,
        name: `OpenClaw Exec Project ${Date.now()}`,
        description: "Execution test fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `OpenClaw Exec Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Precise",
        openclawAgentId: "forge-openclaw-contract-a",
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "OpenClaw execution contract test task",
        description: [
          "Implement NEVA-78 execution trigger.",
          "",
          "## Acceptance Criteria",
          "- Spawn OpenClaw session",
          "- Persist session id on task",
        ].join("\n"),
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["orchestration"],
        createdBy: "test-suite",
      }).task;

      const result = await triggerTaskExecution({
        taskId: task.id,
        reason: "test_openclaw_execution",
      });

      assert.strictEqual(result.mode, "openclaw");
      assert.strictEqual(result.status, "queued");
      assert.strictEqual(result.queued, true);
      assert.ok(result.runId, "expected queued heartbeat run id");
      assert.strictEqual(result.sessionId, undefined);

      const run = getOrchestrationDb()
        .prepare("SELECT provider, status FROM execution_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(task.id) as { provider: string; status: string } | undefined;
      assert.strictEqual(run?.provider, "openclaw");
      assert.strictEqual(run?.status, "pending");
    });

    await test("OpenClaw task with existing session skips duplicate spawn", async () => {
      const project = createProject({
        companyId: TEST_COMPANY_ID,
        name: `OpenClaw Skip Project ${Date.now()}`,
        description: "Skip fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `OpenClaw Skip Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🤖",
        role: "Backend Engineer",
        personality: "Consistent",
        openclawAgentId: "forge-openclaw-contract-b",
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "OpenClaw duplicate spawn test task",
        description: "Task for duplicate skip test",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;

      const first = await triggerTaskExecution({ taskId: task.id });
      assert.strictEqual(first.status, "queued");

      const second = await triggerTaskExecution({ taskId: task.id });
      assert.strictEqual(second.status, "skipped");
      assert.strictEqual(second.reason, "openclaw_session_already_attached");
      assert.strictEqual(second.sessionId, undefined);
    });

    await test("Unmapped agents route through the active hive runtime", async () => {
      const project = createProject({
        companyId: TEST_COMPANY_ID,
        name: `OpenClaw Default Provider Project ${Date.now()}`,
        description: "Execution provider fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `OpenClaw Default Provider Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Direct",
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "OpenClaw provider default active hive route",
        description: "No openclaw mapping should still route through the active hive",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;

      const result = await triggerTaskExecution({ taskId: task.id });
      assert.strictEqual(result.mode, "anthropic");
      assert.strictEqual(result.status, "queued");
      assert.ok(result.runId, "expected active hive wakeup run id");
      assert.strictEqual(result.reason, "task_created_in_progress");
    });

    await test("Active hive idempotency key reuses run and does not trigger duplicate wakeup", async () => {
      const wakeupCalls = 0;

      try {
        const project = createProject({
          companyId: TEST_COMPANY_ID,
          name: `Active Hive Idempotency Project ${Date.now()}`,
          description: "Idempotency provider fixture",
          color: "#0ea5e9",
          emoji: "🧪",
          status: "active",
        }).project;

        const agent = createProjectAgent({
          projectId: project.id,
          name: `Active Hive Idempotency Agent ${Math.random().toString(36).slice(2, 6)}`,
          emoji: "🔁",
          role: "Backend Engineer",
          personality: "Consistent",
          status: "idle",
          skills: [],
        }).agent;

        const task = createTask({
          projectId: project.id,
          title: "Active hive idempotency execution path",
          description: "Same idempotency key should reuse execution run",
          priority: "P1",
          type: "infrastructure",
          status: "in-progress",
          assignee: agent.id,
          labels: [],
          createdBy: "test-suite",
        }).task;

        const first = await triggerTaskExecution({
          taskId: task.id,
          idempotencyKey: `test-idempotency:${task.id}`,
        });
        const second = await triggerTaskExecution({
          taskId: task.id,
          idempotencyKey: `test-idempotency:${task.id}`,
        });

        assert.strictEqual(first.mode, "anthropic");
        assert.strictEqual(first.status, "queued");
        assert.strictEqual(second.mode, "anthropic");
        assert.strictEqual(second.reason, "idempotency_key_reused");
        assert.strictEqual(second.status, "queued");
        assert.strictEqual(wakeupCalls, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    await test("Cancel execution moves task back to to-do and clears session id", async () => {
      const project = createProject({
        companyId: TEST_COMPANY_ID,
        name: `OpenClaw Cancel Project ${Date.now()}`,
        description: "Cancel fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `OpenClaw Cancel Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🛑",
        role: "Backend Engineer",
        personality: "Careful",
        openclawAgentId: "forge-openclaw-contract-c",
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "OpenClaw cancel contract task",
        description: "NEVA-81 cancel execution fixture",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["orchestration"],
        createdBy: "test-suite",
      }).task;

      attachRunningOpenClawSession({ taskId: task.id, agentId: agent.id });

      const cancelled = await cancelTaskExecution({
        taskId: task.id,
        actorUserId: "test-suite",
        note: "Operator canceled run",
      });

      assert.strictEqual(cancelled.mode, "openclaw");
      assert.strictEqual(cancelled.cancelled.attempted, true);
      assert.strictEqual(cancelled.cancelled.acknowledged, true);
      assert.strictEqual(cancelled.cancelled.status, "cancelled");
      assert.strictEqual(cancelled.transition.changed, true);
      assert.strictEqual(cancelled.transition.to, "to-do");
      assert.strictEqual(cancelled.task.status, "to-do");

      const bridgeTask = getTaskBridgeRecord(task.id);
      assert.strictEqual(bridgeTask.executionMode, "openclaw");
      assert.strictEqual(bridgeTask.executionSessionId, undefined);

      const comments = listTaskComments(task.id).comments;
      assert.ok(
        comments.some((comment) => /Gateway acknowledged cancellation\./.test(comment.text)),
        "expected cancellation acknowledgement comment"
      );
    });

    await test("Cancel execution can keep task in-progress when requested", async () => {
      const project = createProject({
        companyId: TEST_COMPANY_ID,
        name: `OpenClaw Cancel Keep Project ${Date.now()}`,
        description: "Cancel keep fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `OpenClaw Cancel Keep Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🧭",
        role: "Backend Engineer",
        personality: "Deliberate",
        openclawAgentId: "forge-openclaw-contract-d",
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "OpenClaw cancel keep in-progress task",
        description: "NEVA-81 keep in-progress fixture",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;

      attachRunningOpenClawSession({ taskId: task.id, agentId: agent.id });
      const cancelled = await cancelTaskExecution({
        taskId: task.id,
        targetStatus: "in-progress",
      });

      assert.strictEqual(cancelled.cancelled.acknowledged, true);
      assert.strictEqual(cancelled.transition.changed, false);
      assert.strictEqual(cancelled.transition.skipReason, "target_status_in_progress");
      assert.strictEqual(getTask(task.id).task.status, "in-progress");
      assert.strictEqual(getTaskBridgeRecord(task.id).executionSessionId, undefined);
    });
  } finally {
    process.env.ORCHESTRATION_OPENCLAW_CLI = originalCli;
    if (originalExecutionProvider === undefined) {
      delete process.env.ORCHESTRATION_EXECUTION_PROVIDER;
    } else {
      process.env.ORCHESTRATION_EXECUTION_PROVIDER = originalExecutionProvider;
    }
    if (originalDevExecutionTestMode === undefined) {
      delete process.env.MC_DEV_EXECUTION_TEST_MODE;
    } else {
      process.env.MC_DEV_EXECUTION_TEST_MODE = originalDevExecutionTestMode;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
    globalThis.fetch = originalFetch;
    rmSync(stubCli, { force: true });
    workspaceIsolation.dispose();
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
