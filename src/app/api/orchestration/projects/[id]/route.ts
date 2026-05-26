import { after, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateProjectSettingsSchema } from "@/lib/orchestration/contracts";
import {
  archiveProject,
  cleanupDeletedProjectOpenClawAgents,
  getProject,
  hardDeleteProject,
  updateProjectSettings,
} from "@/lib/orchestration/service";

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
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const hard = req.nextUrl.searchParams.get("hard") === "true";

    if (hard) {
      const result = hardDeleteProject(id);
      after(async () => {
        try {
          await cleanupDeletedProjectOpenClawAgents(result.openclawAgents.queued);
        } catch (cleanupError) {
          console.error("[project:delete] OpenClaw cleanup failed:", cleanupError);
        }
      });
      return NextResponse.json({ success: true, deleted: true, project: result });
    }

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
        name: parsed.name,
        slug: parsed.slug,
        emoji: parsed.emoji,
        color: parsed.color,
        status: parsed.status,
        defaultExecutionEngine: parsed.defaultExecutionEngine,
        sourceWorkspaceRoot: parsed.sourceWorkspaceRoot,
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
