import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { createGoalContractItemSchema, updateGoalContractItemSchema } from "@/lib/orchestration/contracts";
import { createGoalContractItem, updateGoalContractItem } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = createGoalContractItemSchema.parse(await req.json());
    return NextResponse.json(
      createGoalContractItem({
        companyIdOrSlug: slug,
        sprintId: parsed.sprintId,
        kind: parsed.kind,
        text: parsed.text,
        position: parsed.position,
        actorAgentId: parsed.actorAgentId,
        actorUserId: parsed.actorUserId,
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid goal contract item payload", error.flatten());
    }
    return handleRouteError(error, "company-goals-contract:post");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = updateGoalContractItemSchema.parse(await req.json());
    return NextResponse.json(
      updateGoalContractItem({
        companyIdOrSlug: slug,
        itemId: parsed.itemId,
        text: parsed.text,
        position: parsed.position,
        archived: parsed.archived,
        actorAgentId: parsed.actorAgentId,
        actorUserId: parsed.actorUserId,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid goal contract item payload", error.flatten());
    }
    return handleRouteError(error, "company-goals-contract:patch");
  }
}
