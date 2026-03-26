import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const REVIEWS_PATH = path.join(
  process.env.HOME || "/Users/timharris",
  ".openclaw/workspace/projects/idea-intake/reviews.json"
);

export async function readReviews() {
  try {
    const raw = await fs.readFile(REVIEWS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { reviews: [], meta: { last_updated: new Date().toISOString(), total_reviews: 0, next_review_id: 1, next_takeaway_id: 1 } };
  }
}

export async function writeReviews(data: Record<string, unknown>) {
  await fs.writeFile(REVIEWS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export async function GET() {
  const data = await readReviews();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { url, title, source } = body as {
    url?: string;
    title?: string;
    source?: string;
  };

  if (!url && !title) {
    return NextResponse.json({ error: "url or title is required" }, { status: 400 });
  }

  const data = await readReviews();
  const nextId = data.meta?.next_review_id ?? data.reviews.length + 1;

  const newReview = {
    id: `review-${String(nextId).padStart(3, "0")}`,
    type: source || "manual",
    url: url || "",
    title: title || url || "Untitled Review",
    channel: "",
    thumbnail: "",
    duration: "",
    reviewed_at: new Date().toISOString(),
    submitted_by: "tim",
    status: "active",
    summary: "",
    assessment: "",
    rating: 0,
    takeaways: [],
  };

  // Auto-detect YouTube and set thumbnail
  if (url) {
    const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      newReview.type = "youtube";
      newReview.thumbnail = `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`;
    }
  }

  data.reviews.push(newReview);
  data.meta = {
    ...data.meta,
    last_updated: new Date().toISOString(),
    total_reviews: data.reviews.length,
    next_review_id: nextId + 1,
  };

  await writeReviews(data);
  return NextResponse.json(newReview, { status: 201 });
}
