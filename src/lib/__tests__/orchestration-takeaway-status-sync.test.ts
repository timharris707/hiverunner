import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

async function waitForTakeawayStatus(
  readStatus: (takeawayId: string) => Promise<string | null>,
  takeawayId: string,
  expectedStatus: string,
  timeoutMs = 1_000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await readStatus(takeawayId);
    if (current === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const finalStatus = await readStatus(takeawayId);
  throw new Error(
    `Timed out waiting for takeaway ${takeawayId} status ${expectedStatus}; got ${String(finalStatus)}`
  );
}

async function run() {
  console.log("\nOrchestration Takeaway Status Sync Tests\n");

  const workspaceRoot = mkdtempSync(join(tmpdir(), "orchestration-takeaway-sync-"));
  const dbPath = join(workspaceRoot, "orchestration.db");
  const reviewsPath = join(
    workspaceRoot,
    ".openclaw",
    "workspace",
    "projects",
    "idea-intake",
    "reviews.json"
  );

  process.env.HOME = workspaceRoot;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.IDEAS_LEGACY_REVIEWS_PATH = reviewsPath;

  mkdirSync(dirname(reviewsPath), { recursive: true });
  writeFileSync(
    reviewsPath,
    JSON.stringify(
      {
        reviews: [
          {
            id: "review-1",
            takeaways: [
              { id: "tw-1", status: "approved", notes: "" },
              { id: "tw-2", status: "building", notes: "" },
              { id: "tw-3", status: "approved", notes: "" },
            ],
          },
        ],
        meta: {
          last_updated: new Date().toISOString(),
          total_reviews: 1,
          next_review_id: 2,
          next_takeaway_id: 4,
        },
      },
      null,
      2
    ),
    "utf-8"
  );

  const { createProject, createProjectAgent, createTask, moveTask } = await import("@/lib/orchestration/service");
  const { readReviews } = await import("@/lib/ideas-store");

  const readTakeawayStatus = async (takeawayId: string): Promise<string | null> => {
    const parsed = await readReviews();
    for (const review of parsed.reviews ?? []) {
      const takeaways = Array.isArray((review as { takeaways?: unknown }).takeaways)
        ? ((review as { takeaways?: Array<{ id?: string; status?: string }> }).takeaways ?? [])
        : [];
      for (const takeaway of takeaways) {
        if (String(takeaway.id ?? "") === takeawayId) {
          return String(takeaway.status ?? "");
        }
      }
    }
    return null;
  };

  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Takeaway Sync ${Date.now()}`,
    description: "fixture",
    color: "#0ea5e9",
    emoji: "\ud83d\udd27",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Sync Agent ${Date.now()}`,
    emoji: "\ud83e\udd16",
    role: "Backend Engineer",
    personality: "Precise",
    status: "idle",
    skills: [],
  }).agent;

  await test("moving task to in-progress syncs takeaway to building", async () => {
    const task = createTask({
      projectId: project.id,
      title: "Sync to building",
      description: "fixture",
      priority: "P2",
      type: "feature",
      status: "to-do",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
      sourceReviewId: "review-1",
      sourceTakeawayId: "tw-1",
    }).task;

    const moved = moveTask({
      taskId: task.id,
      status: "in-progress",
      actorUserId: "test",
    });

    assert.strictEqual(moved.task.status, "in-progress");
    assert.strictEqual(moved.task.sourceTakeawayId, "tw-1");
    await waitForTakeawayStatus(readTakeawayStatus, "tw-1", "building");
  });

  await test("moving task to done syncs takeaway to shipped", async () => {
    const task = createTask({
      projectId: project.id,
      title: "Sync to shipped",
      description: "fixture",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
      sourceReviewId: "review-1",
      sourceTakeawayId: "tw-2",
    }).task;

    moveTask({
      taskId: task.id,
      status: "review",
      actorUserId: "test",
    });

    const moved = moveTask({
      taskId: task.id,
      status: "done",
      actorUserId: "test",
      reviewNotes: "approved",
    });

    assert.strictEqual(moved.task.status, "done");
    await waitForTakeawayStatus(readTakeawayStatus, "tw-2", "shipped");
  });

  await test("missing ideas store does not break task status transitions", () => {
    rmSync(reviewsPath, { force: true });

    const task = createTask({
      projectId: project.id,
      title: "Missing ideas store",
      description: "fixture",
      priority: "P2",
      type: "feature",
      status: "to-do",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
      sourceReviewId: "review-1",
      sourceTakeawayId: "tw-3",
    }).task;

    const moved = moveTask({
      taskId: task.id,
      status: "in-progress",
      actorUserId: "test",
    });

    assert.strictEqual(moved.task.status, "in-progress");
  });

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
  delete process.env.IDEAS_LEGACY_REVIEWS_PATH;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
