import { NextRequest, NextResponse } from "next/server";
import { readReviews, writeReviews } from "@/lib/ideas-store";
import {
  createProject,
  createProjectAgent,
  createTask,
  listTasks,
  lookupAgentByName,
  lookupProjectByName,
} from "@/lib/orchestration/service";
import { OrchestrationApiError } from "@/lib/orchestration/api";

const IDEAS_PIPELINE_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
const IDEAS_PROJECT_LOOKUP_CANDIDATES = [
  "ideas-pipeline",
  "Ideas Pipeline",
  "idea-intake",
  "Idea Intake",
] as const;

type IdeasPipelineProject = { id: string; companyId: string };

function requireProjectCompany(project: { id: string; companyId?: string }): IdeasPipelineProject {
  if (!project.companyId) {
    throw new Error(`Ideas pipeline project ${project.id} is missing companyId`);
  }
  return { ...project, companyId: project.companyId };
}

function resolveIdeasPipelineProject(): IdeasPipelineProject {
  for (const candidate of IDEAS_PROJECT_LOOKUP_CANDIDATES) {
    try {
      return requireProjectCompany(lookupProjectByName({
        name: candidate,
        companyId: IDEAS_PIPELINE_COMPANY_ID,
      }).project);
    } catch (error) {
      if (!(error instanceof OrchestrationApiError) || error.code !== "project_not_found") {
        throw error;
      }
    }
  }

  return requireProjectCompany(createProject({
    companyId: IDEAS_PIPELINE_COMPANY_ID,
    name: "Ideas Pipeline",
    slug: "ideas-pipeline",
    description: "Idea intake, triage, synthesis, and task generation loop",
    color: "#14b8a6",
    emoji: "💡",
    status: "active",
  }).project);
}

function resolveIdeasPipelineScout(project: { id: string; companyId: string }) {
  try {
    return lookupAgentByName({
      name: "Scout",
      companyId: project.companyId,
    }).agent;
  } catch (error) {
    if (!(error instanceof OrchestrationApiError) || error.code !== "agent_not_found") {
      throw error;
    }
  }

  return createProjectAgent({
    projectId: project.id,
    companyId: project.companyId,
    name: "Scout",
    emoji: "🧭",
    role: "Research Agent",
    personality: "Methodical scout for idea intake, triage, and synthesis",
    status: "idle",
    skills: ["research", "ideas", "triage"],
  }).agent;
}

async function enqueueProcessingTaskForReview(review: {
  id: string;
  type?: string;
  url?: string;
  title?: string;
}) {
  if (review.type !== "youtube") {
    return { created: false, deduplicated: false };
  }

  const existingTask = listTasks({
    companyIdOrSlug: IDEAS_PIPELINE_COMPANY_ID,
    sourceReviewId: review.id,
    includeArchived: false,
    includeNonProduction: true,
  }).tasks.find((task) => !["done"].includes(String(task.status || "").toLowerCase()));

  if (existingTask) {
    return { created: false, deduplicated: true, taskId: existingTask.id };
  }

  const project = resolveIdeasPipelineProject();

  const scout = resolveIdeasPipelineScout(project);

  const createdTask = createTask({
    projectId: project.id,
    title: `Process YouTube video: ${review.title || "Untitled Review"}`,
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
      `5. Update the review entry in the HiveRunner Ideas store (SQLite-backed via APIs):`,
      `   - Set \`summary\` to the generated summary`,
      `   - Set \`assessment\` to the generated assessment`,
      `   - Set \`rating\` to a score from 1-5 based on relevance`,
      `   - Set \`takeaways\` array with objects matching the existing takeaway schema (id, title, description, video_timestamp, video_url, video_context, priority, effort, status: "idea")`,
      `   - Set \`title\` and \`channel\` if they can be extracted from the video metadata`,
    ].join("\n"),
    priority: "P1",
    type: "feature",
    status: "in-progress",
    assignee: scout.id,
    labels: ["youtube", "processing", "auto", "ideas"],
    createdBy: "ideas-pipeline",
    sourceReviewId: review.id,
  }).task;

  return { created: true, deduplicated: false, taskId: createdTask.id };
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
    try {
      await enqueueProcessingTaskForReview(review as { id: string; type?: string; url?: string; title?: string });
    } catch (error) {
      console.error("[ideas] failed to backfill processing task", {
        reviewId: String(review.id ?? ""),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function GET() {
  const data = await readReviews();
  try {
    await backfillProcessingTasksForExistingReviews(data);
  } catch (error) {
    console.error("[ideas] backfill on GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

  let processingTask: Awaited<ReturnType<typeof enqueueProcessingTaskForReview>> | null = null;

  // When a YouTube video is added, automatically create a processing task.
  // This hook is intentionally non-fatal because the review write already succeeded.
  if (newReview.type === "youtube") {
    try {
      processingTask = await enqueueProcessingTaskForReview(newReview);
    } catch (error) {
      console.error("[ideas] failed to enqueue processing task", {
        reviewId: newReview.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ ...newReview, processingTask }, { status: 201 });
}
