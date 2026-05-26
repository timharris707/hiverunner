import fs from "fs/promises";
import os from "os";
import path from "path";

import { writeReviews, readReviews } from "@/lib/ideas-store";

const LEGACY_REVIEWS_PATH = path.join(
  process.env.HOME || os.homedir(),
  ".openclaw/workspace/projects/idea-intake/reviews.json"
);

async function run() {
  try {
    const raw = await fs.readFile(LEGACY_REVIEWS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.reviews)) {
      throw new Error("Legacy reviews JSON is malformed: expected top-level { reviews: [] }");
    }

    await writeReviews(parsed);
    const current = await readReviews();

    const reviewCount = current.reviews.length;
    const takeawayCount = current.reviews.reduce((acc, review) => {
      const takeaways = Array.isArray((review as { takeaways?: unknown }).takeaways)
        ? ((review as { takeaways?: unknown[] }).takeaways ?? [])
        : [];
      return acc + takeaways.length;
    }, 0);

    console.log(
      `[ideas:migrate] Imported ${reviewCount} reviews / ${takeawayCount} takeaways from ${LEGACY_REVIEWS_PATH}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ideas:migrate] Failed: ${message}`);
    process.exitCode = 1;
  }
}

void run();
