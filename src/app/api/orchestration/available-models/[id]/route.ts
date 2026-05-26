import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateAvailableModelSchema } from "@/lib/orchestration/contracts";
import { deleteAvailableModel, updateAvailableModel } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const contentType = req.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await req.json() : {};
    const parsed = updateAvailableModelSchema.parse(payload);
    return NextResponse.json({ model: updateAvailableModel(id, parsed) });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid available model payload", error.flatten());
    }
    return handleRouteError(error, "available-models:update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json({ model: deleteAvailableModel(id) });
  } catch (error) {
    return handleRouteError(error, "available-models:delete");
  }
}
