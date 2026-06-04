import type { NextRequest } from "next/server";
import { ZodError } from "zod";

import { errorResponse } from "@/lib/orchestration/api";

export type ExecutionHiveRouteContext = {
  params: Promise<{ slug: string; hiveId: string }>;
};

async function readExecutionHiveRoutePayload(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? await req.json() : {};
}

export async function readExecutionHiveRouteInput(
  req: NextRequest,
  { params }: ExecutionHiveRouteContext,
) {
  const { slug, hiveId } = await params;
  const payload = await readExecutionHiveRoutePayload(req);
  return { slug, hiveId, payload };
}

export function executionHiveValidationErrorResponse(error: unknown, message: string) {
  if (!(error instanceof ZodError)) {
    return null;
  }

  return errorResponse(400, "validation_error", message, error.flatten());
}
