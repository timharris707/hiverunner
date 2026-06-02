import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { buildRawOverseerTranscriptExport } from "@/lib/orchestration/overseer/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const result = buildRawOverseerTranscriptExport({ companyIdOrSlug: slug, sessionId });
    return NextResponse.json(result.package, {
      headers: {
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-HiveRunner-Content-Sha256": result.package.contentHashes.payloadSha256,
      },
    });
  } catch (error) {
    return handleRouteError(error, "overseer-session-export:get");
  }
}
