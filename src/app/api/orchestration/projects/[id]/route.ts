import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateProjectSettingsSchema } from "@/lib/orchestration/contracts";
import { archiveProject, getProject, updateProjectSettings } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(getProject(id));
  } catch (error) {
    return handleRouteError(error, "project:get");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(archiveProject(id));
  } catch (error) {
    return handleRouteError(error, "project:delete");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = updateProjectSettingsSchema.parse(await req.json());
    return NextResponse.json(
      updateProjectSettings({
        projectIdOrSlug: id,
        emoji: parsed.emoji,
        staleAlertThresholdsHours: parsed.staleAlertThresholdsHours,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid project settings payload", error.flatten());
    }
    return handleRouteError(error, "project:patch");
  }
}
