import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { generateKnowledgeMapNotes } from "@/lib/orchestration/memory-vault";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null, fallback: number): number {
  const raw = Number(value ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 2000) : fallback;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    return NextResponse.json(generateKnowledgeMapNotes(slug, {
      apply: false,
      limit: parseLimit(request.nextUrl.searchParams.get("limit"), 1000),
    }));
  } catch (error) {
    return handleRouteError(error, "memory.maps:get");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => null) as { apply?: boolean; limit?: number } | null;
    const limit = typeof body?.limit === "number" ? Math.min(Math.max(Math.floor(body.limit), 1), 2000) : 1000;
    return NextResponse.json(generateKnowledgeMapNotes(slug, {
      apply: body?.apply !== false,
      limit,
    }));
  } catch (error) {
    return handleRouteError(error, "memory.maps:post");
  }
}
