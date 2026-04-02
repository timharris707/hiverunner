/**
 * Contract test for deduplicating Ideas takeaway -> orchestration task creation.
 * Run:
 * node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/ideas-takeaway-build-route-dedup.test.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

console.log("\nIdeas Takeaway Build Route Dedup Contract Test\n");

async function run() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-ideas-dedup-"));
  const fakeHome = path.join(tmpRoot, "home");
  const ideasDir = path.join(fakeHome, ".openclaw", "workspace", "projects", "idea-intake");
  mkdirSync(ideasDir, { recursive: true });

  const dbPath = path.join(tmpRoot, "orchestration.db");
  process.env.HOME = fakeHome;
  process.env.ORCHESTRATION_DB_PATH = dbPath;

  const reviewId = `review-dedup-${Date.now()}`;
  const takeawayId = `tw-dedup-${Date.now()}`;

  writeFileSync(
    path.join(ideasDir, "reviews.json"),
    JSON.stringify(
      {
        reviews: [
          {
            id: reviewId,
            type: "youtube",
            title: "Dedup fixture",
            takeaways: [
              {
                id: takeawayId,
                title: "Implement task queue deduplication",
                description: "Ensure repeated build requests do not create duplicate tasks.",
                priority: "high",
                effort: "medium",
                assigned_to: "forge",
                status: "idea",
                notes: "",
              },
            ],
          },
        ],
        meta: { last_updated: new Date().toISOString() },
      },
      null,
      2
    ),
    "utf-8"
  );

  const { POST } = await import("@/app/api/ideas/[reviewId]/takeaways/[takeawayId]/build/route");
  const { createProject, createProjectAgent, listTasks } = await import("@/lib/orchestration/service");

  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Ideas Dedup Contract ${Date.now()}`,
    description: "Fixture project for ideas/takeaway build dedup test",
    color: "#0ea5e9",
    emoji: "🧪",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Forge Dedup ${Math.random().toString(36).slice(2, 7)}`,
    emoji: "🔧",
    role: "Backend Engineer",
    personality: "Contract-first",
    status: "idle",
    skills: ["api", "orchestration"],
  }).agent;

  try {
    await test("repeated takeaway build calls reuse the same orchestration task", async () => {
      const makeReq = () =>
        ({
          async json() {
            return { action: "add-to-queue", projectId: project.id, assignee: agent.name };
          },
        }) as any;

      const routeParams = Promise.resolve({ reviewId, takeawayId });

      const first = await POST(makeReq(), { params: routeParams });
      const firstBody = (await first.json()) as {
        task?: { id: string };
        bridge?: { deduplicated?: boolean };
        error?: { code?: string; message?: string };
      };
      assert.equal(
        first.status,
        200,
        `first call failed: ${JSON.stringify(firstBody.error ?? firstBody)}`
      );
      assert.equal(firstBody.bridge?.deduplicated, false);
      assert.match(String(firstBody.task?.id ?? ""), /^[0-9a-f-]{36}$/);

      const second = await POST(makeReq(), { params: Promise.resolve({ reviewId, takeawayId }) });
      const secondBody = (await second.json()) as {
        task?: { id: string };
        bridge?: { deduplicated?: boolean; reason?: string };
        error?: { code?: string; message?: string };
      };
      assert.equal(
        second.status,
        200,
        `second call failed: ${JSON.stringify(secondBody.error ?? secondBody)}`
      );

      assert.equal(secondBody.task?.id, firstBody.task?.id);
      assert.equal(secondBody.bridge?.deduplicated, true);
      assert.equal(secondBody.bridge?.reason, "source_takeaway_task_exists");

      const matches = listTasks({
        sourceReviewId: reviewId,
        sourceTakeawayId: takeawayId,
      }).tasks;
      assert.equal(matches.length, 1);
      assert.equal(matches[0]?.id, firstBody.task?.id);
    });
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
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
