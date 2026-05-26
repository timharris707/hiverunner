/**
 * Contract test for the heartbeat -> execution_run completion bridge.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-execution-heartbeat-bridge.db
 * npx tsx src/lib/__tests__/orchestration-execution-heartbeat-bridge.test.ts
 */

import assert from "node:assert";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";


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

function createStubOpenClawCli(): { filePath: string; statePath: string; taskKeyPath: string } {
  const filePath = path.join(
    os.tmpdir(),
    `mc-openclaw-heartbeat-bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
  );
  const statePath = path.join(
    os.tmpdir(),
    `mc-openclaw-heartbeat-bridge-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
  );
  const taskKeyPath = path.join(
    os.tmpdir(),
    `mc-openclaw-heartbeat-bridge-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
  );

  const script = `#!/bin/sh
METHOD="$3"
PARAMS="$6"
STATE_FILE="${statePath}"
TASK_KEY_FILE="${taskKeyPath}"

extract_key() {
  printf '%s' "$PARAMS" | sed -n 's/.*"key":"\\([^"]*\\)".*/\\1/p'
}

extract_task_key() {
  printf '%s' "$PARAMS" | grep -o '\\[[A-Z][A-Z0-9]*-[0-9][0-9]*\\]' | head -n 1 | tr -d '[]'
}

if [ "$METHOD" = "sessions.create" ]; then
  KEY="$(extract_key)"
  if [ -n "$KEY" ]; then
    printf '%s' "$KEY" > "$STATE_FILE"
  fi
  printf '{"ok":true,"key":"%s","sessionId":"session-heartbeat-bridge-123"}\n' "$KEY"
  exit 0
fi
if [ "$METHOD" = "sessions.send" ]; then
  TASK_KEY="$(extract_task_key)"
  if [ -n "$TASK_KEY" ]; then
    printf '%s' "$TASK_KEY" > "$TASK_KEY_FILE"
  fi
  echo '{"runId":"run-heartbeat-bridge-456","status":"started"}'
  exit 0
fi
if [ "$METHOD" = "sessions.list" ] || [ "$METHOD" = "sessions_list" ]; then
  KEY="$(cat "$STATE_FILE" 2>/dev/null)"
  if [ -z "$KEY" ]; then
    KEY="agent:forge-heartbeat:heartbeat:stub"
  fi
  printf '{"sessions":[{"key":"%s","sessionId":"session-heartbeat-bridge-123","status":"done","startedAt":1775790000000,"endedAt":1775790005000}]}\n' "$KEY"
  exit 0
fi
if [ "$METHOD" = "sessions.get" ] || [ "$METHOD" = "sessions_get" ]; then
  TASK_KEY="$(cat "$TASK_KEY_FILE" 2>/dev/null)"
  if [ -z "$TASK_KEY" ]; then
    TASK_KEY="NEV-1"
  fi
  TASK_KEY="$TASK_KEY" python3 -c 'import json, os; task_key = os.environ.get("TASK_KEY", "NEV-1"); fence = chr(96) * 3; content = f"{fence}mc-action\\n" + json.dumps({"action": "add_comment", "taskKey": task_key, "body": "Execution bridge proof complete. Imported through heartbeat run."}) + f"\\n{fence}\\n\\nExecution bridge proof complete. Imported through heartbeat run."; print(json.dumps({"messages": [{"role": "assistant", "content": content}]}))'
  exit 0
fi

echo "unsupported method: $METHOD" >&2
exit 1
`;

  writeFileSync(filePath, script, "utf8");
  chmodSync(filePath, 0o755);
  return { filePath, statePath, taskKeyPath };
}

console.log("\nOrchestration Execution Heartbeat Bridge Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCli = process.env.ORCHESTRATION_OPENCLAW_CLI;
  const originalOpenClawDir = process.env.OPENCLAW_DIR;
  const stub = createStubOpenClawCli();
  const stubCli = stub.filePath;
  const tempOpenClawDir = mkdtempSync(path.join(os.tmpdir(), "mc-openclaw-heartbeat-bridge-openclaw-"));

  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }

    process.env.ORCHESTRATION_OPENCLAW_CLI = stubCli;
    process.env.OPENCLAW_DIR = tempOpenClawDir;

    await test("Heartbeat execution finalizes execution_run and leaves definitive proof on task", async () => {
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");
      const {
        createProject,
        createProjectAgent,
        createTask,
        getTask,
        listCompanyAgents,
        listTaskComments,
      } = await import("@/lib/orchestration/service");
      const { getTaskBridgeRecord } = await import("@/lib/orchestration/bridge/store");
      const { configureCompanyExecutionHive, ensureCompanyExecutionHives } = await import("@/lib/orchestration/service/execution-hives");

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Execution Bridge Project ${Date.now()}`,
        description: "Heartbeat bridge fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Execution Bridge Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Definitive",
        openclawAgentId: `forge-heartbeat-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "[E2E] Definitive execution proof — safe to delete",
        description: "Disposable proof task for execution bridge completion.",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["e2e", "execution-bridge"],
        createdBy: "test-suite",
      }).task;

      const { enqueueWakeup, executeHeartbeatRun } = await import(
        "@/lib/orchestration/engine/engine"
      );

      const db = getOrchestrationDb();
      ensureCompanyExecutionHives({ companyIdOrSlug: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f" }, db);
      configureCompanyExecutionHive({
        companyIdOrSlug: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "openclaw",
        runtimeLabel: "OpenClaw",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }, db);

      const wake = enqueueWakeup(
        {
          agentId: agent.id,
          companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
          source: "issue_assigned",
          reason: "test_execution_bridge_proof",
          payload: {
            taskId: task.id,
            taskStatus: "in_progress",
            projectId: project.id,
            projectName: project.name,
            executionMode: "openclaw",
          },
          idempotencyKey: `hb-bridge-${task.id}`,
        },
        db
      );

      assert.ok(wake.heartbeatRunId, "expected heartbeatRunId from enqueueWakeup");

      const result = await executeHeartbeatRun(wake.heartbeatRunId!, db);
      assert.strictEqual(result.status, "succeeded");

      const executionRun = db
        .prepare(
          `SELECT provider, status, session_id, completed_at, error_message
           FROM execution_runs
           WHERE task_id = ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(task.id) as
        | {
            provider: string;
            status: string;
            session_id: string | null;
            completed_at: string | null;
            error_message: string | null;
          }
        | undefined;

      assert.ok(executionRun, "expected execution_run to be created");
      assert.strictEqual(executionRun?.provider, "openclaw");
      assert.strictEqual(executionRun?.status, "completed");
      assert.ok(executionRun?.completed_at, "expected execution_run completion timestamp");
      assert.strictEqual(executionRun?.error_message, null);

      const updatedTask = getTask(task.id).task;
      assert.strictEqual(updatedTask.executionMode, "openclaw");
      assert.strictEqual(updatedTask.status, "review");

      const bridgeTask = getTaskBridgeRecord(task.id);
      assert.strictEqual(bridgeTask.executionSessionId, undefined);

      const companyAgents = listCompanyAgents("6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f", {
        includeNonProduction: true,
      }).agents;
      const updatedAgent = companyAgents.find((candidate) => candidate.id === agent.id);
      assert.ok(updatedAgent, "expected company agent after reconciliation");
      assert.strictEqual(updatedAgent?.status, "idle");
      assert.strictEqual(updatedAgent?.currentTask, undefined);

      const comments = listTaskComments(task.id).comments;
      assert.ok(
        comments.some((comment) => /Execution bridge proof complete/.test(comment.text)),
        "expected imported assistant proof comment on task"
      );
    });
  } finally {
    process.env.ORCHESTRATION_OPENCLAW_CLI = originalCli;
    if (originalOpenClawDir === undefined) {
      delete process.env.OPENCLAW_DIR;
    } else {
      process.env.OPENCLAW_DIR = originalOpenClawDir;
    }
    rmSync(stubCli, { force: true });
    rmSync(stub.statePath, { force: true });
    rmSync(stub.taskKeyPath, { force: true });
    rmSync(tempOpenClawDir, { recursive: true, force: true });
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
