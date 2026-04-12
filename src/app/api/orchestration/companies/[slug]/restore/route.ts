import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { restoreCompany } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    return NextResponse.json(restoreCompany(slug));
  } catch (error) {
    return handleRouteError(error, "company:restore");
  }
}
