/**
 * Contract test for mc-action extraction from OpenClaw session history.
 *
 * Regression: 2026-04-18T21:07Z on WEA-211. The UI-triggered poll path
 * (`pollTaskExecutionStatus`, fired every 3s by the task detail page) was
 * importing assistant events verbatim as `status_update` comments without
 * running their body through `parseActionsFromText`. Agents that delivered
 * work via this path (fenced ```mc-action blocks inside assistant text)
 * had their action JSON dropped on the floor — no tasks created, no
 * status flips, no subtasks.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-mc-action-extraction.db \
 *   npx tsx src/lib/__tests__/orchestration-openclaw-session-mc-action-extraction.test.ts
 */

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listTasks,
  listTaskComments,
} from "@/lib/orchestration/service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { pollTaskExecutionStatus } from "@/lib/orchestration/execution";

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
    `mc-openclaw-mcaction-stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
  );

  // The stub returns a single assistant event whose body mirrors the
  // WEA-211 shape: a human preamble plus 4 fenced mc-action blocks
  // (3 create_task with parent, 1 update_task).
  const script = `#!/bin/sh
METHOD="$3"
if [ "$METHOD" = "sessions.create" ]; then
  echo '{"ok":true,"key":"agent:forge:mc-action:task:stub","sessionId":"session-mcaction-1"}'
  exit 0
fi
if [ "$METHOD" = "sessions.send" ]; then
  echo '{"runId":"run-mcaction-1","status":"started"}'
  exit 0
fi
if [ "$METHOD" = "sessions.list" ]; then
  echo '{"sessions":[{"key":"agent:forge:mc-action:task:stub","sessionId":"session-mcaction-1","status":"completed","startedAt":1776931625000,"endedAt":1776931630000}]}'
  exit 0
fi
if [ "$METHOD" = "sessions.get" ]; then
  cat <<'JSON'
{
  "sessionId": "session-mcaction-1",
  "status": "completed",
  "messages": [
    {
      "id": "evt-mcaction-1",
      "createdAt": "2026-04-18T21:07:05.000Z",
      "role": "assistant",
      "text": "OpenClaw (assistant) update:\\n\\nBreaking down the request into three subtasks and flipping this task to in_progress.\\n\\n\\u0060\\u0060\\u0060mc-action\\n{\\"action\\": \\"create_task\\", \\"title\\": \\"Subtask A\\", \\"description\\": \\"First step\\", \\"assignee\\": \\"McActionWorker\\", \\"parent\\": \\"__TASK_KEY__\\"}\\n\\u0060\\u0060\\u0060\\n\\n\\u0060\\u0060\\u0060mc-action\\n{\\"action\\": \\"create_task\\", \\"title\\": \\"Subtask B\\", \\"description\\": \\"Second step\\", \\"assignee\\": \\"McActionWorker\\", \\"parent\\": \\"__TASK_KEY__\\"}\\n\\u0060\\u0060\\u0060\\n\\n\\u0060\\u0060\\u0060mc-action\\n{\\"action\\": \\"create_task\\", \\"title\\": \\"Subtask C\\", \\"description\\": \\"Third step\\", \\"assignee\\": \\"McActionWorker\\", \\"parent\\": \\"__TASK_KEY__\\"}\\n\\u0060\\u0060\\u0060\\n\\n\\u0060\\u0060\\u0060mc-action\\n{\\"action\\": \\"update_task\\", \\"taskKey\\": \\"__TASK_KEY__\\", \\"status\\": \\"in_progress\\", \\"comment\\": \\"Breaking this down into 3 subtasks.\\"}\\n\\u0060\\u0060\\u0060"
    }
  ]
}
JSON
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
    name: `MC Action Extraction Project ${Date.now()}`,
    description: "Fixture for mc-action extraction regression",
    color: "#f97316",
    emoji: "🧪",
    status: "active",
  }).project;

  // Use a stable agent name so the stub's create_task blocks can reference
  // it as `assignee` — matching the real WEA-211 pattern where subtasks had
  // explicit assignees. Without assignees, subtasks get status='backlog'
  // and reconcileTaskHierarchy rolls the parent to backlog too, which is
  // correct behavior but not what this regression test is pinning down.
  const agent = createProjectAgent({
    projectId: project.id,
    name: "McActionWorker",
    emoji: "🔧",
    role: "Backend Engineer",
    personality: "Precise",
    openclawAgentId: `forge-mcaction-${Math.random().toString(36).slice(2, 8)}`,
    status: "idle",
    skills: [],
  }).agent;

  const task = createTask({
    projectId: project.id,
    title: "Parent task needing subtask breakdown",
    description: "WEA-211 regression fixture",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    labels: ["orchestration"],
    createdBy: "test-suite",
  }).task;

  // Mirror production WEA-211 shape — the poll path short-circuits unless
  // execution_mode is 'openclaw'. Default on createTask is 'manual'; trigger
  // flow flips it during live execution, but the stub here doesn't, so we
  // set it directly to match the real scenario we're regression-testing.
  getOrchestrationDb()
    .prepare("UPDATE tasks SET execution_mode = 'openclaw' WHERE id = ?")
    .run(task.id);

  return { project, agent, task };
}

