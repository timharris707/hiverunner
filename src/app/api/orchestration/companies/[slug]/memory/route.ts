import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  createCompanyMemoryRecord,
  listCompanyMemoryRecords,
  updateCompanyMemoryRecord,
  type CompanyMemoryKind,
  type CompanyMemoryScope,
  type CompanyMemoryStatus,
} from "@/lib/orchestration/company-memory";

export const dynamic = "force-dynamic";

function parseStatus(value: string | null): CompanyMemoryStatus | "all" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "all" || normalized === "draft" || normalized === "active" || normalized === "rejected" || normalized === "archived") {
    return normalized;
  }
  return undefined;
}

function parseKind(value: string | null): CompanyMemoryKind | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "fact" ||
    normalized === "decision" ||
    normalized === "preference" ||
    normalized === "architecture" ||
    normalized === "domain_constraint" ||
    normalized === "workflow_note" ||
    normalized === "skill_evidence"
  ) {
    return normalized;
  }
  return undefined;
}

function parseScope(value: string | null): CompanyMemoryScope | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "company" || normalized === "project" || normalized === "agent") {
    return normalized;
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const statusParam = request.nextUrl.searchParams.get("status");
    const kindParam = request.nextUrl.searchParams.get("kind");
    const scopeParam = request.nextUrl.searchParams.get("scope");
    const status = parseStatus(statusParam);
    const kind = parseKind(kindParam);
    const scope = parseScope(scopeParam);
    if (statusParam && !status) {
      return errorResponse(400, "invalid_status", "status must be draft, active, rejected, archived, or all");
    }
    if (kindParam && !kind) {
      return errorResponse(400, "invalid_kind", "kind is not a supported memory kind");
    }
    if (scopeParam && !scope) {
      return errorResponse(400, "invalid_scope", "scope must be company, project, or agent");
    }

    return NextResponse.json(listCompanyMemoryRecords(slug, {
      status,
      kind,
      scope,
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      agentId: request.nextUrl.searchParams.get("agentId") ?? undefined,
      includeArchived: request.nextUrl.searchParams.get("includeArchived") === "true",
    }));
  } catch (error) {
    return handleRouteError(error, "company.memory:get");
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

    return NextResponse.json(
      createCompanyMemoryRecord(slug, {
        title: typeof body.title === "string" ? body.title : "",
        body: typeof body.body === "string" ? body.body : undefined,
        slug: typeof body.slug === "string" ? body.slug : undefined,
        kind: typeof body.kind === "string" ? body.kind as never : undefined,
        scope: typeof body.scope === "string" ? body.scope as never : undefined,
        status: typeof body.status === "string" ? body.status as never : undefined,
        source: typeof body.source === "string" ? body.source as never : undefined,
        confidence: typeof body.confidence === "number" ? body.confidence : undefined,
        projectId:
          typeof body.projectId === "string" || body.projectId === null
            ? body.projectId
            : undefined,
        agentId:
          typeof body.agentId === "string" || body.agentId === null
            ? body.agentId
            : undefined,
        taskId:
          typeof body.taskId === "string" || body.taskId === null
            ? body.taskId
            : undefined,
        executionRunId:
          typeof body.executionRunId === "string" || body.executionRunId === null
            ? body.executionRunId
            : undefined,
        reviewRequired: typeof body.reviewRequired === "boolean" ? body.reviewRequired : undefined,
        reviewState: typeof body.reviewState === "string" ? body.reviewState as never : undefined,
        reviewedByAgentId:
          typeof body.reviewedByAgentId === "string" || body.reviewedByAgentId === null
            ? body.reviewedByAgentId
            : undefined,
        metadata:
          typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : undefined,
      }),
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "company.memory:post");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }

    const memoryId = typeof body.id === "string"
      ? body.id
      : typeof body.memoryId === "string"
        ? body.memoryId
        : typeof body.slug === "string"
          ? body.slug
          : "";
    if (!memoryId) {
      return errorResponse(400, "missing_memory_id", "PATCH requires id, memoryId, or slug");
    }

    return NextResponse.json(
      updateCompanyMemoryRecord(slug, memoryId, {
        title: typeof body.title === "string" ? body.title : undefined,
        body: typeof body.body === "string" ? body.body : undefined,
        kind: typeof body.kind === "string" ? body.kind as never : undefined,
        scope: typeof body.scope === "string" ? body.scope as never : undefined,
        status: typeof body.status === "string" ? body.status as never : undefined,
        source: typeof body.source === "string" ? body.source as never : undefined,
        confidence: typeof body.confidence === "number" ? body.confidence : undefined,
        projectId:
          typeof body.projectId === "string" || body.projectId === null
            ? body.projectId
            : undefined,
        agentId:
          typeof body.agentId === "string" || body.agentId === null
            ? body.agentId
            : undefined,
        taskId:
          typeof body.taskId === "string" || body.taskId === null
            ? body.taskId
            : undefined,
        executionRunId:
          typeof body.executionRunId === "string" || body.executionRunId === null
            ? body.executionRunId
            : undefined,
        reviewRequired: typeof body.reviewRequired === "boolean" ? body.reviewRequired : undefined,
        reviewState: typeof body.reviewState === "string" ? body.reviewState as never : undefined,
        reviewedByAgentId:
          typeof body.reviewedByAgentId === "string" || body.reviewedByAgentId === null
            ? body.reviewedByAgentId
            : undefined,
        metadata:
          typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : undefined,
      }),
    );
  } catch (error) {
    return handleRouteError(error, "company.memory:patch");
  }
}
