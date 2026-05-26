import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { createCompanySchema, listCompaniesQuerySchema } from "@/lib/orchestration/contracts";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { createCompany, listCompanies } from "@/lib/orchestration/company-service";
import { resolveRequestCompanyOwnerUserId } from "@/lib/orchestration/request-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const query = listCompaniesQuerySchema.parse({
      includeArchived: req.nextUrl.searchParams.get("includeArchived") ?? undefined,
      includeNonProduction: req.nextUrl.searchParams.get("includeNonProduction") ?? undefined,
    });
    const ownerUserId = await resolveRequestCompanyOwnerUserId(req);
    return NextResponse.json(listCompanies({ ...query, ownerUserId }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company list query", error.flatten());
    }
    return handleRouteError(error, "companies:get");
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createCompanySchema.parse(await req.json());
    return NextResponse.json(createCompany(parsed), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid create company payload", error.flatten());
    }
    return handleRouteError(error, "companies:post");
  }
}
