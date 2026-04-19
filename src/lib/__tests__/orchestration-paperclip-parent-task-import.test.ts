/**
 * Contract test for Bug B: Paperclip bridge does NOT import parent_task_id
 * when pulling an issue's state into MC.
 *
 * Context: on the WEA-211 investigation (2026-04-18) Tim found that the
 * "subtask" cluster WEA-217/219/225/226/227/228/231 sits flat under the
 * project — no `parent_task_id` — even though in Paperclip they're linked
 * as children of WEA-211. Only 6 rows in the entire DB have a non-NULL
 * `parent_task_id`, all already `done`. The bridge layer has no parent
 * concept at all: `PaperclipIssueReference` doesn't surface `parentId`,
 * and `pullTaskBridgeStatus` never writes `parent_task_id`.
 *
 * This test writes two MC tasks with Paperclip issue mappings — one
 * parent, one child. The mocked Paperclip API returns a `parentId` on
 * the child issue pointing at the parent's Paperclip id. After
 * `pullTaskBridgeStatus` on the child, its `parent_task_id` should
 * equal the parent MC task's id.
 *
 * PRE-FIX: this test fails — parent_task_id stays null.
 * POST-FIX: this test passes.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-paperclip-parent-task-import.db \
 *   npx tsx src/lib/__tests__/orchestration-paperclip-parent-task-import.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";

import {
  createProject,
  createProjectAgent,
  createTask,
  getTask,
} from "@/lib/orchestration/service";
import { setTaskPaperclipIssueMapping } from "@/lib/orchestration/bridge/store";
import { pullTaskBridgeStatus } from "@/lib/orchestration/bridge/sync";

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

function createParentChildFixture() {
  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Paperclip Parent Project ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: "Parent/child Paperclip mapping fixture",
    color: "#8b5cf6",
    emoji: "🧪",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Paperclip Parent Agent ${Math.random().toString(36).slice(2, 6)}`,
    emoji: "🔧",
    role: "Backend Engineer",
    personality: "Precise",
    paperclipAgentId: `paperclip-agent-${Math.random().toString(36).slice(2, 8)}`,
    status: "idle",
    skills: [],
  }).agent;

  const parentTask = createTask({
    projectId: project.id,
    title: "Parent MC task (maps to pc-parent)",
    description: "Parent fixture",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test-suite",
  }).task;

  const childTask = createTask({
    projectId: project.id,
    title: "Child MC task (maps to pc-child)",
    description: "Child fixture — should get parent_task_id set after pull",
    priority: "P2",
    type: "feature",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test-suite",
  }).task;

  // Attach Paperclip issue ids to each MC task
  setTaskPaperclipIssueMapping({
    taskId: parentTask.id,
    issueId: "pc-parent",
    executionSessionId: "pc-parent",
  });
  setTaskPaperclipIssueMapping({
    taskId: childTask.id,
    issueId: "pc-child",
    executionSessionId: "pc-child",
  });

  return { project, agent, parentTask, childTask };
}

console.log("\nOrchestration Paperclip Parent-Task Import Contract Test (Bug B)\n");

async function run() {
  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }

    await test("pullTaskBridgeStatus sets parent_task_id from Paperclip parentId", async () => {
      setRequiredBridgeEnv();

      const fixture = createParentChildFixture();

      // Mock the Paperclip API. The child issue's response advertises
      // `parentId: "pc-parent"`. MC should resolve that to the parent
      // MC task's id and write it into `tasks.parent_task_id`.
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/api/issues/pc-child") && !url.includes("/comments")) {
          return new Response(
            JSON.stringify({
              id: "pc-child",
              identifier: "PC-200",
              status: "in_progress",
              priority: "medium",
              parentId: "pc-parent",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (url.includes("/api/issues/pc-child/comments")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({ error: { code: "unexpected_call", message: `Unexpected: ${url}` } }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;

      await pullTaskBridgeStatus(fixture.childTask.id);

      const reloadedChild = getTask(fixture.childTask.id).task;
      assert.strictEqual(
        reloadedChild.parentTaskId,
        fixture.parentTask.id,
        `expected child.parent_task_id to be ${fixture.parentTask.id} (parent MC task), got ${reloadedChild.parentTaskId ?? "null"}. ` +
        `Bug B: the Paperclip bridge pulls status + comments but never reconciles parent linkage, so MC stays flat even when Paperclip has the hierarchy.`,
      );
    });

    await test("pullTaskBridgeStatus silently drops unknown Paperclip parentId (not yet mapped in MC)", async () => {
      setRequiredBridgeEnv();

      const fixture = createParentChildFixture();

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/api/issues/pc-child") && !url.includes("/comments")) {
          return new Response(
            JSON.stringify({
              id: "pc-child",
              identifier: "PC-201",
              status: "in_progress",
              priority: "medium",
              parentId: "pc-unmapped-parent", // NOT mapped to any MC task
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (url.includes("/api/issues/pc-child/comments")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({ error: { code: "unexpected_call", message: `Unexpected: ${url}` } }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;

      // Should not throw. parent_task_id stays unset because we can't
      // resolve the Paperclip parent to an MC task. (Same policy as the
      // engine's `create_task.parent` handler for unknown task_keys:
      // silently drop, create top-level.)
      await pullTaskBridgeStatus(fixture.childTask.id);

      const reloadedChild = getTask(fixture.childTask.id).task;
      assert.ok(
        reloadedChild.parentTaskId === undefined || reloadedChild.parentTaskId === null,
        `expected child.parent_task_id to stay unset when Paperclip parentId is not mapped, got ${reloadedChild.parentTaskId}`,
      );
    });

    await test("pullTaskBridgeStatus leaves parent_task_id alone when Paperclip returns no parentId", async () => {
      setRequiredBridgeEnv();

      const fixture = createParentChildFixture();

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/api/issues/pc-child") && !url.includes("/comments")) {
          return new Response(
            JSON.stringify({
              id: "pc-child",
              identifier: "PC-202",
              status: "in_progress",
              priority: "medium",
              // No parentId
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (url.includes("/api/issues/pc-child/comments")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({ error: { code: "unexpected_call", message: `Unexpected: ${url}` } }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;

      await pullTaskBridgeStatus(fixture.childTask.id);

      const reloadedChild = getTask(fixture.childTask.id).task;
      assert.ok(
        reloadedChild.parentTaskId === undefined || reloadedChild.parentTaskId === null,
        `expected child.parent_task_id to stay unset when Paperclip returns no parentId, got ${reloadedChild.parentTaskId}`,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
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
