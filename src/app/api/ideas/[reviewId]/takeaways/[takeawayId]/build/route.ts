import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readReviews, writeReviews } from "@/lib/ideas-store";
import {
  createTask,
  listTasks,
  lookupAgentByName,
  lookupProjectByName,
} from "@/lib/orchestration/service";
import {
  OrchestrationApiError,
  errorResponse,
  handleRouteError,
} from "@/lib/orchestration/api";
import {
  appendTakeawayTaskNote,
  mapActionToTaskStatus,
  mapTakeawayPriority,
} from "@/lib/ideas-build-bridge";

const buildTakeawayTaskSchema = z.object({
  action: z.enum(["build-now", "add-to-queue"]).optional().default("add-to-queue"),
  companyId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  project: z.string().trim().min(1).optional(),
  assignee: z.string().trim().min(1).optional(),
  sprintId: z.string().trim().min(1).optional(),
});

interface Takeaway {
  id: string;
  title?: string;
  description?: string;
  priority?: string;
  effort?: string;
  assigned_to?: string;
  status?: string;
  github_issue?: string;
  video_timestamp?: string;
  video_url?: string;
  video_context?: string;
  notes?: string;
  [key: string]: unknown;
}

interface ReviewsStore {
  reviews: Array<{
    id: string;
    takeaways: Takeaway[];
  }>;
  meta?: {
    last_updated?: string;
    [key: string]: unknown;
  };
}

function toTaskDescription(takeaway: Takeaway): string {
  const base = String(takeaway.description ?? "").trim();
  const context = String(takeaway.video_context ?? "").trim();
  const videoUrl = String(takeaway.video_url ?? "").trim();
  const timestamp = String(takeaway.video_timestamp ?? "").trim();

  const sections = [base];

  if (context) {
    sections.push(`## Source Context\n${context}`);
  }

  if (videoUrl) {
    sections.push(`## Source Video\n- URL: ${videoUrl}${timestamp ? `\n- Timestamp: ${timestamp}` : ""}`);
  }

  return sections.filter(Boolean).join("\n\n").trim();
}

function toEffortLabel(effort: unknown): string | null {
  const normalized = String(effort ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return `effort:${normalized}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string; takeawayId: string }> }
) {
  try {
    const { reviewId, takeawayId } = await params;
    const body = buildTakeawayTaskSchema.parse(await req.json());
    const action = body.action;

    const data = (await readReviews()) as unknown as ReviewsStore;
    const review = data.reviews.find((candidate: { id: string }) => candidate.id === reviewId);
    if (!review) {
      return errorResponse(404, "review_not_found", "Review not found");
    }

    const takeaway = review.takeaways.find((candidate: Takeaway) => candidate.id === takeawayId) as
      | Takeaway
      | undefined;
    if (!takeaway) {
      return errorResponse(404, "takeaway_not_found", "Takeaway not found");
    }

    const effortLabel = toEffortLabel(takeaway.effort);
    const fallbackAssignee = String(takeaway.assigned_to ?? "").trim();
    const requestedProjectRef = body.projectId ?? body.project ?? "hiverunner";
    const requestedAssignee = body.assignee ?? (fallbackAssignee || undefined);

    let project: { id: string; slug: string; companyId: string };
    try {
      project = lookupProjectByName({
        name: requestedProjectRef,
        companyId: body.companyId,
      }).project;
    } catch (error) {
      if (error instanceof OrchestrationApiError && error.code === "project_not_found") {
        return errorResponse(
          404,
          "project_not_found",
          "Project not found for orchestration bridge",
          { requestedProject: requestedProjectRef }
        );
      }
      throw error;
    }

    let assignee: { id: string; name: string } | null = null;
    if (requestedAssignee) {
      try {
        assignee = lookupAgentByName({
          name: requestedAssignee,
          companyId: project.companyId,
        }).agent;
      } catch (error) {
        if (error instanceof OrchestrationApiError && error.code === "agent_not_found") {
          return errorResponse(
            400,
            "assignee_not_found",
            "Assignee not found for project's company",
            { requestedAssignee, companyId: project.companyId, projectId: project.id }
          );
        }
        throw error;
      }
    }

    const title = String(takeaway.title ?? "Idea Takeaway Task").trim() || "Idea Takeaway Task";
    const description = toTaskDescription(takeaway);
    const labels = ["from-idea", `idea-${takeaway.id}`, ...(effortLabel ? [effortLabel] : [])];
    const priority = mapTakeawayPriority(takeaway.priority);
    const status = mapActionToTaskStatus(action);

    const existingTask = listTasks({
      projectId: project.id,
      sourceReviewId: reviewId,
      sourceTakeawayId: takeawayId,
    }).tasks[0];

    if (existingTask) {
      takeaway.status = action === "build-now" ? "building" : "approved";
      takeaway.notes = appendTakeawayTaskNote({
        currentNotes: takeaway.notes,
        taskId: existingTask.id,
        action,
      });
      data.meta = data.meta ?? {};
      data.meta.last_updated = new Date().toISOString();
      await writeReviews(data as unknown as Record<string, unknown>);

      return NextResponse.json({
        task: existingTask,
        takeaway,
        bridge: {
          mode: "orchestration",
          deduplicated: true,
          reason: "source_takeaway_task_exists",
        },
      });
    }

    const taskPayload = createTask({
      projectId: project.id,
      title,
      description,
      priority,
      type: "feature",
      status,
      assignee: assignee?.id,
      sprintId: body.sprintId,
      labels,
      createdBy: "ideas-pipeline",
      sourceReviewId: reviewId,
      sourceTakeawayId: takeawayId,
    }).task as unknown as Record<string, unknown>;

    takeaway.status = action === "build-now" ? "building" : "approved";
    takeaway.notes = appendTakeawayTaskNote({
      currentNotes: takeaway.notes,
      taskId: String(taskPayload.id),
      action,
    });
    data.meta = data.meta ?? {};
    data.meta.last_updated = new Date().toISOString();
    await writeReviews(data as unknown as Record<string, unknown>);

    return NextResponse.json({
      task: taskPayload,
      takeaway,
      bridge: {
        mode: "orchestration",
        deduplicated: false,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid takeaway build payload", error.flatten());
    }
    return handleRouteError(error, "ideas:takeaway-build:post");
  }
}
