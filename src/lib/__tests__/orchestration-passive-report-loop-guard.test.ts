/**
 * Contract test for passive-report loop prevention.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-passive-report-loop-guard.db
 * npx tsx src/lib/__tests__/orchestration-passive-report-loop-guard.test.ts
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
    `mc-openclaw-passive-report-loop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
  );
  const statePath = path.join(
    os.tmpdir(),
    `mc-openclaw-passive-report-loop-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
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
  if [ -n "$KEY" ]; then
    printf '%s' "$KEY" > "$STATE_FILE"
  fi
  printf '{"ok":true,"key":"%s","sessionId":"session-passive-report-loop-123"}\n' "$KEY"
  exit 0
fi
if [ "$METHOD" = "sessions.send" ]; then
  echo '{"runId":"run-passive-report-loop-456","status":"started"}'
  exit 0
fi
if [ "$METHOD" = "sessions.list" ] || [ "$METHOD" = "sessions_list" ]; then
  KEY="$(cat "$STATE_FILE" 2>/dev/null)"
  if [ -z "$KEY" ]; then
    KEY="agent:passive-report-loop:heartbeat:stub"
  fi
  printf '{"sessions":[{"key":"%s","sessionId":"session-passive-report-loop-123","status":"done","startedAt":1775790000000,"endedAt":1775790005000}]}' "$KEY"
  exit 0
fi
if [ "$METHOD" = "sessions.get" ] || [ "$METHOD" = "sessions_get" ]; then
  echo '{"messages":[{"role":"assistant","content":"NO_REPLY"}]}'
  exit 0
fi

echo "unsupported method: $METHOD" >&2
exit 1
`;

  writeFileSync(filePath, script, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

console.log("\nOrchestration Passive Report Loop Guard Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCli = process.env.ORCHESTRATION_OPENCLAW_CLI;
  const stubCli = createStubOpenClawCli();

  try {
    if (dbPath) rmSync(dbPath, { force: true });
    process.env.ORCHESTRATION_OPENCLAW_CLI = stubCli;

    await test("Passive NO_REPLY output fails once, leaves no comment, and queues no continuation", async () => {
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
        name: `Passive Report Loop ${Date.now()}`,
        description: "Passive report loop prevention fixture",
        color: "#dc2626",
        emoji: "🛑",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Passive Guard ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🧪",
        role: "Runtime Engineer",
        personality: "Deterministic",
        openclawAgentId: `passive-guard-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "[E2E] Passive NO_REPLY should not loop",
        description: "Disposable proof task for passive report loop prevention.",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["e2e", "passive-report", "no-reply"],
        createdBy: "test-suite",
      }).task;

      const beforeComments = listTaskComments(task.id).comments;
      assert.strictEqual(beforeComments.length, 0);

      const db = getOrchestrationDb();
      const wake = enqueueWakeup(
        {
          agentId: agent.id,
          companyId: project.companyId,
          source: "issue_assigned",
          reason: "test_passive_report_loop_guard",
          payload: {
            taskId: task.id,
            taskStatus: "in_progress",
            projectId: project.id,
          },
          idempotencyKey: `hb-passive-loop-${task.id}`,
        },
        db,
      );

      assert.ok(wake.heartbeatRunId, "expected heartbeatRunId from enqueueWakeup");

      const result = await executeHeartbeatRun(wake.heartbeatRunId!, db);
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.error, "insufficient_progress_passive_report_only");

      const afterComments = listTaskComments(task.id).comments;
      assert.strictEqual(afterComments.length, 0, "NO_REPLY should not be imported as a task comment");

      const continuationWake = db.prepare(
        `SELECT COUNT(*) as count
         FROM agent_wakeup_requests
         WHERE agent_id = ?
           AND reason LIKE 'continuation%'
           AND json_extract(payload_json, '$.continuedFromRunId') = ?`
      ).get(agent.id, wake.heartbeatRunId) as { count: number };
      assert.strictEqual(continuationWake.count, 0, "failed passive-report-only runs must not queue continuation wakeups");
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
