import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateRoutineSchema } from "@/lib/orchestration/contracts";
import { getRoutine, getRoutineDetail, updateRoutine, runRoutine } from "@/lib/orchestration/service/routine";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const detail = req.nextUrl.searchParams.get("detail") === "true";
    return NextResponse.json(detail ? getRoutineDetail(id) : getRoutine(id));
  } catch (error) {
    return handleRouteError(error, "routine:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = updateRoutineSchema.parse(await req.json());
    return NextResponse.json(
      updateRoutine({
        routineId: id,
        ...parsed,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid routine update payload", error.flatten());
    }
    return handleRouteError(error, "routine:patch");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body?.action === "run") {
      return NextResponse.json(runRoutine(id), { status: 201 });
    }
    return errorResponse(400, "invalid_action", "Unknown action");
  } catch (error) {
    return handleRouteError(error, "routine:post");
  }
}
