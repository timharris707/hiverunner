import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  createExperimentDraft,
  listExperiments,
  type ExperimentLifecycleStatus,
} from "@/lib/orchestration/experiments";

export const dynamic = "force-dynamic";

const sourceKindSchema = z.enum(["eval_case", "run_trace"]);
const objectiveSchema = z.enum(["reduce_review_returns", "improve_acceptance", "reduce_cost", "shorten_runtime"]);
const workspaceModeSchema = z.enum(["snapshot", "branch", "live"]);
const changeTypeSchema = z.enum([
  "runner_model",
  "agent",
  "prompt",
  "tool_setup",
  "task_decomposition",
  "template_slot",
  "context_package",
  "other",
]);

const experimentStatusSchema = z.enum([
  "draft",
  "awaiting_variant_approval",
  "approved",
  "running",
  "reporting",
  "completed",
  "cancelled",
  "failed",
  "archived",
]);

const createExperimentSchema = z.object({
  id: z.string().trim().min(1).optional(),
  source: z.object({
    kind: sourceKindSchema,
    id: z.string().trim().min(1),
  }),
  objective: objectiveSchema,
  definitionOfBetter: z.string().max(5000).nullable().optional(),
  hypothesis: z.string().max(5000).nullable().optional(),
  workspaceMode: workspaceModeSchema.nullable().optional(),
  liveWorkspaceConfirmed: z.boolean().optional(),
  liveWorkspaceReason: z.string().max(1000).nullable().optional(),
  limits: z.object({
    variantCap: z.number().int().optional(),
    attemptLimit: z.number().int().optional(),
    timeboxMinutes: z.number().int().optional(),
  }).nullable().optional(),
  variants: z.array(z.object({
    id: z.string().trim().min(1).optional(),
    key: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    description: z.string().max(5000).nullable().optional(),
    changeType: changeTypeSchema.optional(),
    plannedChange: z.record(z.string(), z.unknown()).nullable().optional(),
    proposedByAgentId: z.string().trim().min(1).nullable().optional(),
    proposedByUserId: z.string().trim().min(1).nullable().optional(),
  })).optional(),
  idempotencyKey: z.string().trim().min(1).nullable().optional(),
  createdByAgentId: z.string().trim().min(1).nullable().optional(),
  createdByUserId: z.string().trim().min(1).nullable().optional(),
});

function textParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value || undefined;
}

function limitParam(searchParams: URLSearchParams): number | undefined {
  if (!searchParams.has("limit")) return undefined;
  const value = Number(searchParams.get("limit"));
  return Number.isFinite(value) ? value : undefined;
}

function statusParam(searchParams: URLSearchParams): ExperimentLifecycleStatus[] | undefined {
  const raw = textParam(searchParams, "status");
  if (!raw) return undefined;
  const statuses = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ExperimentLifecycleStatus => experimentStatusSchema.safeParse(value).success);
  return statuses.length > 0 ? statuses : undefined;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const sourceKind = textParam(req.nextUrl.searchParams, "sourceKind");
    const db = getOrchestrationDb();
    return NextResponse.json({
      experiments: listExperiments(slug, {
        status: statusParam(req.nextUrl.searchParams),
        sourceKind: sourceKindSchema.safeParse(sourceKind).success ? sourceKind as "eval_case" | "run_trace" : undefined,
        sourceRunId: textParam(req.nextUrl.searchParams, "sourceRunId"),
        sourceEvalCaseId: textParam(req.nextUrl.searchParams, "sourceEvalCaseId"),
        sourceTaskId: textParam(req.nextUrl.searchParams, "sourceTaskId"),
        limit: limitParam(req.nextUrl.searchParams),
      }, db),
    });
  } catch (error) {
    return handleRouteError(error, "company-experiments:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const parsed = createExperimentSchema.parse(await req.json());
    const db = getOrchestrationDb();
    return NextResponse.json({
      experiment: createExperimentDraft({
        ...parsed,
        companyIdOrSlug: slug,
      }, db),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid experiment create payload", error.flatten());
    }
    return handleRouteError(error, "company-experiments:post");
  }
}
