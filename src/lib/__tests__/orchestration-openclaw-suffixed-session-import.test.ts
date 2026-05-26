/**
 * Regression test for fresh OpenClaw session imports.
 *
 * Fresh OpenClaw sessions use a random suffix in their session key to avoid
 * stale deterministic-key collisions. The engine must import output from that
 * exact returned key, not from the deterministic unsuffixed fallback.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-openclaw-suffixed-session-import.db \
 *   npx tsx src/lib/__tests__/orchestration-openclaw-suffixed-session-import.test.ts
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
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

function createStubOpenClawCli(stateFile: string): string {
  const filePath = path.join(
    os.tmpdir(),
    `mc-openclaw-suffixed-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.js`,
  );

  const script = `#!/usr/bin/env node
const fs = require("fs");
const method = process.argv[4];
const paramsIndex = process.argv.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(process.argv[paramsIndex + 1] || "{}") : {};
const stateFile = ${JSON.stringify(stateFile)};
function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return {}; }
}
function writeState(next) {
  fs.writeFileSync(stateFile, JSON.stringify(next, null, 2));
}
function out(value) {
  process.stdout.write(JSON.stringify(value));
}

const state = readState();

if (method === "sessions.create") {
  state.createdKey = params.key;
  writeState(state);
  out({ ok: true, key: params.key, sessionId: "session-suffixed-1" });
  process.exit(0);
}

if (method === "sessions.send") {
  state.sentKey = params.key;
  writeState(state);
  out({ runId: "run-suffixed-1", status: "started" });
  process.exit(0);
}

if (method === "sessions.list") {
  const key = state.sentKey || state.createdKey || "";
  out({ sessions: key ? [{ key, sessionId: "session-suffixed-1", status: "completed", startedAt: 1777229395000, endedAt: 1777229405000 }] : [] });
  process.exit(0);
}

if (method === "sessions.get") {
  state.getKeys = [...(state.getKeys || []), params.key];
  writeState(state);
  if (params.key && params.key === state.sentKey) {
    const actionText = "Acknowledged.\\n\\n\`\`\`mc-action\\n" +
      JSON.stringify({
        action: "add_comment",
        taskKey: "__TASK_KEY__",
        body: "Imported from the suffixed OpenClaw session key.",
      }) +
      "\\n\`\`\`";
    out({
      sessionId: "session-suffixed-1",
      status: "completed",
      messages: [{
        role: "assistant",
        content: [{
          type: "text",
          text: actionText
        }]
      }]
    });
  } else {
    out({ sessionId: null, status: null, messages: [] });
  }
  process.exit(0);
}

console.error("unsupported method: " + method);
process.exit(1);
`;

  writeFileSync(filePath, script, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

console.log("\nOrchestration OpenClaw Suffixed Session Import Regression Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCli = process.env.ORCHESTRATION_OPENCLAW_CLI;
  const stateFile = path.join(
    os.tmpdir(),
    `mc-openclaw-suffixed-session-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  const stubCli = createStubOpenClawCli(stateFile);

  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
    process.env.ORCHESTRATION_OPENCLAW_CLI = stubCli;

    await test("executeHeartbeatRun imports mc-actions from the adapter's returned suffixed session key", async () => {
      const { createProject, createProjectAgent, createTask, listTaskComments } = await import("@/lib/orchestration/service");
      const { enqueueWakeup, executeHeartbeatRun } = await import("@/lib/orchestration/engine/engine");
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");

      const db = getOrchestrationDb();
      const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
      const project = createProject({
        companyId,
        name: `Suffixed Session Import ${Date.now()}`,
        description: "Fixture for suffixed session import regression",
        color: "#0ea5e9",
        emoji: "S",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `SuffixedImportAgent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "A",
        role: "Backend Engineer",
        personality: "Precise",
        openclawAgentId: `suffixed-import-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Import from suffixed session key",
        description: "The mc-action should be imported from the random-suffix session key.",
        priority: "P2",
        type: "infrastructure",
        status: "to-do",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;

      const script = (await import("node:fs")).readFileSync(stubCli, "utf8").replaceAll("__TASK_KEY__", task.key ?? "");
      (await import("node:fs")).writeFileSync(stubCli, script, "utf8");

      const wake = enqueueWakeup(
        {
          agentId: agent.id,
          companyId,
          source: "issue_assigned",
          reason: "task_created_assigned",
          payload: { taskId: task.id },
        },
        db,
      );

      const result = await executeHeartbeatRun(wake.heartbeatRunId, db);
      assert.strictEqual(result.status, "succeeded", result.error ?? "run should succeed");

      const state = JSON.parse((await import("node:fs")).readFileSync(stateFile, "utf8")) as {
        sentKey?: string;
        getKeys?: string[];
      };
      assert.ok(state.sentKey?.includes(`heartbeat:${task.id}:`), `expected random-suffix key, got ${state.sentKey}`);
      assert.ok(state.sentKey, "stub must record the random-suffix session key");
      assert.ok(
        state.getKeys?.includes(state.sentKey),
        `importer should poll the suffixed key. got keys: ${JSON.stringify(state.getKeys)}`,
      );

      const comments = listTaskComments(task.id).comments;
      assert.ok(
        comments.some((comment) => comment.text === "Imported from the suffixed OpenClaw session key."),
        `expected mc-action comment to be imported, got: ${comments.map((comment) => comment.text).join(" | ")}`,
      );
    });
  } finally {
    process.env.ORCHESTRATION_OPENCLAW_CLI = originalCli;
    rmSync(stubCli, { force: true });
    rmSync(stateFile, { force: true });
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
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
