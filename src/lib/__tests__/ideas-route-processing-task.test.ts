/**
 * Contract test for Ideas route review intake creating orchestration processing tasks.
 * Run:
 * node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/ideas-route-processing-task.test.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";

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

console.log("\nIdeas Route Processing Task Contract Test\n");

async function run() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-ideas-route-"));
  const fakeHome = path.join(tmpRoot, "home");
  const workspaceRoot = path.join(fakeHome, ".openclaw", "workspace", "projects", "idea-intake");
  mkdirSync(workspaceRoot, { recursive: true });

  process.env.HOME = fakeHome;
  process.env.ORCHESTRATION_DB_PATH = path.join(tmpRoot, "orchestration.db");

  try {
    const { POST } = await import("@/app/api/ideas/route");
    const { createProject, createProjectAgent, listTasks } = await import("@/lib/orchestration/service");

    const project = createProject({
      companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
      name: "Ideas Pipeline",
      description: "Ideas pipeline fixture",
      color: "#f59e0b",
      emoji: "💡",
      status: "active",
    }).project;

    createProjectAgent({
      projectId: project.id,
      name: "Scout",
      emoji: "🧭",
      role: "Research Agent",
      personality: "Methodical",
      status: "idle",
      skills: ["research", "ideas"],
    });

    await test("youtube review intake creates one orchestration processing task and stays idempotent", async () => {
      const req = {
        async json() {
          return {
            url: "https://www.youtube.com/watch?v=qaPHK1fJL5s",
            title: "Processing task contract fixture",
          };
        },
      } as unknown as NextRequest;

      const response = await POST(req);
      const body = await response.json() as { id: string; processingTask?: { created?: boolean; deduplicated?: boolean; taskId?: string } | null };

      assert.equal(response.status, 201);
      assert.equal(body.processingTask?.created, true);
      assert.equal(body.processingTask?.deduplicated, false);
      assert.match(String(body.processingTask?.taskId ?? ""), /^[0-9a-f-]{36}$/);

      const tasks = listTasks({ sourceReviewId: body.id, includeNonProduction: true }).tasks;
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]?.sourceReviewId, body.id);
      assert.equal(tasks[0]?.status, "in-progress");
    });

    await test("ideas backfill does not duplicate a processing task when the review title contains non-production tokens", async () => {
      const req = {
        async json() {
          return {
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title: "MC stress test visual duplicate guard",
          };
        },
      } as unknown as NextRequest;

      const created = await POST(req);
      const body = await created.json() as { id: string; processingTask?: { created?: boolean; deduplicated?: boolean; taskId?: string } | null };
      assert.equal(created.status, 201);
      assert.equal(body.processingTask?.created, true);

      const beforeBackfill = listTasks({ sourceReviewId: body.id, includeNonProduction: true }).tasks;
      assert.equal(beforeBackfill.length, 1, "initial intake should create exactly one task");

      const { GET } = await import("@/app/api/ideas/route");
      const getResponse = await GET();
      assert.equal(getResponse.status, 200);

      const afterBackfill = listTasks({ sourceReviewId: body.id, includeNonProduction: true }).tasks;
      assert.equal(afterBackfill.length, 1, "GET/backfill should not create a duplicate task for the same review");
    });
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
