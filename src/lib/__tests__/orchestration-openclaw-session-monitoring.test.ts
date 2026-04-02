/**
 * Contract tests for OpenClaw session monitoring behavior.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-openclaw-session-monitoring.db
 * npx tsx src/lib/__tests__/orchestration-openclaw-session-monitoring.test.ts
 */

import assert from "node:assert";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listTaskComments,
} from "@/lib/orchestration/service";
import { pollTaskExecutionStatus, triggerTaskExecution } from "@/lib/orchestration/execution";

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

function createStubOpenClawCli(): string {
  const filePath = path.join(
    os.tmpdir(),
    `mc-openclaw-monitor-stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
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
if [ "$METHOD" = "sessions.history" ] || [ "$METHOD" = "sessions_history" ]; then
  if [ "$MC_STUB_HISTORY_STATE" = "completed" ]; then
    echo '{"sessionId":"session-oc-123","status":"completed","history":[{"id":"evt-1","createdAt":"2026-04-01T13:00:00.000Z","role":"forge","text":"Implemented monitor endpoint."},{"id":"evt-2","createdAt":"2026-04-01T13:01:00.000Z","role":"forge","text":"Mapped output to task comments."}]}'
    exit 0
  fi
  echo '{"sessionId":"session-oc-123","status":"running","history":[{"id":"evt-1","createdAt":"2026-04-01T13:00:00.000Z","role":"forge","text":"Working on execution status sync."}]}'
  exit 0
fi

echo "unsupported method: $METHOD" >&2
exit 1
`;

  writeFileSync(filePath, script, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

function createFixture() {
  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `OpenClaw Monitor Project ${Date.now()}`,
    description: "Monitor fixture",
    color: "#0ea5e9",
    emoji: "🧪",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `OpenClaw Monitor Agent ${Math.random().toString(36).slice(2, 6)}`,
    emoji: "🔧",
    role: "Backend Engineer",
    personality: "Precise",
    openclawAgentId: `forge-openclaw-monitor-${Math.random().toString(36).slice(2, 8)}`,
    status: "idle",
    skills: [],
  }).agent;

  const task = createTask({
    projectId: project.id,
    title: "Monitor OpenClaw session history",
    description: "NEVA-79 fixture task",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    labels: ["orchestration"],
    createdBy: "test-suite",
  }).task;

  return { task };
}

console.log("\nOrchestration OpenClaw Session Monitoring Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCli = process.env.ORCHESTRATION_OPENCLAW_CLI;
  const originalState = process.env.MC_STUB_HISTORY_STATE;
  const stubCli = createStubOpenClawCli();

  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }

    process.env.ORCHESTRATION_OPENCLAW_CLI = stubCli;

    await test("Terminal session imports comments and auto-moves task to review", async () => {
      const fixture = createFixture();
      await triggerTaskExecution({ taskId: fixture.task.id, reason: "test_monitoring_terminal" });

      process.env.MC_STUB_HISTORY_STATE = "completed";
      const result = await pollTaskExecutionStatus(fixture.task.id);

      assert.strictEqual(result.mode, "openclaw");
      assert.strictEqual(result.status.terminal, true);
      assert.strictEqual(result.status.state, "completed");
      assert.strictEqual(result.comments.imported, 2);
      assert.strictEqual(result.transition.changed, true);
      assert.strictEqual(result.transition.from, "in-progress");
      assert.strictEqual(result.transition.to, "review");

      const task = getTask(fixture.task.id).task;
      assert.strictEqual(task.status, "review");

      const comments = listTaskComments(fixture.task.id).comments;
      assert.ok(
        comments.some((comment) => /OpenClaw .* update:/.test(comment.text)),
        "expected OpenClaw imported comments"
      );
      assert.ok(
        comments.some((comment) => /Task auto-moved to Review\./.test(comment.text)),
        "expected completion transition comment"
      );
    });

    await test("Repeated poll skips duplicate OpenClaw comment imports", async () => {
      const fixture = createFixture();
      await triggerTaskExecution({ taskId: fixture.task.id, reason: "test_monitoring_dedupe" });

      process.env.MC_STUB_HISTORY_STATE = "running";
      const first = await pollTaskExecutionStatus(fixture.task.id);
      assert.strictEqual(first.comments.imported, 1);
      assert.strictEqual(first.status.terminal, false);

      const second = await pollTaskExecutionStatus(fixture.task.id);
      assert.strictEqual(second.comments.imported, 0);
      assert.strictEqual(second.comments.skippedDuplicates, 1);
      assert.strictEqual(second.transition.changed, false);

      const comments = listTaskComments(fixture.task.id).comments;
      const imported = comments.filter((comment) => /OpenClaw .* update:/.test(comment.text));
      assert.strictEqual(imported.length, 1);
      assert.strictEqual(getTask(fixture.task.id).task.status, "in-progress");
    });
  } finally {
    process.env.ORCHESTRATION_OPENCLAW_CLI = originalCli;
    process.env.MC_STUB_HISTORY_STATE = originalState;
    rmSync(stubCli, { force: true });
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
