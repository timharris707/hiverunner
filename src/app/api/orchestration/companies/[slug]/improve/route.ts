import { NextRequest, NextResponse } from "next/server";
import type Database from "better-sqlite3";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  createImprovementSuppression,
  deactivateImprovementSuppression,
  dismissImprovementRecommendation,
  getImprovementDashboard,
  setCompanyImprovementPause,
  setImprovementTriggerEnabled,
} from "@/lib/orchestration/improvement-recommendations";

export const dynamic = "force-dynamic";

const triggerKeySchema = z.enum([
  "severe_single_failure",
  "repeated_review_return",
  "missing_capability",
  "missing_tool_runtime",
  "template_drift",
  "runner_mismatch",
  "reviewer_request",
  "slow_expensive_run",
]);

const scopeTypeSchema = z.enum(["company", "project", "template", "task_type", "agent", "runner", "recommendation"]);
const dismissalReasonSchema = z.enum(["not_now", "wrong_diagnosis", "too_risky", "already_fixed", "not_worth_it"]);
const suppressionReasonSchema = z.enum([
  "not_now",
  "wrong_diagnosis",
  "too_risky",
  "already_fixed",
  "not_worth_it",
  "duplicate",
  "operator_suppressed",
]);

const updateImproveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_company_pause"),
    paused: z.boolean(),
    reason: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    action: z.literal("set_trigger_enabled"),
    triggerKey: triggerKeySchema,
    enabled: z.boolean(),
    threshold: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
  z.object({
    action: z.literal("dismiss_recommendation"),
    recommendationId: z.string().trim().min(1),
    reason: dismissalReasonSchema,
    notes: z.string().max(5000).nullable().optional(),
  }),
  z.object({
    action: z.literal("create_suppression"),
    triggerKey: triggerKeySchema.nullable().optional(),
    scopeType: scopeTypeSchema.optional(),
    scopeKey: z.string().trim().min(1).optional(),
    reason: suppressionReasonSchema,
    notes: z.string().max(5000).nullable().optional(),
    expiresAt: z.string().trim().min(1).nullable().optional(),
  }),
  z.object({
    action: z.literal("deactivate_suppression"),
    suppressionId: z.string().trim().min(1),
  }),
]);

type UpdateImproveInput = z.infer<typeof updateImproveSchema>;
type UpdateImproveAction = UpdateImproveInput["action"];
type UpdateImproveHandler<Action extends UpdateImproveAction> = (
  companyId: string,
  parsed: Extract<UpdateImproveInput, { action: Action }>,
  db: Database.Database,
) => void;

function resolveCompany(slug: string, db = getOrchestrationDb()) {
  const company = resolveCompanyIdBySlug(slug, db);
  if (!company) {
    return null;
  }
  return company;
}

const improveUpdateHandlers: { [Action in UpdateImproveAction]: UpdateImproveHandler<Action> } = {
  set_company_pause: (companyId, parsed, db) => {
    setCompanyImprovementPause({
      companyId,
      paused: parsed.paused,
      reason: parsed.reason,
    }, db);
  },
  set_trigger_enabled: (companyId, parsed, db) => {
    setImprovementTriggerEnabled({
      companyId,
      triggerKey: parsed.triggerKey,
      enabled: parsed.enabled,
      threshold: parsed.threshold,
    }, db);
  },
  dismiss_recommendation: (companyId, parsed, db) => {
    dismissImprovementRecommendation({
      companyId,
      recommendationId: parsed.recommendationId,
      reason: parsed.reason,
      notes: parsed.notes,
    }, db);
  },
  create_suppression: (companyId, parsed, db) => {
    createImprovementSuppression({
      companyId,
      triggerKey: parsed.triggerKey,
      scope: {
        type: parsed.scopeType ?? "company",
        key: parsed.scopeKey ?? companyId,
      },
      reason: parsed.reason,
      notes: parsed.notes,
      expiresAt: parsed.expiresAt,
    }, db);
  },
  deactivate_suppression: (companyId, parsed, db) => {
    deactivateImprovementSuppression({
      companyId,
      suppressionId: parsed.suppressionId,
    }, db);
  },
};

function applyImproveUpdate(companyId: string, parsed: UpdateImproveInput, db: Database.Database): void {
  const handler = improveUpdateHandlers[parsed.action] as (
    companyId: string,
    parsed: UpdateImproveInput,
    db: Database.Database,
  ) => void;
  handler(companyId, parsed, db);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();
    const company = resolveCompany(slug, db);
    if (!company) {
      return errorResponse(404, "company_not_found", "Company not found");
    }

    return NextResponse.json(getImprovementDashboard(company.id, db));
  } catch (error) {
    return handleRouteError(error, "company-improve:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();
    const company = resolveCompany(slug, db);
    if (!company) {
      return errorResponse(404, "company_not_found", "Company not found");
    }

    const parsed = updateImproveSchema.parse(await req.json());
    applyImproveUpdate(company.id, parsed, db);

    return NextResponse.json(getImprovementDashboard(company.id, db));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid Improve update payload", error.flatten());
    }
    return handleRouteError(error, "company-improve:patch");
  }
}
