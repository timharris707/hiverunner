import { NextRequest, NextResponse } from "next/server";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  listModelSourceCredentials,
  saveModelSourceCredential,
} from "@/lib/orchestration/model-source-credentials";
import { saveCompanyModelSourceCredentialSchema } from "@/lib/orchestration/contracts";
import { resolveCompanyId } from "@/lib/orchestration/service/shared";

export const dynamic = "force-dynamic";

function assertCompanyExists(slug: string): void {
  const companyId = resolveCompanyId(getOrchestrationDb(), slug);
  if (!companyId) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    assertCompanyExists(slug);
    return NextResponse.json({ modelSources: listModelSourceCredentials() });
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[company-model-sources:get] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    assertCompanyExists(slug);
    const parsed = saveCompanyModelSourceCredentialSchema.parse(await req.json());
    const modelSource = saveModelSourceCredential(parsed);
    return NextResponse.json({ modelSource, modelSources: listModelSourceCredentials() });
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[company-model-sources:post] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
