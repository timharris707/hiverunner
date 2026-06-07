import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  listEvalCases,
  type EvalCaseLibraryFilters,
  type EvalCaseReviewOutcome,
} from "@/lib/orchestration/eval-cases";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export const dynamic = "force-dynamic";

const REVIEW_OUTCOMES = new Set<EvalCaseReviewOutcome>(["accepted", "returned", "rejected", "blocked"]);

function textParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value || undefined;
}

function reviewOutcomeParam(searchParams: URLSearchParams): EvalCaseReviewOutcome | undefined {
  const raw = textParam(searchParams, "reviewOutcome") ?? textParam(searchParams, "outcome");
  if (!raw) return undefined;
  return REVIEW_OUTCOMES.has(raw as EvalCaseReviewOutcome) ? raw as EvalCaseReviewOutcome : undefined;
}

function limitParam(searchParams: URLSearchParams): number | undefined {
  if (!searchParams.has("limit")) return undefined;
  const value = Number(searchParams.get("limit"));
  return Number.isFinite(value) ? value : undefined;
}

function libraryFilters(searchParams: URLSearchParams): EvalCaseLibraryFilters {
  return {
    projectId: textParam(searchParams, "projectId") ?? textParam(searchParams, "project"),
    taskType: textParam(searchParams, "taskType") ?? textParam(searchParams, "type"),
    template: textParam(searchParams, "template"),
    agent: textParam(searchParams, "agent"),
    runner: textParam(searchParams, "runner"),
    model: textParam(searchParams, "model"),
    reviewOutcome: reviewOutcomeParam(searchParams),
    tag: textParam(searchParams, "tag"),
    dateFrom: textParam(searchParams, "dateFrom"),
    dateTo: textParam(searchParams, "dateTo"),
    limit: limitParam(searchParams),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();
    const company = resolveCompanyIdBySlug(slug, db);
    if (!company) {
      return errorResponse(404, "company_not_found", "Company not found");
    }

    return NextResponse.json(
      listEvalCases(company.id, libraryFilters(req.nextUrl.searchParams), db),
    );
  } catch (error) {
    return handleRouteError(error, "company-evals:get");
  }
}
