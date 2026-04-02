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

import {
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listTaskComments,
} from "@/lib/orchestration/service";
import { cancelTaskExecution, triggerTaskExecution } from "@/lib/orchestration/execution";
import { getTaskBridgeRecord } from "@/lib/orchestration/bridge/store";

let passed = 0;
let failed = 0;
const originalFetch = globalThis.fetch;

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

console.log("\nOrchestration OpenClaw Execution Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalCli = process.env.ORCHESTRATION_OPENCLAW_CLI;
  const originalExecutionProvider = process.env.ORCHESTRATION_EXECUTION_PROVIDER;
  const originalPaperclipApiUrl = process.env.PAPERCLIP_API_URL;
  const originalPaperclipApiKey = process.env.PAPERCLIP_API_KEY;
  const originalPaperclipCompanyId = process.env.PAPERCLIP_COMPANY_ID;
  const originalPaperclipRunId = process.env.PAPERCLIP_RUN_ID;
  const stubCli = createStubOpenClawCli();

  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }
    process.env.ORCHESTRATION_OPENCLAW_CLI = stubCli;
    delete process.env.ORCHESTRATION_EXECUTION_PROVIDER;

    await test("In-progress assigned task with openclawAgentId spawns session and persists session id", async () => {
      const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
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
      assert.strictEqual(result.status, "running");
      assert.strictEqual(result.queued, true);
      assert.strictEqual(result.sessionId, "session-oc-123");
      assert.strictEqual(result.runId, "run-oc-456");

      const bridgeTask = getTaskBridgeRecord(task.id);
      assert.strictEqual(bridgeTask.executionMode, "openclaw");
      assert.strictEqual(bridgeTask.executionSessionId, "session-oc-123");
    });

    await test("OpenClaw task with existing session skips duplicate spawn", async () => {
      const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
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
      assert.strictEqual(first.status, "running");

      const second = await triggerTaskExecution({ taskId: task.id });
      assert.strictEqual(second.status, "skipped");
      assert.strictEqual(second.reason, "openclaw_session_already_attached");
      assert.strictEqual(second.sessionId, "session-oc-123");
    });

    await test("Default execution provider does not fall back to Paperclip bridge", async () => {
      const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
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
        paperclipAgentId: "forge-paperclip-only",
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "OpenClaw provider default skip fallback",
        description: "No openclaw mapping should skip instead of bridge fallback",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;

      const result = await triggerTaskExecution({ taskId: task.id });
      assert.strictEqual(result.mode, "openclaw");
      assert.strictEqual(result.status, "skipped");
      assert.strictEqual(result.reason, "openclaw_agent_mapping_missing");
    });

    await test("Execution provider paperclip routes trigger through bridge heartbeat", async () => {
      process.env.ORCHESTRATION_EXECUTION_PROVIDER = "paperclip";
      process.env.PAPERCLIP_API_URL = "http://paperclip.test";
      process.env.PAPERCLIP_API_KEY = "test-api-key";
      process.env.PAPERCLIP_COMPANY_ID = "test-company";
      process.env.PAPERCLIP_RUN_ID = "test-run";

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/companies/test-company/issues")) {
          return new Response(
            JSON.stringify({
              id: "pc-issue-provider-1",
              identifier: "NEVA-903",
              status: "in_progress",
              priority: "high",
              assigneeAgentId: "forge-paperclip-provider",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.includes("/wakeup?")) {
          return new Response(
            JSON.stringify({ id: "run-provider-1", status: "queued" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ error: { code: "unexpected_call", message: `Unexpected call: ${url}` } }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Paperclip Provider Project ${Date.now()}`,
        description: "Bridge provider fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Paperclip Provider Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Flexible",
        paperclipAgentId: "forge-paperclip-provider",
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Paperclip provider execution path",
        description: "Bridge execution should be used when provider=paperclip",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;

      const result = await triggerTaskExecution({ taskId: task.id });
      assert.strictEqual(result.mode, "paperclip");
      assert.strictEqual(result.status, "queued");
      assert.strictEqual(result.runId, "run-provider-1");
      assert.strictEqual(result.reason, undefined);

      process.env.ORCHESTRATION_EXECUTION_PROVIDER = "openclaw";
      globalThis.fetch = originalFetch;
    });

    await test("Paperclip idempotency key reuses run and does not trigger duplicate wakeup", async () => {
      process.env.ORCHESTRATION_EXECUTION_PROVIDER = "paperclip";
      process.env.PAPERCLIP_API_URL = "http://paperclip.test";
      process.env.PAPERCLIP_API_KEY = "test-api-key";
      process.env.PAPERCLIP_COMPANY_ID = "test-company";
      process.env.PAPERCLIP_RUN_ID = "test-run";

      let wakeupCalls = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/companies/test-company/issues")) {
          return new Response(
            JSON.stringify({
              id: "pc-issue-provider-idempotency",
              identifier: "NEVA-904",
              status: "in_progress",
              priority: "high",
              assigneeAgentId: "forge-paperclip-provider-idempotency",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.includes("/wakeup?")) {
          wakeupCalls += 1;
          return new Response(
            JSON.stringify({ id: "run-provider-idempotent", status: "queued" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ error: { code: "unexpected_call", message: `Unexpected call: ${url}` } }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      try {
        const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
          name: `Paperclip Idempotency Project ${Date.now()}`,
          description: "Idempotency provider fixture",
          color: "#0ea5e9",
          emoji: "🧪",
          status: "active",
        }).project;

        const agent = createProjectAgent({
          projectId: project.id,
          name: `Paperclip Idempotency Agent ${Math.random().toString(36).slice(2, 6)}`,
          emoji: "🔁",
          role: "Backend Engineer",
          personality: "Consistent",
          paperclipAgentId: "forge-paperclip-provider-idempotency",
          status: "idle",
          skills: [],
        }).agent;

        const task = createTask({
          projectId: project.id,
          title: "Paperclip idempotency execution path",
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

        assert.strictEqual(first.mode, "paperclip");
        assert.strictEqual(first.status, "queued");
        assert.strictEqual(second.mode, "paperclip");
        assert.strictEqual(second.reason, "idempotency_key_reused");
        assert.strictEqual(second.status, "queued");
        assert.strictEqual(wakeupCalls, 1);
      } finally {
        process.env.ORCHESTRATION_EXECUTION_PROVIDER = "openclaw";
        globalThis.fetch = originalFetch;
      }
    });

    await test("Cancel execution moves task back to on-deck and clears session id", async () => {
      const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
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

      const started = await triggerTaskExecution({ taskId: task.id, reason: "test_cancel_start" });
      assert.strictEqual(started.sessionId, "session-oc-123");

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
      assert.strictEqual(cancelled.transition.to, "on-deck");
      assert.strictEqual(cancelled.task.status, "on-deck");

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
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
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

      await triggerTaskExecution({ taskId: task.id, reason: "test_cancel_keep_start" });
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
    if (originalPaperclipApiUrl === undefined) {
      delete process.env.PAPERCLIP_API_URL;
    } else {
      process.env.PAPERCLIP_API_URL = originalPaperclipApiUrl;
    }
    if (originalPaperclipApiKey === undefined) {
      delete process.env.PAPERCLIP_API_KEY;
    } else {
      process.env.PAPERCLIP_API_KEY = originalPaperclipApiKey;
    }
    if (originalPaperclipCompanyId === undefined) {
      delete process.env.PAPERCLIP_COMPANY_ID;
    } else {
      process.env.PAPERCLIP_COMPANY_ID = originalPaperclipCompanyId;
    }
    if (originalPaperclipRunId === undefined) {
      delete process.env.PAPERCLIP_RUN_ID;
    } else {
      process.env.PAPERCLIP_RUN_ID = originalPaperclipRunId;
    }
    globalThis.fetch = originalFetch;
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
