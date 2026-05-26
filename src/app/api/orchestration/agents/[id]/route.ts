import { after, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { fireCompanyAgentSchema } from "@/lib/orchestration/contracts";
import { archiveCompanyAgent, hardDeleteCompanyAgent } from "@/lib/orchestration/service";
import { cleanupDeletedCompanyOpenClawAgents } from "@/lib/orchestration/company-service";

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
    const hard = req.nextUrl.searchParams.get("hard") === "true";

    if (hard) {
      const result = hardDeleteCompanyAgent({
        agentId: id,
        replacementAgentId: parsed.replacementAgentId,
        replacementFallback: parsed.replacementFallback,
      });
      after(async () => {
        try {
          await cleanupDeletedCompanyOpenClawAgents(result.openclawAgents.queued);
        } catch (cleanupError) {
          console.error("[agent:delete] OpenClaw cleanup failed:", cleanupError);
        }
      });
      return NextResponse.json({ success: true, deleted: true, agent: result });
    }

    const result = archiveCompanyAgent({
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
