import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { recordGoalContractEvidenceSchema } from "@/lib/orchestration/contracts";
import { recordGoalContractEvidence } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = recordGoalContractEvidenceSchema.parse(await req.json());
    return NextResponse.json(
      recordGoalContractEvidence({
        companyIdOrSlug: slug,
        itemId: parsed.itemId,
        status: parsed.status,
        resultText: parsed.resultText,
        commandExitCode: parsed.commandExitCode,
        artifactUri: parsed.artifactUri,
        actorAgentId: parsed.actorAgentId,
        actorUserId: parsed.actorUserId,
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid goal evidence payload", error.flatten());
    }
    return handleRouteError(error, "company-goals-evidence:post");
  }
}