console.log("\nOrchestration OpenClaw mc-action Extraction Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCli = process.env.ORCHESTRATION_OPENCLAW_CLI;
  let stubCli: string | undefined;

  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }

    await test("Poll path extracts mc-action blocks, executes them, and does not store raw fences", async () => {
      const fixture = createFixture();

      // Replace the task_key placeholder in the stub with the actual task key
      // so mc-action blocks reference this test's task.
      const stubRaw = createStubOpenClawCli();
      stubCli = stubRaw;
      const fs = await import("node:fs");
      const taskKey = fixture.task.key ?? "";
      if (!taskKey) throw new Error("fixture task.key unexpectedly missing");
      const script = fs.readFileSync(stubRaw, "utf8").replaceAll("__TASK_KEY__", taskKey);
      fs.writeFileSync(stubRaw, script, "utf8");

      process.env.ORCHESTRATION_OPENCLAW_CLI = stubRaw;

      // triggerTaskExecution only enqueues a wake (session_id set later by
      // engine tick, which we don't drive in unit tests). Short-circuit that
      // by seeding the execution_run directly with the stub's session_id —
      // mirrors production state AFTER the engine tick has run and is about
      // to be polled from the UI.
      const db = getOrchestrationDb();
      const execRunId = randomUUID();
      db.prepare(
        `INSERT INTO execution_runs
          (id, task_id, agent_id, provider, status, session_id, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'openclaw', 'running', 'session-mcaction-1', ?, ?, ?)`,
      ).run(
        execRunId,
        fixture.task.id,
        fixture.agent.id,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      );

      const result = await pollTaskExecutionStatus(fixture.task.id);

      // 1. Actions were found and executed.
      assert.strictEqual(result.actions.found, 4, "expected 4 mc-action blocks parsed");
      assert.strictEqual(
        result.actions.executed,
        4,
        `expected all 4 actions executed, got ${result.actions.executed} (errors: ${result.actions.errors.join("; ")})`
      );
      assert.strictEqual(result.actions.tasksCreated.length, 3, "expected 3 subtasks created");

      // 2. The assistant's raw text (with mc-action fences) is NOT stored
      //    as a comment on the parent task.
      const comments = listTaskComments(fixture.task.id).comments;
      const rawFenceComment = comments.find((c) => c.text.includes("```mc-action"));
      assert.strictEqual(
        rawFenceComment,
        undefined,
        `no comment should contain a raw mc-action fence, but found: ${rawFenceComment?.text.slice(0, 120)}`
      );

      // 3. The stripped plain text (preamble) IS stored as a status_update.
      const narrativeComment = comments.find((c) =>
        c.text.includes("Breaking down the request into three subtasks"),
      );
      assert.ok(
        narrativeComment,
        "expected the narrative preamble (without fences) to be imported as a comment",
      );

      // 4. Subtasks actually exist in the DB with the parent link intact.
      const projectTasks = listTasks({ projectId: fixture.project.id }).tasks;
      const subtasks = projectTasks.filter((t) =>
        ["Subtask A", "Subtask B", "Subtask C"].includes(t.title),
      );
      assert.strictEqual(subtasks.length, 3, `expected 3 subtasks, found ${subtasks.length}`);
      for (const sub of subtasks) {
        assert.strictEqual(
          sub.parentTaskId,
          fixture.task.id,
          `subtask ${sub.title} should have parent set to ${fixture.task.id}, got ${sub.parentTaskId}`,
        );
      }

      // 5. The update_task ran without regressing parent status. The stub
      //    marks the session terminal, which triggers the poll-path's
      //    in-progress → review auto-move (correct production behavior);
      //    the update_task itself tried to set status=in_progress, which
      //    is a no-op on a task that was already in-progress. Either
      //    in-progress or review confirms the action executed cleanly and
      //    didn't get rolled to backlog by the subtask-rollup path.
      const parentReloaded = getTask(fixture.task.id).task;
      assert.ok(
        parentReloaded.status === "in-progress" || parentReloaded.status === "review",
        `parent status should be in-progress or review after update_task + terminal auto-move, got ${parentReloaded.status}`,
      );
    });
  } finally {
    process.env.ORCHESTRATION_OPENCLAW_CLI = originalCli;
    if (stubCli) {
      rmSync(stubCli, { force: true });
    }
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
