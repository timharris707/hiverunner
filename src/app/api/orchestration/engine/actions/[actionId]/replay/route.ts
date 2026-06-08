import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { replayRuntimeActionLedgerEntry } from "@/lib/orchestration/runtime-action-ledger-replay";

const replayActionSchema = z.object({
  dryRun: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = replayActionSchema.parse(body);
    const result = await replayRuntimeActionLedgerEntry({
      actionLedgerId: actionId,
      dryRun: parsed.dryRun,
    });
    return NextResponse.json({ replay: result });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid action replay payload", error.flatten());
    }
    return handleRouteError(error, "runtime-action-ledger-replay:post");
  }
}
