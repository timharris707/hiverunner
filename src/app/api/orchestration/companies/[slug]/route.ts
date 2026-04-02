import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateCompanySchema } from "@/lib/orchestration/contracts";
import { archiveCompany, getCompany, updateCompany } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    return NextResponse.json(getCompany(slug));
  } catch (error) {
    return handleRouteError(error, "company:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = updateCompanySchema.parse(await req.json());
    return NextResponse.json(
      updateCompany({
        companySlug: slug,
        name: parsed.name,
        slug: parsed.slug,
        description: parsed.description,
        status: parsed.status,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid update company payload", error.flatten());
    }
    return handleRouteError(error, "company:patch");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    return NextResponse.json(archiveCompany(slug));
  } catch (error) {
    return handleRouteError(error, "company:delete");
  }
}
