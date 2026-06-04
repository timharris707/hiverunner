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
import { invalidQueryValueResponse, normalizeQueryParam, readRequiredJsonBody } from "../route-helpers";

export const dynamic = "force-dynamic";

const MEMORY_STATUSES: readonly (CompanyMemoryStatus | "all")[] = ["all", "draft", "active", "rejected", "archived"];
const MEMORY_KINDS: readonly CompanyMemoryKind[] = [
  "fact",
  "decision",
  "preference",
  "architecture",
  "domain_constraint",
  "workflow_note",
  "skill_evidence",
];
const MEMORY_SCOPES: readonly CompanyMemoryScope[] = ["company", "project", "agent"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const status = normalizeQueryParam(request.nextUrl.searchParams, "status", MEMORY_STATUSES);
    const kind = normalizeQueryParam(request.nextUrl.searchParams, "kind", MEMORY_KINDS);
    const scope = normalizeQueryParam(request.nextUrl.searchParams, "scope", MEMORY_SCOPES);
    const statusError = invalidQueryValueResponse(status, "invalid_status", "status must be draft, active, rejected, archived, or all");
    if (statusError) return statusError;
    const kindError = invalidQueryValueResponse(kind, "invalid_kind", "kind is not a supported memory kind");
    if (kindError) return kindError;
    const scopeError = invalidQueryValueResponse(scope, "invalid_scope", "scope must be company, project, or agent");
    if (scopeError) return scopeError;

    return NextResponse.json(listCompanyMemoryRecords(slug, {
      status: status.value,
      kind: kind.value,
      scope: scope.value,
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
    const bodyResult = await readRequiredJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const { body } = bodyResult;

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
    const bodyResult = await readRequiredJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const { body } = bodyResult;

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
