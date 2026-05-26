import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  createAvailableModelSchema,
  listAvailableModelsQuerySchema,
} from "@/lib/orchestration/contracts";
import { createAvailableModel, listAvailableModels } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const query = listAvailableModelsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    return NextResponse.json({ models: listAvailableModels(query) });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid available model query", error.flatten());
    }
    return handleRouteError(error, "available-models:list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await req.json() : {};
    const parsed = createAvailableModelSchema.parse(payload);
    return NextResponse.json({ model: createAvailableModel(parsed) }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid available model payload", error.flatten());
    }
    return handleRouteError(error, "available-models:create");
  }
}
