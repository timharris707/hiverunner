import assert from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_ORCHESTRATION_COMPANY_ID,
  createFixtureAgent,
  createFixtureProject,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { restoreEnvSnapshot, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

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

  const envSnapshot = snapshotEnv(["HOME", "IDEAS_LEGACY_REVIEWS_PATH", "ORCHESTRATION_DB_PATH"]);
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({ prefix: "orchestration-takeaway-sync-" });
  const workspaceRoot = workspaceIsolation.tempRoot;
  const dbPath = join(workspaceRoot, "orchestration.db");
  const reviewsPath = join(
    workspaceRoot,
    ".openclaw",
    "workspace",
    "projects",
    "idea-intake",
    "reviews.json"
  );

  try {
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

    const project = createFixtureProject(createProject, {
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      namePrefix: "Takeaway Sync",
      label: "fixture",
      description: "fixture",
      color: "#0ea5e9",
      emoji: "\ud83d\udd27",
    });

    const agent = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "Sync Agent",
      emoji: "\ud83e\udd16",
      role: "Backend Engineer",
      openclawPrefix: "sync-agent",
      skills: [],
    });

    const createTakeawayTask = (input: { title: string; status: string; takeawayId: string }) =>
      createTask({
        projectId: project.id,
        title: input.title,
        description: "fixture",
        priority: "P2",
        type: "feature",
        status: input.status,
        assignee: agent.id,
        labels: [],
        createdBy: "test",
        sourceReviewId: "review-1",
        sourceTakeawayId: input.takeawayId,
      }).task;

    await test("moving task to in-progress syncs takeaway to building", async () => {
      const task = createTakeawayTask({ title: "Sync to building", status: "to-do", takeawayId: "tw-1" });

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
      const task = createTakeawayTask({ title: "Sync to shipped", status: "in-progress", takeawayId: "tw-2" });

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

      const task = createTakeawayTask({ title: "Missing ideas store", status: "to-do", takeawayId: "tw-3" });

      const moved = moveTask({
        taskId: task.id,
        status: "in-progress",
        actorUserId: "test",
      });

      assert.strictEqual(moved.task.status, "in-progress");
    });
  } finally {
    resetSqliteDatabaseFiles(dbPath);
    workspaceIsolation.dispose();
    restoreEnvSnapshot(envSnapshot);
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
