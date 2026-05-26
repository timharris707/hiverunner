import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  createCompanyGoalSchema,
  deleteCompanyGoalSchema,
  listCompanyGoalsQuerySchema,
  updateCompanyGoalSchema,
} from "@/lib/orchestration/contracts";
import {
  createCompanyGoal,
  deleteCompanyGoal,
  listCompanyGoals,
  updateCompanyGoal,
} from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const query = listCompanyGoalsQuerySchema.parse({
      projectId: req.nextUrl.searchParams.get("projectId") ?? undefined,
      status: req.nextUrl.searchParams.get("status") ?? undefined,
      includeCompleted: req.nextUrl.searchParams.get("includeCompleted") ?? undefined,
    });

    return NextResponse.json(
      listCompanyGoals({
        companyIdOrSlug: slug,
        projectId: query.projectId,
        status: query.status,
        includeCompleted: query.includeCompleted,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company goals query", error.flatten());
    }
    return handleRouteError(error, "company-goals:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = createCompanyGoalSchema.parse(await req.json());
    return NextResponse.json(
      createCompanyGoal({
        companyIdOrSlug: slug,
        projectId: parsed.projectId,
        name: parsed.name,
        goal: parsed.goal,
        goalKind: parsed.goalKind,
        status: parsed.status,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        parentId: parsed.parentId,
        owner: parsed.owner,
        leadAgentId: parsed.leadAgentId,
        stopCondition: parsed.stopCondition,
        progressSummary: parsed.progressSummary,
        defaultExecutionEngine: parsed.defaultExecutionEngine,
        defaultModelLane: parsed.defaultModelLane,
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company goal create payload", error.flatten());
    }
    return handleRouteError(error, "company-goals:post");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = updateCompanyGoalSchema.parse(await req.json());
    return NextResponse.json(
      updateCompanyGoal({
        companyIdOrSlug: slug,
        sprintId: parsed.sprintId,
        name: parsed.name,
        goal: parsed.goal,
        goalKind: parsed.goalKind,
        status: parsed.status,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        parentId: parsed.parentId,
        owner: parsed.owner,
        leadAgentId: parsed.leadAgentId,
        stopCondition: parsed.stopCondition,
        progressSummary: parsed.progressSummary,
        defaultExecutionEngine: parsed.defaultExecutionEngine,
        defaultModelLane: parsed.defaultModelLane,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company goal update payload", error.flatten());
    }
    return handleRouteError(error, "company-goals:patch");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = deleteCompanyGoalSchema.parse(await req.json());
    return NextResponse.json(
      deleteCompanyGoal({
        companyIdOrSlug: slug,
        sprintId: parsed.sprintId,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company goal delete payload", error.flatten());
    }
    return handleRouteError(error, "company-goals:delete");
  }
}
