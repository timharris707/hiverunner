/**
 * Contract test for OpenClaw running-session import behavior.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-openclaw-running-output-wait.db
 * npx tsx src/lib/__tests__/orchestration-openclaw-running-output-wait.test.ts
 */

import assert from "node:assert";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

function createRunningOutputOpenClawCli(): string {
  const filePath = path.join(
    os.tmpdir(),
    `mc-openclaw-running-output-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`,
  );
  const statePath = path.join(
    os.tmpdir(),
    `mc-openclaw-running-output-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );

  const script = `#!/bin/sh
METHOD="$3"
PARAMS="$6"
STATE_FILE="${statePath}"

extract_key() {
  printf '%s' "$PARAMS" | sed -n 's/.*"key":"\\([^"]*\\)".*/\\1/p'
}

if [ "$METHOD" = "sessions.create" ]; then
  KEY="$(extract_key)"
  printf '%s' "$KEY" > "$STATE_FILE"
  printf '{"ok":true,"key":"%s","sessionId":"session-running-output-123"}\n' "$KEY"
  exit 0
fi
if [ "$METHOD" = "sessions.send" ]; then
  echo '{"runId":"run-running-output-456","status":"started"}'
  exit 0
fi
if [ "$METHOD" = "sessions.list" ] || [ "$METHOD" = "sessions_list" ]; then
  KEY="$(cat "$STATE_FILE" 2>/dev/null)"
  printf '{"sessions":[{"key":"%s","sessionId":"session-running-output-123","status":"running","startedAt":1775790000000}]}' "$KEY"
  exit 0
fi
if [ "$METHOD" = "sessions.get" ] || [ "$METHOD" = "sessions_get" ]; then
  echo '{"sessionId":"session-running-output-123","status":"running","messages":[{"role":"assistant","content":"I am locating the workspace before writing the artifact."}]}'
  exit 0
fi

echo "unsupported method: $METHOD" >&2
exit 1
`;

  writeFileSync(filePath, script, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

console.log("\nOpenClaw Running Output Wait Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCli = process.env.ORCHESTRATION_OPENCLAW_CLI;
  const originalPollMs = process.env.ORCHESTRATION_OPENCLAW_SESSION_POLL_INTERVAL_MS;
  const originalTimeoutMs = process.env.ORCHESTRATION_OPENCLAW_SESSION_COMPLETION_TIMEOUT_MS;
  const stubCli = createRunningOutputOpenClawCli();

  try {
    if (dbPath) rmSync(dbPath, { force: true });
    process.env.ORCHESTRATION_OPENCLAW_CLI = stubCli;
    process.env.ORCHESTRATION_OPENCLAW_SESSION_POLL_INTERVAL_MS = "10";
    process.env.ORCHESTRATION_OPENCLAW_SESSION_COMPLETION_TIMEOUT_MS = "80";

    await test("running assistant progress is not imported as a terminal passive report", async () => {
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");
      const {
        createProject,
        createProjectAgent,
        createTask,
        listTaskComments,
      } = await import("@/lib/orchestration/service");
      const { enqueueWakeup, executeHeartbeatRun } = await import("@/lib/orchestration/engine/engine");

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Running Output Wait ${Date.now()}`,
        description: "Running output wait fixture",
        color: "#2563eb",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Running Wait ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🧪",
        role: "Research Agent",
        personality: "Reports progress first, then writes artifacts.",
        openclawAgentId: `running-wait-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["research"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "[E2E] Running progress should wait for terminal session",
        description: "Disposable proof task for running output handling.",
        priority: "P1",
        type: "research",
        status: "in-progress",
        assignee: agent.id,
        labels: ["e2e", "openclaw", "running-output"],
        createdBy: "test-suite",
      }).task;

      const db = getOrchestrationDb();
      const wake = enqueueWakeup(
        {
          agentId: agent.id,
          companyId: project.companyId,
          source: "issue_assigned",
          reason: "test_running_output_wait",
          payload: {
            taskId: task.id,
            taskStatus: "in_progress",
            projectId: project.id,
          },
          idempotencyKey: `hb-running-output-${task.id}`,
        },
        db,
      );

      const result = await executeHeartbeatRun(wake.heartbeatRunId!, db);
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(
        result.error,
        "openclaw_session_timeout: session did not complete before import deadline",
      );

      const comments = listTaskComments(task.id).comments;
      assert.strictEqual(comments.length, 0, "interim progress must not be imported as final task output");

      const row = db
        .prepare(`SELECT result_json, usage_json FROM heartbeat_runs WHERE id = ?`)
        .get(wake.heartbeatRunId) as { result_json: string; usage_json: string };
      const resultJson = JSON.parse(row.result_json) as { fatalError?: string; errors?: string[] };
      const usageJson = JSON.parse(row.usage_json) as { sessionCompletionTimedOut?: boolean; sessionOutputStatus?: string };
      assert.strictEqual(resultJson.fatalError, result.error);
      assert.deepStrictEqual(resultJson.errors, [result.error]);
      assert.strictEqual(usageJson.sessionCompletionTimedOut, true);
      assert.strictEqual(usageJson.sessionOutputStatus, "running");
    });
  } finally {
    if (originalCli === undefined) delete process.env.ORCHESTRATION_OPENCLAW_CLI;
    else process.env.ORCHESTRATION_OPENCLAW_CLI = originalCli;
    if (originalPollMs === undefined) delete process.env.ORCHESTRATION_OPENCLAW_SESSION_POLL_INTERVAL_MS;
    else process.env.ORCHESTRATION_OPENCLAW_SESSION_POLL_INTERVAL_MS = originalPollMs;
    if (originalTimeoutMs === undefined) delete process.env.ORCHESTRATION_OPENCLAW_SESSION_COMPLETION_TIMEOUT_MS;
    else process.env.ORCHESTRATION_OPENCLAW_SESSION_COMPLETION_TIMEOUT_MS = originalTimeoutMs;
    rmSync(stubCli, { force: true });
    if (dbPath) rmSync(dbPath, { force: true });
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
