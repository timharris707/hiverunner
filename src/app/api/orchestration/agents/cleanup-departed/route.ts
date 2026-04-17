import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { cleanupDepartedAgentSchema } from "@/lib/orchestration/contracts";
import { cleanupDepartedAgentReferences } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = cleanupDepartedAgentSchema.parse(body);
    const result = cleanupDepartedAgentReferences(parsed);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "validation_error",
        "Invalid cleanup-departed payload",
        error.flatten()
      );
    }
    return handleRouteError(error, "agent:cleanup-departed");
  }
}
