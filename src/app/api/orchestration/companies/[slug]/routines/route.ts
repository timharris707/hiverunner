import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  createRoutineSchema,
  listRoutinesQuerySchema,
} from "@/lib/orchestration/contracts";
import {
  listRoutines,
  createRoutine,
} from "@/lib/orchestration/service/routine";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const query = listRoutinesQuerySchema.parse({
      projectId: req.nextUrl.searchParams.get("projectId") ?? undefined,
      status: req.nextUrl.searchParams.get("status") ?? undefined,
    });

    return NextResponse.json(
      listRoutines({
        companyIdOrSlug: slug,
        projectId: query.projectId,
        status: query.status,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid routines query", error.flatten());
    }
    return handleRouteError(error, "company-routines:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = createRoutineSchema.parse(await req.json());
    return NextResponse.json(
      createRoutine({
        companyIdOrSlug: slug,
        title: parsed.title,
        description: parsed.description,
        projectId: parsed.projectId,
        assigneeAgentId: parsed.assigneeAgentId,
        priority: parsed.priority,
        concurrencyPolicy: parsed.concurrencyPolicy,
        catchUpPolicy: parsed.catchUpPolicy,
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid routine create payload", error.flatten());
    }
    return handleRouteError(error, "company-routines:post");
  }
}
