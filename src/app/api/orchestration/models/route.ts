import { NextResponse } from "next/server";

import { COMPANY_WIZARD_MODEL_FALLBACK } from "@/lib/orchestration/company-wizard";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    models: COMPANY_WIZARD_MODEL_FALLBACK,
    source: "hiverunner",
    count: COMPANY_WIZARD_MODEL_FALLBACK.length,
  });
}
