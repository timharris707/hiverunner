import { NextRequest, NextResponse } from "next/server";
import { queueOrStartBuild, readTasks, writeTasks } from "@/lib/build-queue";
import { readReviews, writeReviews } from "@/lib/ideas-store";

function hasProcessingTaskForReview(reviewId: string) {
  const tasks = readTasks();
  return tasks.some(
    (task) =>
      (task.reviewId === reviewId ||
        String(task.description || "").includes(`**Review ID:** ${reviewId}`)) &&
      !["done", "cancelled", "canceled"].includes(String(task.status || "").toLowerCase())
  );
}

async function enqueueProcessingTaskForReview(review: {
  id: string;
  type?: string;
  url?: string;
  title?: string;
}) {
  if (review.type !== "youtube" || hasProcessingTaskForReview(review.id)) {
    return false;
  }

  const tasks = readTasks();
  const processingTask = {
    id: `TASK-${Date.now()}`,
    title: `Process YouTube video: ${review.title}`,
    description: [
      `A new YouTube video was added to Ideas and needs to be processed.`,
      ``,
      `**Review ID:** ${review.id}`,
      `**URL:** ${review.url || ""}`,
      `**Title:** ${review.title || "Untitled Review"}`,
      ``,
      `### Steps`,
      `1. Use the existing YouTube scraper (check the idea-intake project for scraper scripts) to fetch the transcript and metadata for this video URL`,
      `2. Generate a comprehensive summary (2-3 paragraphs) describing the video content`,
      `3. Write an assessment of its relevance and value to the project`,
      `4. Extract 3-8 actionable takeaways with video timestamps, priority (high/medium/low), and effort (small/medium/large)`,
      `5. Update the review entry in the Mission Control Ideas store (SQLite-backed via APIs):`,
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
    reviewId: review.id,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  tasks.unshift(processingTask);
  writeTasks(tasks);
  await queueOrStartBuild(processingTask.id, { source: "ideas-post-youtube" });
  return true;
}

async function backfillProcessingTasksForExistingReviews(data: { reviews?: Array<Record<string, unknown>> }) {
  const reviewNeedsTimestampBackfill = (review: Record<string, unknown>) => {
    if (review.type !== "youtube") return false;
    const takeaways = Array.isArray(review.takeaways) ? (review.takeaways as Array<Record<string, unknown>>) : [];
    if (takeaways.length === 0) return true;

    return takeaways.some((takeaway) => {
      const timestamp = String(takeaway.video_timestamp ?? "").trim();
      if (!timestamp) return true;
      const videoUrl = String(takeaway.video_url ?? "").trim();
      return !/[?&](?:t|start|time_continue)=/i.test(videoUrl);
    });
  };

  const unprocessedYouTubeReviews = (data.reviews ?? []).filter((review) => {
    const takeaways = Array.isArray(review.takeaways) ? review.takeaways : [];
    const hasSummary = Boolean(review.summary);
    const hasAssessment = Boolean(review.assessment);
    return (
      review.type === "youtube" &&
      (!hasSummary || !hasAssessment || takeaways.length === 0 || reviewNeedsTimestampBackfill(review))
    );
  });

  for (const review of unprocessedYouTubeReviews) {
    await enqueueProcessingTaskForReview(review as { id: string; type?: string; url?: string; title?: string });
  }
}

export async function GET() {
  const data = await readReviews();
  await backfillProcessingTasksForExistingReviews(data);
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
    await enqueueProcessingTaskForReview(newReview);
  }

  return NextResponse.json(newReview, { status: 201 });
}
