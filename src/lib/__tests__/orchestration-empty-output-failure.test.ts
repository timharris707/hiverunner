/**
 * Contract test for empty assistant output handling.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-empty-output-failure.db
 * npx tsx src/lib/__tests__/orchestration-empty-output-failure.test.ts
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

function createStubOpenClawCli(): string {
  const filePath = path.join(
    os.tmpdir(),
    `mc-openclaw-empty-output-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
  );

  const script = `#!/bin/sh
METHOD="$3"
PARAMS="$6"
STATE_FILE="${path.join(os.tmpdir(), `mc-openclaw-empty-output-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)}"

extract_key() {
  printf '%s' "$PARAMS" | sed -n 's/.*"key":"\\([^"]*\\)".*/\\1/p'
}

if [ "$METHOD" = "sessions.create" ]; then
  KEY="$(extract_key)"
  if [ -n "$KEY" ]; then
    printf '%s' "$KEY" > "$STATE_FILE"
  fi
  printf '{"ok":true,"key":"%s","sessionId":"session-empty-output-123"}\n' "$KEY"
  exit 0
fi
if [ "$METHOD" = "sessions.send" ]; then
  echo '{"runId":"run-empty-output-456","status":"started"}'
  exit 0
fi
if [ "$METHOD" = "sessions.list" ] || [ "$METHOD" = "sessions_list" ]; then
  KEY="$(cat "$STATE_FILE" 2>/dev/null)"
  if [ -z "$KEY" ]; then
    KEY="agent:empty-output:heartbeat:stub"
  fi
  printf '{"sessions":[{"key":"%s","sessionId":"session-empty-output-123","status":"done","startedAt":1775790000000,"endedAt":1775790005000}]}' "$KEY"
  exit 0
fi
if [ "$METHOD" = "sessions.get" ] || [ "$METHOD" = "sessions_get" ]; then
  echo '{"messages":[{"role":"tool","content":"silent tool trace"}]}'
  exit 0
fi

echo "unsupported method: $METHOD" >&2
exit 1
`;

  writeFileSync(filePath, script, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

console.log("\nOrchestration Empty Output Failure Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCli = process.env.ORCHESTRATION_OPENCLAW_CLI;
  const stubCli = createStubOpenClawCli();

  try {
    if (dbPath) rmSync(dbPath, { force: true });
    process.env.ORCHESTRATION_OPENCLAW_CLI = stubCli;

    await test("Empty assistant output fails the run and does not queue continuation", async () => {
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");
      const {
        createProject,
        createProjectAgent,
        createTask,
      } = await import("@/lib/orchestration/service");
      const { enqueueWakeup, executeHeartbeatRun } = await import("@/lib/orchestration/engine/engine");

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Empty Output Project ${Date.now()}`,
        description: "Empty output fixture",
        color: "#ef4444",
        emoji: "🚨",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Empty Output Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🤖",
        role: "Runtime Engineer",
        personality: "Deterministic",
        openclawAgentId: `empty-output-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "[E2E] Empty output should hard fail",
        description: "Disposable proof task for empty output handling.",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["e2e", "empty-output"],
        createdBy: "test-suite",
      }).task;

      const db = getOrchestrationDb();
      const wake = enqueueWakeup(
        {
          agentId: agent.id,
          companyId: project.companyId,
          source: "issue_assigned",
          reason: "test_empty_output_failure",
          payload: {
            taskId: task.id,
            taskStatus: "in_progress",
            projectId: project.id,
          },
          idempotencyKey: `hb-empty-output-${task.id}`,
        },
        db,
      );

      assert.ok(wake.heartbeatRunId, "expected heartbeatRunId from enqueueWakeup");

      const result = await executeHeartbeatRun(wake.heartbeatRunId!, db);
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.error, "empty_assistant_output: session completed without any assistant text output");

      const heartbeatRun = db.prepare(
        `SELECT status, error, result_json
         FROM heartbeat_runs
         WHERE id = ? LIMIT 1`
      ).get(wake.heartbeatRunId) as { status: string; error: string | null; result_json: string } | undefined;
      assert.ok(heartbeatRun, "expected heartbeat run row");
      assert.strictEqual(heartbeatRun?.status, "failed");
      assert.strictEqual(heartbeatRun?.error, "empty_assistant_output: session completed without any assistant text output");

      const parsedResult = JSON.parse(heartbeatRun!.result_json) as { fatalError?: string; errors?: string[] };
      assert.strictEqual(parsedResult.fatalError, "empty_assistant_output: session completed without any assistant text output");
      assert.ok(parsedResult.errors?.includes("empty_assistant_output: session completed without any assistant text output"));

      const executionRun = db.prepare(
        `SELECT status, error_message
         FROM execution_runs
         WHERE task_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      ).get(task.id) as { status: string; error_message: string | null } | undefined;
      assert.ok(executionRun, "expected execution run row");
      assert.strictEqual(executionRun?.status, "failed");
      assert.strictEqual(executionRun?.error_message, "empty_assistant_output: session completed without any assistant text output");

      const continuationWake = db.prepare(
        `SELECT COUNT(*) as count
         FROM agent_wakeup_requests
         WHERE agent_id = ?
           AND reason LIKE 'continuation%'
           AND json_extract(payload_json, '$.continuedFromRunId') = ?`
      ).get(agent.id, wake.heartbeatRunId) as { count: number };
      assert.strictEqual(continuationWake.count, 0);

      const errorEvents = db.prepare(
        `SELECT detail
         FROM heartbeat_run_events
         WHERE run_id = ? AND event_type = 'error'
         ORDER BY created_at ASC`
      ).all(wake.heartbeatRunId) as Array<{ detail: string }>;
      assert.ok(
        errorEvents.some((event) => event.detail.includes("FATAL: Session completed with no assistant text output")),
        "expected fatal operator-visible error event"
      );
    });
  } finally {
    process.env.ORCHESTRATION_OPENCLAW_CLI = originalCli;
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
