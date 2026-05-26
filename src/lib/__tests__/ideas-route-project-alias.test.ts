/**
 * Contract test for Ideas route processing-task lookup across legacy project naming.
 * Run:
 * node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/ideas-route-project-alias.test.ts
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

console.log("\nIdeas Route Legacy Project Alias Contract Test\n");

async function run() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-ideas-alias-"));
  const fakeHome = path.join(tmpRoot, "home");
  const workspaceRoot = path.join(fakeHome, ".openclaw", "workspace", "projects", "idea-intake");
  mkdirSync(workspaceRoot, { recursive: true });

  process.env.HOME = fakeHome;
  process.env.ORCHESTRATION_DB_PATH = path.join(tmpRoot, "orchestration.db");

  try {
    const { POST } = await import("@/app/api/ideas/route");
    const { createProject, createProjectAgent, listTasks } = await import("@/lib/orchestration/service");

    const legacyProject = createProject({
      companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
      name: "Idea Intake",
      description: "Legacy ideas pipeline fixture",
      color: "#14b8a6",
      emoji: "💡",
      status: "active",
    }).project;

    createProjectAgent({
      projectId: legacyProject.id,
      name: "Scout",
      emoji: "🧭",
      role: "Research Agent",
      personality: "Methodical",
      status: "idle",
      skills: ["research", "ideas"],
    });

    await test("youtube review intake still creates processing task when only legacy idea-intake project exists", async () => {
      const req = {
        async json() {
          return {
            url: "https://www.youtube.com/watch?v=op51LiWswcY",
            title: "Legacy project alias fixture",
          };
        },
      } as any;

      const response = await POST(req);
      const body = await response.json() as { id: string; processingTask?: { created?: boolean; deduplicated?: boolean; taskId?: string } | null };

      assert.equal(response.status, 201);
      assert.equal(body.processingTask?.created, true, "processing task should be created even with legacy project name");
      assert.equal(body.processingTask?.deduplicated, false);
      assert.match(String(body.processingTask?.taskId ?? ""), /^[0-9a-f-]{36}$/);

      const tasks = listTasks({ sourceReviewId: body.id, includeNonProduction: true }).tasks;
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]?.project, legacyProject.id);
      assert.equal(tasks[0]?.status, "in-progress");
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
