/**
 * Contract tests for the browser task status client.
 * Run:
 * npx tsx src/lib/__tests__/orchestration-client-task-status.test.ts
 */

import assert from "node:assert/strict";

import { updateTaskStatus, updateTaskStatusDetailed } from "@/lib/orchestration/client";

let passed = 0;
let failed = 0;
const originalFetch = globalThis.fetch;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration Client Task Status Contract Test\n");

async function run() {
  await test("status updates can include review notes", async () => {
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const ok = await updateTaskStatus("task-1", "done", undefined, {
      reviewNotes: "Marked done from task properties.",
    });

    assert.equal(ok, true);
    assert.ok(requestBody);
    const body = requestBody as Record<string, unknown>;
    assert.equal(body.taskId, "task-1");
    assert.equal(body.status, "done");
    assert.equal(body.reviewNotes, "Marked done from task properties.");
  });

  await test("orchestration validation failures do not fall through to legacy task API", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ error: { code: "review_notes_required" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const ok = await updateTaskStatus("task-1", "done");

    assert.equal(ok, false);
    assert.deepEqual(urls, ["/api/orchestration/tasks/reorder"]);
  });

  await test("detailed status update exposes orchestration error codes", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        error: {
          code: "assignee_required",
          message: "This status transition requires an assignee",
        },
      }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await updateTaskStatusDetailed("task-1", "in-progress");

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "assignee_required");
    assert.equal(result.message, "This status transition requires an assignee");
  });
}

run()
  .finally(() => {
    globalThis.fetch = originalFetch;
  })
  .then(() => {
    console.log(`\nResult: ${passed}/${passed + failed} passed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
