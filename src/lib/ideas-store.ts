import fs from "fs/promises";
import path from "path";

const REVIEWS_PATH = path.join(
  process.env.HOME || "/Users/timharris",
  ".openclaw/workspace/projects/idea-intake/reviews.json",
);

export async function readReviews() {
  try {
    const raw = await fs.readFile(REVIEWS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      reviews: [],
      meta: {
        last_updated: new Date().toISOString(),
        total_reviews: 0,
        next_review_id: 1,
        next_takeaway_id: 1,
      },
    };
  }
}

export async function writeReviews(data: Record<string, unknown>) {
  await fs.writeFile(REVIEWS_PATH, JSON.stringify(data, null, 2), "utf-8");
}
