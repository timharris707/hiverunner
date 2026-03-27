import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { queueOrStartBuild, readTasks, writeTasks } from "@/lib/build-queue";

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

  // When a YouTube video is added, automatically create a processing task
  if (newReview.type === "youtube") {
    const tasks = readTasks();
    const processingTask = {
      id: `TASK-${Date.now()}`,
      title: `Process YouTube video: ${newReview.title}`,
      description: [
        `A new YouTube video was added to Ideas and needs to be processed.`,
        ``,
        `**Review ID:** ${newReview.id}`,
        `**URL:** ${newReview.url}`,
        `**Title:** ${newReview.title}`,
        ``,
        `### Steps`,
        `1. Use the existing YouTube scraper (check the idea-intake project for scraper scripts) to fetch the transcript and metadata for this video URL`,
        `2. Generate a comprehensive summary (2-3 paragraphs) describing the video content`,
        `3. Write an assessment of its relevance and value to the project`,
        `4. Extract 3-8 actionable takeaways with video timestamps, priority (high/medium/low), and effort (small/medium/large)`,
        `5. Update the review entry in ~/.openclaw/workspace/projects/idea-intake/reviews.json:`,
        `   - Set \`summary\` to the generated summary`,
        `   - Set \`assessment\` to the generated assessment`,
        `   - Set \`rating\` to a score from 1-5 based on relevance`,
        `   - Set \`takeaways\` array with objects matching the existing takeaway schema (id, title, description, video_timestamp, video_url, video_context, priority, effort, status: "idea")`,
        `   - Set \`title\` and \`channel\` if they can be extracted from the video metadata`,
      ].join("\n"),
      status: "in-progress",
      priority: "P2",
      project: "idea-intake",
      type: "feature",
      tags: ["youtube", "processing", "auto"],
      reviewId: newReview.id,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    tasks.unshift(processingTask);
    writeTasks(tasks);
    await queueOrStartBuild(processingTask.id, { source: "ideas-post-youtube" });
  }

  return NextResponse.json(newReview, { status: 201 });
}
