import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { createTaskSchema, listTasksQuerySchema } from "@/lib/orchestration/contracts";
import { createTask, listTasks } from "@/lib/orchestration/service";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const includeNonProductionRaw = req.nextUrl.searchParams.get("includeNonProduction");
    const query = listTasksQuerySchema.parse({
      company: req.nextUrl.searchParams.get("company") ?? undefined,
      projectId: req.nextUrl.searchParams.get("projectId") ?? undefined,
      assignee: req.nextUrl.searchParams.get("assignee") ?? undefined,
      status: req.nextUrl.searchParams.get("status") ?? undefined,
      priority: req.nextUrl.searchParams.get("priority") ?? undefined,
      type: req.nextUrl.searchParams.get("type") ?? undefined,
      search: req.nextUrl.searchParams.get("search") ?? undefined,
      sort: req.nextUrl.searchParams.get("sort") ?? undefined,
      sourceReviewId: req.nextUrl.searchParams.get("sourceReviewId") ?? undefined,
      sourceTakeawayId: req.nextUrl.searchParams.get("sourceTakeawayId") ?? undefined,
      includeArchived: req.nextUrl.searchParams.get("includeArchived") ?? undefined,
      includeNonProduction: includeNonProductionRaw ?? undefined,
    });

    const includeNonProduction =
      includeNonProductionRaw === null && query.projectId ? true : query.includeNonProduction;

    return NextResponse.json(
      listTasks({
        companyIdOrSlug: query.company,
        projectId: query.projectId,
        assignee: query.assignee,
        status: query.status,
        priority: query.priority,
        type: query.type,
        search: query.search,
        sort: query.sort,
        sourceReviewId: query.sourceReviewId,
        sourceTakeawayId: query.sourceTakeawayId,
        includeArchived: query.includeArchived,
        includeNonProduction,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid task list query", error.flatten());
    }
    return handleRouteError(error, "tasks:get");
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createTaskSchema.parse(await req.json());
    return NextResponse.json(createTask(parsed), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid create task payload", error.flatten());
    }
    return handleRouteError(error, "tasks:post");
  }
}
