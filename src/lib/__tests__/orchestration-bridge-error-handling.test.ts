/**
 * Contract tests for Paperclip bridge error handling.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-bridge-error-handling.db
 * npx tsx src/lib/__tests__/orchestration-bridge-error-handling.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";
import {
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listTaskComments,
} from "@/lib/orchestration/service";
import { PaperclipBridgeClient, PaperclipBridgeError } from "@/lib/orchestration/bridge/client";
import { triggerTaskAssignmentHeartbeat } from "@/lib/orchestration/bridge/sync";
import { getTaskBridgeRecord, setTaskPaperclipIssueMapping } from "@/lib/orchestration/bridge/store";

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

const originalFetch = globalThis.fetch;
const dbPath = process.env.ORCHESTRATION_DB_PATH;

function setRequiredBridgeEnv(): void {
  process.env.PAPERCLIP_API_URL = "http://paperclip.test";
  process.env.PAPERCLIP_API_KEY = "test-api-key";
  process.env.PAPERCLIP_BRIDGE_API_KEY = "test-board-key";
  process.env.PAPERCLIP_COMPANY_ID = "test-company";
  process.env.PAPERCLIP_RUN_ID = "test-run";
}

function createInProgressTaskFixture() {
  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Bridge Error Project ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: "Bridge error handling fixture",
    color: "#0ea5e9",
    emoji: "🧪",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Bridge Agent ${Math.random().toString(36).slice(2, 6)}`,
    emoji: "🔧",
    role: "Backend Engineer",
    personality: "Reliable",
    status: "idle",
    paperclipAgentId: `paperclip-${Math.random().toString(36).slice(2, 8)}`,
    skills: [],
  }).agent;

  const task = createTask({
    projectId: project.id,
    title: "Bridge execution test task",
    description: "Task for bridge execution error handling validation",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test-suite",
  }).task;

  return { project, agent, task };
}

console.log("\nOrchestration Bridge Error Handling Contract Test\n");

async function run() {
  try {
    await test("PaperclipBridgeClient retries retriable responses and eventually succeeds", async () => {
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount += 1;
        if (callCount < 3) {
          return new Response(
            JSON.stringify({ error: { code: "temporary_outage", message: "temporary failure" } }),
            { status: 503, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ id: "agent-1", name: "Forge", role: "engineer" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      const client = new PaperclipBridgeClient({
        apiUrl: "http://paperclip.test",
        apiKey: "test-api-key",
        bridgeApiKey: "test-board-key",
        companyId: "test-company",
        runId: "test-run",
        timeoutMs: 250,
        maxRetries: 2,
        retryBaseMs: 1,
      });

      const agent = await client.getAgent("agent-1");
      assert.strictEqual(agent.id, "agent-1");
      assert.strictEqual(callCount, 3);
    });

    await test("Wakeup requests use bridge API key while issue requests use standard API key", async () => {
      const seenAuthHeaders: Array<{ url: string; auth: string | null }> = [];

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(init?.headers);
        seenAuthHeaders.push({
          url,
          auth: headers.get("Authorization"),
        });

        if (url.includes("/api/issues/issue-1")) {
          return new Response(
            JSON.stringify({
              id: "issue-1",
              identifier: "NEVA-999",
              status: "todo",
              priority: "high",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url.includes("/wakeup?")) {
          return new Response(
            JSON.stringify({ id: "run-bridge-auth", status: "queued" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: { code: "unexpected_call", message: `Unexpected call: ${url}` } }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      const client = new PaperclipBridgeClient({
        apiUrl: "http://paperclip.test",
        apiKey: "test-api-key",
        bridgeApiKey: "test-board-key",
        companyId: "test-company",
        timeoutMs: 250,
        maxRetries: 0,
        retryBaseMs: 1,
      });

      await client.getIssue("issue-1");
      await client.wakeAgent("agent-bridge", {
        source: "assignment",
        triggerDetail: "test",
      });

      const issueAuth = seenAuthHeaders.find((entry) => entry.url.includes("/api/issues/issue-1"));
      const wakeAuth = seenAuthHeaders.find((entry) => entry.url.includes("/wakeup?"));

      assert.strictEqual(issueAuth?.auth, "Bearer test-api-key");
      assert.strictEqual(wakeAuth?.auth, "Bearer test-board-key");
    });

    await test("Heartbeat upserts Paperclip issue mapping before wake", async () => {
      setRequiredBridgeEnv();

      const fixture = createInProgressTaskFixture();
      const requestLog: Array<{ url: string; method: string; body: unknown }> = [];

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requestLog.push({ url, method, body });

        if (url.includes("/api/companies/test-company/issues")) {
          return new Response(
            JSON.stringify({
              id: "pc-issue-1",
              identifier: "NEVA-901",
              status: "in_progress",
              priority: "high",
              assigneeAgentId: fixture.agent.paperclipAgentId,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url.includes("/wakeup?")) {
          return new Response(
            JSON.stringify({ id: "run-123", status: "queued" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: { code: "unexpected_call", message: `Unexpected call: ${url}` } }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      const result = await triggerTaskAssignmentHeartbeat({
        taskId: fixture.task.id,
        reason: "test_create_and_wake",
      });

      assert.strictEqual(result.status, "queued");
      assert.strictEqual(result.runId, "run-123");
      assert.strictEqual(result.paperclipIssueId, "pc-issue-1");
      assert.strictEqual(result.paperclipIssueIdentifier, "NEVA-901");

      const taskAfter = getTaskBridgeRecord(fixture.task.id);
      assert.strictEqual(taskAfter.paperclipIssueId, "pc-issue-1");
      assert.strictEqual(taskAfter.executionMode, "paperclip");

      assert.strictEqual(requestLog.length, 2);
      assert.ok(
        requestLog[0]?.url.includes("/api/companies/test-company/issues"),
        "expected first call to create issue"
      );
      assert.ok(requestLog[0]?.method === "POST", "expected create issue POST");
      assert.ok(requestLog[1]?.url.includes("/wakeup?"), "expected second call to wake agent");
    });

    await test("Heartbeat updates existing Paperclip issue before wake", async () => {
      setRequiredBridgeEnv();

      const fixture = createInProgressTaskFixture();
      setTaskPaperclipIssueMapping({
        taskId: fixture.task.id,
        issueId: "pc-existing-42",
        executionSessionId: "pc-existing-42",
      });

      const requestLog: Array<{ url: string; method: string; body: unknown }> = [];

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requestLog.push({ url, method, body });

        if (url.endsWith("/api/issues/pc-existing-42")) {
          return new Response(
            JSON.stringify({
              id: "pc-existing-42",
              identifier: "NEVA-902",
              status: "in_progress",
              priority: "high",
              assigneeAgentId: fixture.agent.paperclipAgentId,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url.includes("/wakeup?")) {
          return new Response(
            JSON.stringify({ id: "run-456", status: "queued" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: { code: "unexpected_call", message: `Unexpected call: ${url}` } }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      const result = await triggerTaskAssignmentHeartbeat({
        taskId: fixture.task.id,
        reason: "test_update_and_wake",
      });

      assert.strictEqual(result.status, "queued");
      assert.strictEqual(result.runId, "run-456");
      assert.strictEqual(result.paperclipIssueId, "pc-existing-42");
      assert.strictEqual(result.paperclipIssueIdentifier, "NEVA-902");

      assert.strictEqual(requestLog.length, 2);
      assert.ok(requestLog[0]?.url.endsWith("/api/issues/pc-existing-42"));
      assert.strictEqual(requestLog[0]?.method, "PATCH");
      assert.ok(requestLog[1]?.url.includes("/wakeup?"));
    });

    await test("Heartbeat timeout auto-blocks task and records blocker comment", async () => {
      setRequiredBridgeEnv();

      globalThis.fetch = (async () => {
        const abortError = new Error("timed out");
        (abortError as Error & { name: string }).name = "AbortError";
        throw abortError;
      }) as typeof fetch;

      const fixture = createInProgressTaskFixture();

      await assert.rejects(
        triggerTaskAssignmentHeartbeat({
          taskId: fixture.task.id,
          reason: "test_timeout",
        }),
        (error: unknown) => {
          assert.ok(error instanceof PaperclipBridgeError);
          assert.strictEqual((error as PaperclipBridgeError).code, "paperclip_timeout");
          return true;
        }
      );

      const refreshed = getTask(fixture.task.id).task;
      assert.ok(refreshed, "expected refreshed task");
      assert.strictEqual(refreshed?.status, "blocked");
      assert.match(refreshed?.blockedReason ?? "", /timed out/i);

      const comments = listTaskComments(fixture.task.id).comments;
      const blocker = comments.find((comment) => comment.type === "blocker");
      assert.ok(blocker, "expected blocker comment to be created");
      assert.match(blocker?.text ?? "", /auto-blocked/i);
    });

    await test("Non-timeout bridge failures are surfaced in comments without forcing blocked status", async () => {
      setRequiredBridgeEnv();

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ error: { code: "agent_paused", message: "Agent is paused" } }),
          { status: 400, headers: { "content-type": "application/json" } }
        )) as typeof fetch;

      const fixture = createInProgressTaskFixture();

      await assert.rejects(
        triggerTaskAssignmentHeartbeat({
          taskId: fixture.task.id,
          reason: "test_non_timeout_failure",
        }),
        (error: unknown) => {
          assert.ok(error instanceof PaperclipBridgeError);
          assert.strictEqual((error as PaperclipBridgeError).code, "agent_paused");
          return true;
        }
      );

      const refreshed = getTask(fixture.task.id).task;
      assert.strictEqual(refreshed?.status, "in-progress");

      const comments = listTaskComments(fixture.task.id).comments;
      const statusUpdate = comments.find(
        (comment) => comment.type === "status_update" && /agent_paused/.test(comment.text)
      );
      assert.ok(statusUpdate, "expected status update comment with failure code");
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (dbPath) {
      try {
        rmSync(dbPath, { force: true });
        rmSync(`${dbPath}-shm`, { force: true });
        rmSync(`${dbPath}-wal`, { force: true });
      } catch {}
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  globalThis.fetch = originalFetch;
  if (dbPath) {
    try {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    } catch {}
  }
  console.error(error);
  process.exit(1);
});
