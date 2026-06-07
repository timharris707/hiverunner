import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  listImproveRecommendations,
} from "@/lib/orchestration/improvement-recommendations";
import type {
  ImprovementRecommendationConfidence,
  ImprovementRecommendationScopeType,
  ImprovementRecommendationSeverity,
  ImprovementRecommendationSourceType,
  ImprovementRecommendationStatus,
  OrchestrationImprovementRecommendationFilters,
} from "@/lib/orchestration/types";

export const dynamic = "force-dynamic";

const STATUS_VALUES = new Set<ImprovementRecommendationStatus>([
  "suggested",
  "needs-more-evidence",
  "accepted-for-approval",
  "dismissed",
  "superseded",
  "applied",
]);
const SEVERITY_VALUES = new Set<ImprovementRecommendationSeverity>(["low", "medium", "high", "critical"]);
const CONFIDENCE_VALUES = new Set<ImprovementRecommendationConfidence>(["low", "medium", "high"]);
const SOURCE_TYPE_VALUES = new Set<ImprovementRecommendationSourceType>([
  "trace",
  "eval",
  "template",
  "team",
  "task",
  "sprint",
  "goal",
  "review",
  "manual",
]);
const SCOPE_TYPE_VALUES = new Set<ImprovementRecommendationScopeType>([
  "company",
  "project",
  "template",
  "task_type",
  "agent",
  "runner",
  "recommendation",
]);
const GROUP_BY_VALUES = new Set<NonNullable<OrchestrationImprovementRecommendationFilters["groupBy"]>>([
  "status",
  "severity",
  "confidence",
  "category",
  "trigger",
  "scope",
  "source",
]);

function textParam(searchParams: URLSearchParams, key: string): string | undefined {
  return searchParams.get(key)?.trim() || undefined;
}

function csvValues(searchParams: URLSearchParams, key: string): string[] {
  return searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function typedValues<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  values: Set<T>,
): T[] | undefined {
  const raw = csvValues(searchParams, key);
  if (raw.length === 0) return undefined;
  const normalized: T[] = [];
  for (const item of raw) {
    if (!values.has(item as T)) {
      throw new Error(`invalid:${key}`);
    }
    normalized.push(item as T);
  }
  return normalized;
}

function booleanParam(searchParams: URLSearchParams, key: string): boolean | undefined {
  const raw = textParam(searchParams, key)?.toLowerCase();
  if (!raw) return undefined;
  if (["1", "true", "yes"].includes(raw)) return true;
  if (["0", "false", "no"].includes(raw)) return false;
  throw new Error(`invalid:${key}`);
}

function numberParam(searchParams: URLSearchParams, key: string): number | undefined {
  const raw = textParam(searchParams, key);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid:${key}`);
  return value;
}

function filtersFromSearchParams(searchParams: URLSearchParams): OrchestrationImprovementRecommendationFilters {
  const evidenceState = textParam(searchParams, "evidenceState") ?? textParam(searchParams, "evidence");
  if (evidenceState && evidenceState !== "present" && evidenceState !== "missing") {
    throw new Error("invalid:evidenceState");
  }
  const scopeType = textParam(searchParams, "scopeType");
  if (scopeType && !SCOPE_TYPE_VALUES.has(scopeType as ImprovementRecommendationScopeType)) {
    throw new Error("invalid:scopeType");
  }
  const groupBy = textParam(searchParams, "groupBy");
  if (groupBy && !GROUP_BY_VALUES.has(groupBy as NonNullable<OrchestrationImprovementRecommendationFilters["groupBy"]>)) {
    throw new Error("invalid:groupBy");
  }

  return {
    status: typedValues(searchParams, "status", STATUS_VALUES),
    severity: typedValues(searchParams, "severity", SEVERITY_VALUES),
    confidence: typedValues(searchParams, "confidence", CONFIDENCE_VALUES),
    sourceType: typedValues(searchParams, "sourceType", SOURCE_TYPE_VALUES),
    triggerKey: textParam(searchParams, "triggerKey") ?? textParam(searchParams, "trigger"),
    category: textParam(searchParams, "category"),
    scopeType: scopeType as ImprovementRecommendationScopeType | undefined,
    scopeKey: textParam(searchParams, "scopeKey"),
    projectId: textParam(searchParams, "projectId") ?? textParam(searchParams, "project"),
    agentId: textParam(searchParams, "agentId") ?? textParam(searchParams, "agent"),
    search: textParam(searchParams, "search") ?? textParam(searchParams, "q"),
    evidenceState: evidenceState as "present" | "missing" | undefined,
    includeSuppressed: booleanParam(searchParams, "includeSuppressed"),
    groupBy: groupBy as OrchestrationImprovementRecommendationFilters["groupBy"],
    limit: numberParam(searchParams, "limit"),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    return NextResponse.json(listImproveRecommendations(slug, filtersFromSearchParams(req.nextUrl.searchParams)));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid:")) {
      return errorResponse(400, "validation_error", "Invalid Improve recommendations query", {
        field: error.message.slice("invalid:".length),
      });
    }
    return handleRouteError(error, "improve.recommendations:get");
  }
}
