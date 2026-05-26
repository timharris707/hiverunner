import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { createProjectAgentSchema } from "@/lib/orchestration/contracts";
import { createProjectAgent, listProjectAgents } from "@/lib/orchestration/service";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(listProjectAgents(id));
  } catch (error) {
    return handleRouteError(error, "project-agents:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = createProjectAgentSchema.parse(await req.json());
    return NextResponse.json(createProjectAgent({ ...parsed, projectId: id }), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid create agent payload", error.flatten());
    }
    return handleRouteError(error, "project-agents:post");
  }
}
