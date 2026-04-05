import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listApprovals, createApproval } from "@/lib/orchestration/service/approval";

export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
  status: z.enum(["pending", "revision_requested", "approved", "rejected", "cancelled"]).optional(),
  type: z.enum(["hire_agent", "approve_ceo_strategy", "budget_override_required"]).optional(),
});

const createSchema = z.object({
  type: z.enum(["hire_agent", "approve_ceo_strategy", "budget_override_required"]),
  requestedByAgentId: z.string().trim().min(1).optional(),
  payload: z.record(z.unknown()).optional(),
  linkedTaskId: z.string().trim().min(1).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const query = listQuerySchema.parse({
      status: req.nextUrl.searchParams.get("status") ?? undefined,
      type: req.nextUrl.searchParams.get("type") ?? undefined,
    });
    return NextResponse.json(listApprovals({ companyIdOrSlug: slug, ...query }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid approvals query", error.flatten());
    }
    return handleRouteError(error, "company-approvals:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = createSchema.parse(await req.json());
    return NextResponse.json(
      createApproval({ companyIdOrSlug: slug, ...parsed }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid approval create payload", error.flatten());
    }
    return handleRouteError(error, "company-approvals:post");
  }
}
