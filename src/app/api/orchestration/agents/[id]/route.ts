import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { fireCompanyAgentSchema } from "@/lib/orchestration/contracts";
import { fireCompanyAgent } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

async function readJsonBody(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntaxError("invalid_json_body");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await readJsonBody(req);
    const parsed = fireCompanyAgentSchema.parse(body);
    const result = fireCompanyAgent({
      agentId: id,
      replacementAgentId: parsed.replacementAgentId,
      replacementFallback: parsed.replacementFallback,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid fire-agent payload", error.flatten());
    }
    if (error instanceof SyntaxError && error.message === "invalid_json_body") {
      return errorResponse(400, "invalid_json", "Request body must be valid JSON");
    }
    return handleRouteError(error, "agent:fire");
  }
}
