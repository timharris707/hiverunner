import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getCompanyMemorySettings } from "@/lib/orchestration/memory-vault";
import {
  listWikiWritebackRequests,
} from "@/lib/orchestration/wiki-writeback-requests";
import {
  prepareWikiMarkdownWriteback,
} from "@/lib/orchestration/wiki-writeback-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const approvalState = request.nextUrl.searchParams.get("approvalState") ?? undefined;
    const validStates = new Set(["requested", "approved", "rejected", "written", "failed", "rolled_back", "all"]);
    if (approvalState && !validStates.has(approvalState)) {
      return errorResponse(
        400,
        "invalid_approval_state",
        "approvalState must be requested, approved, rejected, written, failed, rolled_back, or all",
      );
    }

    const requests = listWikiWritebackRequests(slug, {
      approvalState: approvalState as "all" | "requested" | "approved" | "rejected" | "written" | "failed" | "rolled_back" | undefined,
    }).reverse();
    return NextResponse.json({ requests });
  } catch (error) {
    return handleRouteError(error, "wiki.writeback:get");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }

    const targetPath = typeof body.targetPath === "string" ? body.targetPath.trim() : "";
    if (!targetPath) {
      return errorResponse(400, "missing_target_path", "targetPath is required");
    }

    const sourceMemoryIds = Array.isArray(body.sourceMemoryIds)
      ? body.sourceMemoryIds.map((entry) => String(entry).trim()).filter(Boolean)
      : undefined;
    if (!sourceMemoryIds || sourceMemoryIds.length === 0) {
      return errorResponse(400, "missing_source_memory_ids", "sourceMemoryIds must include at least one memory record id");
    }

    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!idempotencyKey) {
      return errorResponse(400, "missing_idempotency_key", "idempotencyKey is required");
    }

    const curationActionIds = Array.isArray(body.curationActionIds)
      ? body.curationActionIds.map((entry) => String(entry).trim()).filter(Boolean)
      : undefined;
    const requestedBy = typeof body.requestedBy === "string" ? body.requestedBy.trim() : undefined;

    const { company } = getCompanyMemorySettings(slug, { persistDefaults: true });
    const preview = await prepareWikiMarkdownWriteback(company.slug, {
      targetPath,
      sourceMemoryIds,
      curationActionIds,
      idempotencyKey,
      requestedBy,
    });

    return NextResponse.json(preview, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "wiki.writeback:post");
  }
}
