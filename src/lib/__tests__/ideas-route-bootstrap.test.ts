/**
 * Contract test for Ideas route auto-bootstrap of the processing project/agent.
 * Run:
 * node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/ideas-route-bootstrap.test.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
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

console.log("\nIdeas Route Bootstrap Contract Test\n");

async function run() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-ideas-bootstrap-"));
  const fakeHome = path.join(tmpRoot, "home");
  mkdirSync(path.join(fakeHome, ".openclaw", "workspace", "projects", "idea-intake"), { recursive: true });

  process.env.HOME = fakeHome;
  process.env.ORCHESTRATION_DB_PATH = path.join(tmpRoot, "orchestration.db");

  try {
    const { POST } = await import("@/app/api/ideas/route");
    const { getProject, listTasks, lookupAgentByName } = await import("@/lib/orchestration/service");

    await test("youtube review intake bootstraps the ideas pipeline project and Scout agent when missing", async () => {
      const req = {
        async json() {
          return {
            url: "https://www.youtube.com/watch?v=qaPHK1fJL5s",
            title: "Bootstrap fixture",
          };
        },
      } as any;

      const response = await POST(req);
      const body = await response.json() as { id: string; processingTask?: { created?: boolean; taskId?: string } | null };

      assert.equal(response.status, 201);
      assert.equal(body.processingTask?.created, true, "processing task should be created via auto-bootstrap");

      const tasks = listTasks({ sourceReviewId: body.id, includeNonProduction: true }).tasks;
      assert.equal(tasks.length, 1);

      const project = getProject(String(tasks[0]?.project)).project;
      assert.equal(project.slug, "ideas-pipeline");
      assert.equal(project.name, "Ideas Pipeline");

      const scout = lookupAgentByName({
        name: "Scout",
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
      }).agent;
      assert.equal(scout.name, "Scout");
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
