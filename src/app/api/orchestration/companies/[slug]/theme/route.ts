import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateCompanyThemeSchema } from "@/lib/orchestration/contracts";
import { getCompanyTheme, resetCompanyTheme, updateCompanyTheme } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    return NextResponse.json(getCompanyTheme(slug));
  } catch (error) {
    return handleRouteError(error, "company-theme:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = updateCompanyThemeSchema.parse(await req.json());
    return NextResponse.json(updateCompanyTheme({ companySlug: slug, ...parsed }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company theme payload", error.flatten());
    }
    return handleRouteError(error, "company-theme:patch");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    return NextResponse.json(resetCompanyTheme(slug));
  } catch (error) {
    return handleRouteError(error, "company-theme:delete");
  }
}
