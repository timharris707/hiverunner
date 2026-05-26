import assert from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function legacyReviewsPath(homeDir: string): string {
  return path.join(homeDir, ".openclaw", "workspace", "projects", "idea-intake", "reviews.json");
}

function readLegacyJson(homeDir: string): Record<string, unknown> {
  const raw = readFileSync(legacyReviewsPath(homeDir), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function run() {
  console.log("\nIdeas Store SQLite Migration Contract Tests\n");

  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-ideas-sqlite-"));
  const fakeHome = path.join(tmpRoot, "home");
  const reviewsPath = legacyReviewsPath(fakeHome);
  mkdirSync(path.dirname(reviewsPath), { recursive: true });

  const dbPath = path.join(tmpRoot, "orchestration.db");
  process.env.HOME = fakeHome;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.IDEAS_LEGACY_REVIEWS_PATH = reviewsPath;

  writeFileSync(
    reviewsPath,
    JSON.stringify(
      {
        reviews: [
          {
            id: "review-101",
            type: "youtube",
            url: "https://youtu.be/dQw4w9WgXcQ",
            title: "Legacy Import Fixture",
            status: "active",
            summary: "",
            assessment: "",
            rating: 0,
            takeaways: [
              {
                id: "tw-101",
                title: "Migrate to sqlite",
                description: "Replace JSON-backed store",
                priority: "high",
                effort: "medium",
                status: "idea",
                notes: "",
              },
            ],
          },
        ],
        meta: {
          last_updated: new Date().toISOString(),
          total_reviews: 1,
          next_review_id: 102,
          next_takeaway_id: 102,
        },
      },
      null,
      2
    ),
    "utf-8"
  );

  const {
    readReviews,
    writeReviews,
    syncTakeawayStatusFromTaskLifecycle,
  } = await import("@/lib/ideas-store");

  try {
    await test("readReviews imports explicitly configured legacy JSON into SQLite when DB is empty", async () => {
      const result = await readReviews();
      assert.equal(result.reviews.length, 1);
      assert.equal(result.reviews[0]?.id, "review-101");
      const takeaways = (result.reviews[0]?.takeaways ?? []) as Array<{ id?: string }>;
      assert.equal(takeaways[0]?.id, "tw-101");
    });

    await test("writeReviews persists to SQLite and does not require JSON rewrites", async () => {
      const current = await readReviews();
      current.reviews[0] = {
        ...(current.reviews[0] as Record<string, unknown>),
        summary: "Imported and persisted",
      };

      await writeReviews(current);
      const reloaded = await readReviews();
      assert.equal(reloaded.reviews[0]?.summary, "Imported and persisted");

      const legacy = readLegacyJson(fakeHome) as {
        reviews?: Array<{ summary?: string }>;
      };
      assert.notEqual(legacy.reviews?.[0]?.summary, "Imported and persisted");
    });

    await test("lifecycle sync updates takeaway status from SQLite store", async () => {
      const sync = syncTakeawayStatusFromTaskLifecycle({
        takeawayId: "tw-101",
        taskStatus: "in-progress",
      });
      assert.equal(sync.updated, true);

      const reloaded = await readReviews();
      const takeaway = ((reloaded.reviews[0]?.takeaways ?? []) as Array<{ id?: string; status?: string }>)
        .find((entry) => entry.id === "tw-101");
      assert.equal(takeaway?.status, "building");
    });
  } finally {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.IDEAS_LEGACY_REVIEWS_PATH;
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
