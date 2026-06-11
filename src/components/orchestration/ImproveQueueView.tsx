"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  Ban,
  CheckCircle2,
  Edit3,
  Filter,
  Loader2,
  Pause,
  Play,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

import { 
  listCompanies,
  getCompanyImprovementDashboard,
  setCompanyImprovementPaused,
  setCompanyImprovementTriggerEnabled,
  dismissCompanyImprovementRecommendation,
  suppressCompanyImproveRecommendation,
  acceptCompanyImproveRecommendationForApproval,
  editCompanyImproveRecommendation,
} from "@/lib/orchestration/client";
import {
  buildCanonicalActivityPath,
  buildCanonicalCompanyPath,
  buildCanonicalEvalsPath,
  buildCanonicalTaskRunTracePath,
} from "@/lib/orchestration/route-paths";
import type {
  OrchestrationCompany,
  OrchestrationImprovementDismissalReason,
  OrchestrationImprovementEvidenceSummary,
  OrchestrationImprovementScopeType,
  OrchestrationImprovementSuppressionReason,
  OrchestrationImprovementTriggerFiringStatus,
  OrchestrationImprovementTriggerKey,
} from "@/lib/orchestration/types";
import { color, font, pageStyle, radius, space, type as T } from "@/lib/ui/tokens";
import { Badge, EmptyState, IconButton, PageHeader, Section } from "@/lib/ui/primitives";

export type ImproveRecommendationStatus =
  | "suggested"
  | "needs-more-evidence"
  | "accepted-for-approval"
  | "dismissed"
  | "superseded"
  | "applied";

export type ImproveSeverity = "low" | "medium" | "high" | "critical";
export type ImproveConfidence = "low" | "medium" | "high";

export type ImproveDismissalCategory = OrchestrationImprovementDismissalReason;

export type ImproveTriggerId = OrchestrationImprovementTriggerKey;

export interface ImproveEvidenceLink {
  id: string;
  label: string;
  detail: string;
  href: string;
  kind: "run_trace" | "eval_case" | "task" | "activity";
  occurredAt: string;
}

export interface ImproveRecommendation {
  id: string;
  title: string;
  group: string;
  status: ImproveRecommendationStatus;
  trigger: ImproveTriggerId;
  severity: ImproveSeverity;
  confidence: ImproveConfidence;
  scope: string;
  scopeType: OrchestrationImprovementScopeType;
  scopeKey: string;
  affected: string[];
  rationale: string;
  proposedChange: string;
  originalSuggestion: string;
  rollbackNotes: string;
  evidence: ImproveEvidenceLink[];
  updatedAt: string;
  suppressed: boolean;
  suppressedScope?: string;
  suppressedUntil?: string;
  dismissalCategory?: ImproveDismissalCategory;
  dismissalNote?: string;
  approvalDraftId?: string;
  approvalHref?: string;
  activityHref?: string;
}

export interface ImproveTriggerControl {
  id: ImproveTriggerId;
  label: string;
  description: string;
  enabled: boolean;
  thresholdLabel: string;
  thresholdValue: number;
  lastFiredAt: string | null;
  fireCount: number;
  recommendationCount: number;
  suppressedCount: number;
}

export interface ImproveTriggerFiring {
  id: string;
  trigger: ImproveTriggerId;
  status: OrchestrationImprovementTriggerFiringStatus;
  decisionReason: string;
  scope: string;
  recommendationTitle?: string | null;
  suppressionReason?: string | null;
  firedAt: string;
}

export interface ImproveQueueFilters {
  status: ImproveRecommendationStatus | "all";
  trigger: ImproveTriggerId | "all";
  severity: ImproveSeverity | "all";
  confidence: ImproveConfidence | "all";
  suppression: "all" | "active" | "suppressed";
  query: string;
}

export type ImproveQueueAction =
  | { type: "accept"; id: string }
  | { type: "dismiss"; id: string; category: ImproveDismissalCategory; note?: string }
  | { type: "suppress"; id: string; scope?: string }
  | { type: "edit"; id: string; patch: Partial<Pick<ImproveRecommendation, "proposedChange" | "scope" | "affected" | "rationale" | "rollbackNotes">> };

function buildImproveRecommendationSuppressionInput(
  recommendation: Pick<ImproveRecommendation, "scopeType" | "scopeKey"> | null | undefined,
): {
  reason: OrchestrationImprovementSuppressionReason;
  scopeType?: OrchestrationImprovementScopeType;
  scopeKey?: string;
} {
  const scopeKey = recommendation?.scopeKey.trim();
  if (!recommendation || !scopeKey) {
    return { reason: "not_now" };
  }
  return {
    reason: "not_now",
    scopeType: recommendation.scopeType,
    scopeKey,
  };
}

const IMPROVE_STATUS_ORDER: readonly ImproveRecommendationStatus[] = [
  "suggested",
  "needs-more-evidence",
  "accepted-for-approval",
  "dismissed",
  "superseded",
  "applied",
] as const;

const IMPROVE_TRIGGER_OPTIONS: readonly ImproveTriggerId[] = [
  "severe_single_failure",
  "repeated_review_return",
  "missing_capability",
  "missing_tool_runtime",
  "template_drift",
  "runner_mismatch",
  "reviewer_request",
  "slow_expensive_run",
] as const;

const DISMISSAL_CATEGORIES: Array<{ value: ImproveDismissalCategory; label: string }> = [
  { value: "not_now", label: "Not now" },
  { value: "wrong_diagnosis", label: "Wrong diagnosis" },
  { value: "too_risky", label: "Too risky" },
  { value: "already_fixed", label: "Already fixed" },
  { value: "not_worth_it", label: "Not worth it" },
];

export const DEFAULT_IMPROVE_FILTERS: ImproveQueueFilters = {
  status: "suggested",
  trigger: "all",
  severity: "all",
  confidence: "all",
  suppression: "active",
  query: "",
};

function prettyToken(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).replace(" at ", ", ");
}

function statusTone(status: ImproveRecommendationStatus): "default" | "accent" | "positive" | "negative" | "warning" | "info" {
  if (status === "suggested") return "accent";
  if (status === "needs-more-evidence") return "warning";
  if (status === "accepted-for-approval") return "info";
  if (status === "dismissed") return "negative";
  if (status === "applied") return "positive";
  return "default";
}

function severityTone(severity: ImproveSeverity): "default" | "accent" | "positive" | "negative" | "warning" | "info" {
  if (severity === "critical") return "negative";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  return "default";
}

function confidenceTone(confidence: ImproveConfidence): "default" | "accent" | "positive" | "negative" | "warning" | "info" {
  if (confidence === "high") return "positive";
  if (confidence === "medium") return "info";
  return "default";
}

function triggerFiringTone(
  status: OrchestrationImprovementTriggerFiringStatus,
): "default" | "accent" | "positive" | "negative" | "warning" | "info" {
  if (status === "created_recommendation") return "positive";
  if (status === "needs_more_evidence") return "warning";
  if (status === "suppressed") return "info";
  return "default";
}

function normalizeImproveTriggerId(value: string | null | undefined): ImproveTriggerId {
  return IMPROVE_TRIGGER_OPTIONS.includes(value as ImproveTriggerId)
    ? value as ImproveTriggerId
    : "reviewer_request";
}

function evidenceKindLabel(kind: ImproveEvidenceLink["kind"]): string {
  if (kind === "run_trace") return "Run Trace";
  if (kind === "eval_case") return "Eval Case";
  if (kind === "activity") return "Activity";
  return "Task";
}

function formatImproveScope(
  scopeType: OrchestrationImprovementScopeType,
  scopeKey: string,
  label?: string | null,
): string {
  const compactLabel = label?.trim();
  return compactLabel || `${prettyToken(scopeType)}: ${scopeKey}`;
}

function thresholdValue(threshold: Record<string, unknown>): number {
  const value = threshold.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

function evidenceKindFromSource(sourceType: string): ImproveEvidenceLink["kind"] {
  if (sourceType === "task") return "task";
  if (sourceType === "eval") return "eval_case";
  if (sourceType === "review" || sourceType === "manual") return "activity";
  return "run_trace";
}

function evidenceLinkFromSummary(
  recommendationId: string,
  evidence: OrchestrationImprovementEvidenceSummary,
  index: number,
): ImproveEvidenceLink {
  return {
    id: evidence.id || `evidence-${recommendationId}-${index}`,
    label: evidence.title,
    detail: evidence.summary,
    href: evidence.links[0]?.href ?? "#",
    kind: evidenceKindFromSource(evidence.sourceType),
    occurredAt: evidence.occurredAt ?? new Date(0).toISOString(),
  };
}

function selectStyle(): CSSProperties {
  return {
    width: "100%",
    height: 34,
    borderRadius: radius.md,
    border: `0.5px solid ${color.border}`,
    background: color.surface,
    color: color.text,
    padding: "0 9px",
    fontSize: T.bodySmall.size,
    outline: "none",
  };
}

function textareaStyle(): CSSProperties {
  return {
    width: "100%",
    minHeight: 74,
    borderRadius: radius.md,
    border: `0.5px solid ${color.border}`,
    background: color.surface,
    color: color.text,
    padding: 9,
    fontSize: T.bodySmall.size,
    lineHeight: 1.45,
    outline: "none",
    resize: "vertical",
  };
}

function buttonStyle(tone: "default" | "primary" | "danger" = "default"): CSSProperties {
  const styles: Record<typeof tone, CSSProperties> = {
    default: {
      border: `0.5px solid ${color.border}`,
      background: color.surface,
      color: color.text,
    },
    primary: {
      border: "none",
      background: color.accent,
      color: color.accentForeground,
      fontWeight: 600,
    },
    danger: {
      border: `0.5px solid ${color.negative}`,
      background: color.negativeSoft,
      color: color.negative,
    },
  };

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 30,
    borderRadius: radius.md,
    padding: "5px 12px",
    fontSize: T.bodySmall.size,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "border-color 0.15s, opacity 0.15s",
    ...styles[tone],
  };
}

export function readImproveFilters(searchParams: URLSearchParams): ImproveQueueFilters {
  const status = searchParams.get("status");
  const trigger = searchParams.get("trigger");
  const severity = searchParams.get("severity");
  const confidence = searchParams.get("confidence");
  const suppression = searchParams.get("suppression");

  return {
    status: status === "all" || IMPROVE_STATUS_ORDER.includes(status as ImproveRecommendationStatus)
      ? status as ImproveQueueFilters["status"]
      : DEFAULT_IMPROVE_FILTERS.status,
    trigger: trigger === "all" || IMPROVE_TRIGGER_OPTIONS.includes(trigger as ImproveTriggerId)
      ? trigger as ImproveQueueFilters["trigger"]
      : "all",
    severity: severity === "all" || severity === "low" || severity === "medium" || severity === "high" || severity === "critical"
      ? severity as ImproveQueueFilters["severity"]
      : "all",
    confidence: confidence === "all" || confidence === "low" || confidence === "medium" || confidence === "high"
      ? confidence as ImproveQueueFilters["confidence"]
      : "all",
    suppression: suppression === "all" || suppression === "active" || suppression === "suppressed"
      ? suppression
      : DEFAULT_IMPROVE_FILTERS.suppression,
    query: searchParams.get("q")?.trim() ?? "",
  };
}

export function countImproveStatuses(recommendations: readonly ImproveRecommendation[]): Record<ImproveRecommendationStatus | "all", number> {
  const counts = Object.fromEntries(IMPROVE_STATUS_ORDER.map((status) => [status, 0])) as Record<ImproveRecommendationStatus | "all", number>;
  counts.all = recommendations.length;
  for (const recommendation of recommendations) {
    counts[recommendation.status] += 1;
  }
  return counts;
}

export function filterImproveRecommendations(
  recommendations: readonly ImproveRecommendation[],
  filters: ImproveQueueFilters,
): ImproveRecommendation[] {
  const query = filters.query.trim().toLowerCase();
  return recommendations.filter((recommendation) => {
    if (filters.status !== "all" && recommendation.status !== filters.status) return false;
    if (filters.trigger !== "all" && recommendation.trigger !== filters.trigger) return false;
    if (filters.severity !== "all" && recommendation.severity !== filters.severity) return false;
    if (filters.confidence !== "all" && recommendation.confidence !== filters.confidence) return false;
    if (filters.suppression === "active" && recommendation.suppressed) return false;
    if (filters.suppression === "suppressed" && !recommendation.suppressed) return false;
    if (!query) return true;

    const haystack = [
      recommendation.title,
      recommendation.group,
      recommendation.scope,
      recommendation.proposedChange,
      recommendation.rationale,
      recommendation.trigger,
      ...recommendation.affected,
      ...recommendation.evidence.map((evidence) => `${evidence.label} ${evidence.detail}`),
    ].join(" ").toLowerCase();

    return haystack.includes(query);
  });
}

function groupImproveRecommendations(recommendations: readonly ImproveRecommendation[]) {
  const groups = new Map<string, ImproveRecommendation[]>();
  for (const recommendation of recommendations) {
    const existing = groups.get(recommendation.group);
    if (existing) {
      existing.push(recommendation);
    } else {
      groups.set(recommendation.group, [recommendation]);
    }
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

export function applyImproveQueueAction(
  recommendations: readonly ImproveRecommendation[],
  action: ImproveQueueAction,
): ImproveRecommendation[] {
  const now = new Date().toISOString();
  return recommendations.map((recommendation) => {
    if (recommendation.id !== action.id) return recommendation;

    if (action.type === "accept") {
      return {
        ...recommendation,
        status: "accepted-for-approval",
        suppressed: false,
        suppressedScope: undefined,
        suppressedUntil: undefined,
        approvalDraftId: recommendation.approvalDraftId ?? `draft-${recommendation.id}`,
        updatedAt: now,
      };
    }

    if (action.type === "dismiss") {
      return {
        ...recommendation,
        status: "dismissed",
        dismissalCategory: action.category,
        dismissalNote: action.note?.trim() || undefined,
        updatedAt: now,
      };
    }

    if (action.type === "suppress") {
      return {
        ...recommendation,
        status: "dismissed",
        suppressed: true,
        suppressedScope: action.scope ?? recommendation.scope,
        suppressedUntil: "New substantial evidence",
        dismissalCategory: recommendation.dismissalCategory ?? "not_now",
        updatedAt: now,
      };
    }

    return {
      ...recommendation,
      ...action.patch,
      updatedAt: now,
    };
  });
}

export function createSeedImproveTriggerControls(): ImproveTriggerControl[] {
  return [
    {
      id: "severe_single_failure",
      label: "Severe single failure",
      description: "Creates checks when one run has release, safety, or impossible-review risk.",
      enabled: true,
      thresholdLabel: "Minimum severity",
      thresholdValue: 4,
      lastFiredAt: "2026-06-06T22:08:00.000Z",
      fireCount: 3,
      recommendationCount: 1,
      suppressedCount: 0,
    },
    {
      id: "repeated_review_return",
      label: "Repeated review return",
      description: "Looks for similar review returns by agent, runner, or task type.",
      enabled: true,
      thresholdLabel: "Returns required",
      thresholdValue: 2,
      lastFiredAt: "2026-06-06T20:33:00.000Z",
      fireCount: 8,
      recommendationCount: 2,
      suppressedCount: 1,
    },
    {
      id: "missing_capability",
      label: "Missing capability",
      description: "Checks template and sprint capability gaps against Active Crew and Bench.",
      enabled: true,
      thresholdLabel: "Open gaps",
      thresholdValue: 1,
      lastFiredAt: "2026-06-06T18:40:00.000Z",
      fireCount: 5,
      recommendationCount: 1,
      suppressedCount: 0,
    },
    {
      id: "missing_tool_runtime",
      label: "Missing tool or runtime",
      description: "Captures tool, CLI, runtime, and trusted capability misses.",
      enabled: true,
      thresholdLabel: "Failures required",
      thresholdValue: 1,
      lastFiredAt: "2026-06-06T17:05:00.000Z",
      fireCount: 4,
      recommendationCount: 1,
      suppressedCount: 1,
    },
    {
      id: "template_drift",
      label: "Template drift",
      description: "Finds repeated manual task or role additions after template sprint creation.",
      enabled: false,
      thresholdLabel: "Repeated additions",
      thresholdValue: 3,
      lastFiredAt: "2026-06-05T14:21:00.000Z",
      fireCount: 2,
      recommendationCount: 1,
      suppressedCount: 0,
    },
  ];
}

export function createSeedImproveTriggerFirings(): ImproveTriggerFiring[] {
  return [
    {
      id: "firing-review-return-created",
      trigger: "repeated_review_return",
      status: "created_recommendation",
      decisionReason: "recommendation_created",
      scope: "task_type:frontend-implementation",
      recommendationTitle: "Add Playwright video verification to review-sensitive UI tasks",
      firedAt: "2026-06-06T22:08:00.000Z",
    },
    {
      id: "firing-runtime-suppressed",
      trigger: "missing_tool_runtime",
      status: "suppressed",
      decisionReason: "already_fixed",
      scope: "company:Insight",
      recommendationTitle: "Suppress repeated runtime warning for already-configured local Postgres",
      suppressionReason: "already_fixed",
      firedAt: "2026-06-06T17:05:00.000Z",
    },
    {
      id: "firing-template-paused",
      trigger: "template_drift",
      status: "skipped",
      decisionReason: "trigger_disabled",
      scope: "template:starter-sprint-improve-v1",
      firedAt: "2026-06-05T14:21:00.000Z",
    },
  ];
}

export function createSeedImproveRecommendations(companyCode: string): ImproveRecommendation[] {
  const runTrace = buildCanonicalTaskRunTracePath(companyCode, "INS-242", "run-ins-242-7");
  const task = buildCanonicalCompanyPath(companyCode, "/tasks/INS-242");
  const evals = buildCanonicalEvalsPath(companyCode);
  const activity = `${buildCanonicalActivityPath(companyCode)}?kind=improvement`;

  return [
    {
      id: "improve-1",
      title: "Add Playwright video verification to review-sensitive UI tasks",
      group: "Review return pattern",
      status: "suggested",
      trigger: "repeated_review_return",
      severity: "high",
      confidence: "high",
      scope: "Frontend implementation tasks in Sprint 4",
      scopeType: "task_type",
      scopeKey: "frontend-implementation",
      affected: ["Samantha", "Gator", "Lens", "UI validation lane"],
      rationale: "Two recent UI tasks needed additional proof after screenshots missed interaction regressions.",
      proposedChange: "Require a short Playwright video proof when a UI task changes queue actions, approval flows, or responsive navigation.",
      originalSuggestion: "Add video proof for queue and approval interactions before promotion review.",
      rollbackNotes: "Remove the added verification requirement from the sprint task template if it slows non-UI work.",
      evidence: [
        {
          id: "evidence-1",
          kind: "run_trace",
          label: "INS-242 run trace",
          detail: "Review return cited missing interaction proof for a dense queue surface.",
          href: runTrace,
          occurredAt: "2026-06-06T22:08:00.000Z",
        },
        {
          id: "evidence-2",
          kind: "task",
          label: "INS-242 task detail",
          detail: "Follow-up added browser evidence after review.",
          href: task,
          occurredAt: "2026-06-06T22:40:00.000Z",
        },
      ],
      updatedAt: "2026-06-06T22:50:00.000Z",
      suppressed: false,
      activityHref: activity,
    },
    {
      id: "improve-2",
      title: "Gather one more eval case before changing the template capability slot",
      group: "Template capability gap",
      status: "needs-more-evidence",
      trigger: "missing_capability",
      severity: "medium",
      confidence: "medium",
      scope: "Starter sprint template: Improve v1",
      scopeType: "template",
      scopeKey: "starter-sprint-improve-v1",
      affected: ["Starter template", "Toby", "Samantha"],
      rationale: "The same UX acceptance gap appeared once, but one run is not enough evidence for a durable template change.",
      proposedChange: "Collect another returned or accepted eval case before adding UX product acceptance as a required slot.",
      originalSuggestion: "Move UX product acceptance from useful to required for Improve work.",
      rollbackNotes: "Keep the slot unchanged until the second evidence case confirms the pattern.",
      evidence: [
        {
          id: "evidence-3",
          kind: "eval_case",
          label: "Eval case: queue navigation review",
          detail: "Reviewer requested clearer mobile acceptance evidence.",
          href: `${evals}?tag=improve`,
          occurredAt: "2026-06-06T20:33:00.000Z",
        },
      ],
      updatedAt: "2026-06-06T20:51:00.000Z",
      suppressed: false,
      activityHref: activity,
    },
    {
      id: "improve-3",
      title: "Prepare approval to add browser proof checklist to Improve tasks",
      group: "Review return pattern",
      status: "accepted-for-approval",
      trigger: "repeated_review_return",
      severity: "high",
      confidence: "high",
      scope: "Sprint validation checklist",
      scopeType: "project",
      scopeKey: "hiverunner",
      affected: ["Gator", "Lens", "Sprint 4 validation"],
      rationale: "The recommendation has enough evidence and is ready for governed approval packaging.",
      proposedChange: "Add Improve browser proof checklist items for filters, evidence detail, edit, dismiss, suppress, accept, and responsive layout.",
      originalSuggestion: "Batch the Improve UI verification requirements into one checklist change.",
      rollbackNotes: "Revert the checklist entry if promotion shows the extra proof is redundant with existing e2e evidence.",
      evidence: [
        {
          id: "evidence-4",
          kind: "activity",
          label: "Activity: review evidence gap",
          detail: "Review lane asked for explicit Improve queue interaction proof.",
          href: activity,
          occurredAt: "2026-06-06T19:10:00.000Z",
        },
      ],
      updatedAt: "2026-06-06T19:15:00.000Z",
      suppressed: false,
      approvalDraftId: "draft-improve-browser-proof",
      approvalHref: buildCanonicalCompanyPath(companyCode, "/approvals/pending"),
      activityHref: activity,
    },
    {
      id: "improve-4",
      title: "Suppress repeated runtime warning for already-configured local Postgres",
      group: "Tool and runtime setup",
      status: "dismissed",
      trigger: "missing_tool_runtime",
      severity: "low",
      confidence: "medium",
      scope: "Insight local runtime",
      scopeType: "company",
      scopeKey: companyCode,
      affected: ["local-postgres", "HiveRunner runtime lane"],
      rationale: "The trigger fired from stale runtime metadata even though local Postgres is available in the trusted lane.",
      proposedChange: "Suppress this runtime warning until a fresh missing-capability event appears.",
      originalSuggestion: "Ask operator to configure local Postgres before verification.",
      rollbackNotes: "Clear the suppression if a real database connection failure appears in a future run.",
      evidence: [
        {
          id: "evidence-5",
          kind: "activity",
          label: "Runtime readiness check",
          detail: "Trusted local runtime already lists local-postgres.",
          href: activity,
          occurredAt: "2026-06-06T17:05:00.000Z",
        },
      ],
      updatedAt: "2026-06-06T17:15:00.000Z",
      suppressed: true,
      suppressedScope: "Company runtime: Insight",
      suppressedUntil: "New substantial evidence",
      dismissalCategory: "already_fixed",
      dismissalNote: "Runtime capability is present in the task contract.",
      activityHref: activity,
    },
    {
      id: "improve-5",
      title: "Superseded duplicate recommendation for queue proof wording",
      group: "Review return pattern",
      status: "superseded",
      trigger: "reviewer_request",
      severity: "medium",
      confidence: "high",
      scope: "INS-250 promotion package",
      scopeType: "recommendation",
      scopeKey: "improve-browser-proof",
      affected: ["Promotion notes"],
      rationale: "This recommendation was merged into the broader browser proof checklist.",
      proposedChange: "Use the accepted browser proof package instead of a separate wording-only task.",
      originalSuggestion: "Add a standalone queue proof note.",
      rollbackNotes: "No durable change was applied; reopen the current accepted recommendation if needed.",
      evidence: [
        {
          id: "evidence-6",
          kind: "task",
          label: "INS-250 task",
          detail: "Merged into accepted-for-approval queue proof recommendation.",
          href: buildCanonicalCompanyPath(companyCode, "/tasks/INS-250"),
          occurredAt: "2026-06-06T16:38:00.000Z",
        },
      ],
      updatedAt: "2026-06-06T16:45:00.000Z",
      suppressed: false,
      activityHref: activity,
    },
    {
      id: "improve-6",
      title: "Applied reviewer note requirement to eval case saves",
      group: "Eval evidence hygiene",
      status: "applied",
      trigger: "severe_single_failure",
      severity: "medium",
      confidence: "high",
      scope: "Review-backed eval capture",
      scopeType: "template",
      scopeKey: "review-backed-eval-capture",
      affected: ["Evals", "Run Trace"],
      rationale: "A previous recommendation added a compact reviewer rationale requirement to saved eval cases.",
      proposedChange: "Require a review rationale before saving an eval case.",
      originalSuggestion: "Prevent eval cases from being stored without review reasoning.",
      rollbackNotes: "Remove the validation rule if imported legacy eval cases need a migration-only bypass.",
      evidence: [
        {
          id: "evidence-7",
          kind: "eval_case",
          label: "Accepted eval capture",
          detail: "Applied recommendation now visible in saved eval cases.",
          href: evals,
          occurredAt: "2026-06-06T14:10:00.000Z",
        },
      ],
      updatedAt: "2026-06-06T14:22:00.000Z",
      suppressed: false,
      activityHref: activity,
    },
  ];
}

function FilterSelect({
  label,
  value,
  children,
  onChange,
}: {
  label: string;
  value: string;
  children: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: T.caption.size, color: color.textMuted }}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={selectStyle()}>
        {children}
      </select>
    </label>
  );
}

function MetricCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: 0, color: color.textMuted, fontSize: T.caption.size }}>{label}</p>
      <p style={{ margin: "3px 0 0", color: color.text, fontSize: T.bodySmall.size, fontWeight: 650 }}>{value}</p>
    </div>
  );
}

function TriggerControlRow({
  control,
  onToggle,
  onThresholdChange,
}: {
  control: ImproveTriggerControl;
  onToggle?: (id: ImproveTriggerId) => void;
  onThresholdChange?: (id: ImproveTriggerId, value: number) => void;
}) {
  return (
    <article
      data-improve-trigger={control.id}
      style={{
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: color.surface,
        padding: space.md,
        display: "grid",
        gap: space.md,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.md }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge label={control.enabled ? "Enabled" : "Paused"} tone={control.enabled ? "positive" : "warning"} />
            <span style={{ color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono }}>{control.id}</span>
          </div>
          <h2 style={{ margin: "7px 0 0", color: color.text, fontSize: T.cardTitle.size, fontWeight: T.cardTitle.weight }}>
            {control.label}
          </h2>
          <p style={{ margin: "4px 0 0", color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
            {control.description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onToggle?.(control.id)}
          aria-pressed={control.enabled}
          style={buttonStyle(control.enabled ? "default" : "primary")}
        >
          {control.enabled ? <Pause size={13} /> : <Play size={13} />}
          {control.enabled ? "Pause" : "Resume"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_92px_92px_92px]">
        <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
          <span style={{ fontSize: T.caption.size, color: color.textMuted }}>{control.thresholdLabel}</span>
          <input
            type="number"
            min={1}
            value={control.thresholdValue}
            onChange={(event) => onThresholdChange?.(control.id, Number(event.target.value))}
            style={selectStyle()}
          />
        </label>
        <MetricCell label="Fired" value={control.fireCount} />
        <MetricCell label="Created" value={control.recommendationCount} />
        <MetricCell label="Suppressed" value={control.suppressedCount} />
      </div>
      <p style={{ margin: 0, color: color.textMuted, fontSize: T.caption.size }}>
        {control.lastFiredAt ? `Last fired ${formatShortDate(control.lastFiredAt)}` : "Never fired"}
      </p>
    </article>
  );
}

function RecentTriggerFirings({ firings }: { firings: readonly ImproveTriggerFiring[] }) {
  if (firings.length === 0) {
    return (
      <div style={{ borderRadius: radius.md, border: `0.5px dashed ${color.border}`, padding: space.lg }}>
        <EmptyState
          icon={<Archive size={20} />}
          title="No recent trigger firings."
          description="Pause, disable, suppression, and trigger-created decisions will appear here."
        />
      </div>
    );
  }

  return (
    <div data-improve-trigger-firings style={{ display: "grid", gap: space.sm }}>
      {firings.slice(0, 8).map((firing) => (
        <article
          key={firing.id}
          data-improve-trigger-firing={firing.id}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: space.md,
            alignItems: "start",
            borderRadius: radius.md,
            border: `0.5px solid ${color.border}`,
            background: color.surface,
            padding: space.md,
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <Badge label={prettyToken(firing.status)} tone={triggerFiringTone(firing.status)} />
              <span style={{ color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono }}>{firing.trigger}</span>
            </div>
            <p style={{ margin: "7px 0 0", color: color.text, fontSize: T.bodySmall.size, fontWeight: 650, overflowWrap: "anywhere" }}>
              {firing.recommendationTitle ?? prettyToken(firing.decisionReason || firing.status)}
            </p>
          </div>
          <div style={{ minWidth: 0 }}>
            <MetricCell label="Scope" value={firing.scope} />
            <MetricCell label="Decision" value={firing.suppressionReason ?? (firing.decisionReason || "recorded")} />
          </div>
          <p style={{ margin: 0, color: color.textMuted, fontSize: T.caption.size, textAlign: "right" }}>
            {formatShortDate(firing.firedAt)}
          </p>
        </article>
      ))}
    </div>
  );
}

function RecommendationRow({
  recommendation,
  active,
  onSelect,
}: {
  recommendation: ImproveRecommendation;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const firstEvidence = recommendation.evidence[0];
  return (
    <button
      type="button"
      data-improve-recommendation={recommendation.id}
      onClick={() => onSelect(recommendation.id)}
      style={{
        width: "100%",
        display: "grid",
        gap: space.sm,
        textAlign: "left",
        borderRadius: radius.md,
        border: `0.5px solid ${active ? color.borderStrong : color.border}`,
        background: active ? color.surfaceElevated : "transparent",
        padding: space.md,
        cursor: "pointer",
        color: color.text,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.md }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <Badge label={prettyToken(recommendation.status)} tone={statusTone(recommendation.status)} />
            <Badge label={recommendation.severity} tone={severityTone(recommendation.severity)} />
            <Badge label={`${recommendation.confidence} confidence`} tone={confidenceTone(recommendation.confidence)} />
            {recommendation.suppressed ? <Badge label="suppressed" tone="warning" /> : null}
          </div>
          <h3 style={{ margin: 0, color: color.text, fontSize: T.cardTitle.size, fontWeight: T.cardTitle.weight, lineHeight: 1.35, overflowWrap: "anywhere" }}>
            {recommendation.title}
          </h3>
        </div>
        <span style={{ color: color.textMuted, fontSize: T.caption.size, whiteSpace: "nowrap" }} suppressHydrationWarning>
          {formatShortDate(recommendation.updatedAt)}
        </span>
      </div>
      <p style={{ margin: 0, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.45, overflowWrap: "anywhere" }}>
        {recommendation.proposedChange}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: color.textMuted, fontSize: T.caption.size }}>
        <span>{prettyToken(recommendation.trigger)}</span>
        <span>Scope: {recommendation.scope}</span>
        {firstEvidence ? <span>Evidence: {firstEvidence.label}</span> : null}
      </div>
    </button>
  );
}

function RecommendationDetail({
  recommendation,
  onAction,
}: {
  recommendation: ImproveRecommendation | null;
  onAction?: (action: ImproveQueueAction) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    proposedChange: "",
    scope: "",
    affected: "",
    rationale: "",
    rollbackNotes: "",
  });
  const [dismissId, setDismissId] = useState<string | null>(null);
  const [dismissCategory, setDismissCategory] = useState<ImproveDismissalCategory>("not_now");
  const [dismissNote, setDismissNote] = useState("");

  if (!recommendation) {
    return (
      <div style={{ borderRadius: radius.md, border: `0.5px dashed ${color.border}`, padding: space.lg }}>
        <EmptyState title="No recommendation selected" description="Select a queue row to inspect evidence and actions." />
      </div>
    );
  }

  const editing = editingId === recommendation.id;
  const dismissing = dismissId === recommendation.id;

  function startEdit() {
    if (!recommendation) return;
    setEditDraft({
      proposedChange: recommendation.proposedChange,
      scope: recommendation.scope,
      affected: recommendation.affected.join(", "),
      rationale: recommendation.rationale,
      rollbackNotes: recommendation.rollbackNotes,
    });
    setEditingId(recommendation.id);
  }

  function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!recommendation) return;
    onAction?.({
      type: "edit",
      id: recommendation.id,
      patch: {
        proposedChange: editDraft.proposedChange.trim() || recommendation.proposedChange,
        scope: editDraft.scope.trim() || recommendation.scope,
        affected: editDraft.affected.split(",").map((item) => item.trim()).filter(Boolean),
        rationale: editDraft.rationale.trim() || recommendation.rationale,
        rollbackNotes: editDraft.rollbackNotes.trim() || recommendation.rollbackNotes,
      },
    });
    setEditingId(null);
  }

  function submitDismiss(event: FormEvent) {
    event.preventDefault();
    if (!recommendation) return;
    onAction?.({
      type: "dismiss",
      id: recommendation.id,
      category: dismissCategory,
      note: dismissNote,
    });
    setDismissId(null);
    setDismissNote("");
  }

  return (
    <aside
      data-improve-evidence-preview
      style={{
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: color.surface,
        padding: space.lg,
        display: "grid",
        gap: space.lg,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.md }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <Badge label={prettyToken(recommendation.status)} tone={statusTone(recommendation.status)} />
            <Badge label={recommendation.severity} tone={severityTone(recommendation.severity)} />
            <Badge label={`${recommendation.confidence} confidence`} tone={confidenceTone(recommendation.confidence)} />
          </div>
          <h2 style={{ margin: 0, color: color.text, fontSize: 15, fontWeight: 700, lineHeight: 1.35, overflowWrap: "anywhere" }}>
            {recommendation.title}
          </h2>
          <p style={{ margin: "6px 0 0", color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono, overflowWrap: "anywhere" }}>
            {recommendation.id} / {recommendation.trigger}
          </p>
        </div>
        <IconButton label="Edit recommendation" icon={<Edit3 size={14} />} size="sm" onClick={startEdit} />
      </div>

      {editing ? (
        <form onSubmit={saveEdit} style={{ display: "grid", gap: space.md }}>
          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: T.caption.size, color: color.textMuted }}>Proposed change</span>
            <textarea
              value={editDraft.proposedChange}
              onChange={(event) => setEditDraft((draft) => ({ ...draft, proposedChange: event.target.value }))}
              style={textareaStyle()}
            />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: T.caption.size, color: color.textMuted }}>Scope</span>
            <input
              value={editDraft.scope}
              onChange={(event) => setEditDraft((draft) => ({ ...draft, scope: event.target.value }))}
              style={selectStyle()}
            />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: T.caption.size, color: color.textMuted }}>Affected items</span>
            <input
              value={editDraft.affected}
              onChange={(event) => setEditDraft((draft) => ({ ...draft, affected: event.target.value }))}
              style={selectStyle()}
            />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: T.caption.size, color: color.textMuted }}>Rationale</span>
            <textarea
              value={editDraft.rationale}
              onChange={(event) => setEditDraft((draft) => ({ ...draft, rationale: event.target.value }))}
              style={textareaStyle()}
            />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: T.caption.size, color: color.textMuted }}>Rollback notes</span>
            <textarea
              value={editDraft.rollbackNotes}
              onChange={(event) => setEditDraft((draft) => ({ ...draft, rollbackNotes: event.target.value }))}
              style={textareaStyle()}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" style={buttonStyle("primary")}>Save edit</button>
            <button type="button" onClick={() => setEditingId(null)} style={buttonStyle()}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <div style={{ display: "grid", gap: 10 }}>
            <MetricCell label="Scope" value={recommendation.scope} />
            <MetricCell label="Affected" value={recommendation.affected.join(", ")} />
            <MetricCell label="Proposed change" value={recommendation.proposedChange} />
            <MetricCell label="Rationale" value={recommendation.rationale} />
            <MetricCell label="Rollback" value={recommendation.rollbackNotes} />
            <MetricCell label="Original generated suggestion" value={recommendation.originalSuggestion} />
            {recommendation.suppressed ? (
              <MetricCell label="Suppression" value={`${recommendation.suppressedScope ?? recommendation.scope} until ${recommendation.suppressedUntil ?? "new evidence"}`} />
            ) : null}
            {recommendation.approvalDraftId ? (
              <MetricCell label="Approval package" value={recommendation.approvalDraftId} />
            ) : null}
          </div>

          <div>
            <h3 style={{ margin: "0 0 8px", color: color.textMuted, fontSize: T.sectionLabel.size, textTransform: "uppercase", letterSpacing: T.sectionLabel.letterSpacing }}>
              Evidence Preview
            </h3>
            <div style={{ display: "grid", gap: 8 }}>
              {recommendation.evidence.map((evidence) => (
                <a
                  key={evidence.id}
                  href={evidence.href}
                  style={{
                    display: "grid",
                    gap: 3,
                    borderRadius: radius.md,
                    border: `0.5px solid ${color.border}`,
                    padding: space.sm,
                    textDecoration: "none",
                    color: color.text,
                    minWidth: 0,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: color.textMuted, fontSize: T.caption.size }}>
                    {evidenceKindLabel(evidence.kind)} / {formatShortDate(evidence.occurredAt)}
                  </span>
                  <strong style={{ fontSize: T.bodySmall.size, overflowWrap: "anywhere" }}>{evidence.label}</strong>
                  <span style={{ color: color.textSecondary, fontSize: T.caption.size, lineHeight: 1.4, overflowWrap: "anywhere" }}>{evidence.detail}</span>
                </a>
              ))}
            </div>
          </div>
        </>
      )}

      {dismissing ? (
        <form onSubmit={submitDismiss} style={{ display: "grid", gap: space.sm }}>
          <FilterSelect label="Dismissal category" value={dismissCategory} onChange={(value) => setDismissCategory(value as ImproveDismissalCategory)}>
            {DISMISSAL_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </FilterSelect>
          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: T.caption.size, color: color.textMuted }}>Optional notes</span>
            <textarea value={dismissNote} onChange={(event) => setDismissNote(event.target.value)} style={textareaStyle()} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" style={buttonStyle("danger")}>Dismiss</button>
            <button type="button" onClick={() => setDismissId(null)} style={buttonStyle()}>Cancel</button>
          </div>
        </form>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => onAction?.({ type: "accept", id: recommendation.id })}
          style={buttonStyle("primary")}
        >
          <CheckCircle2 size={13} />
          Accept for approval
        </button>
        <button
          type="button"
          onClick={() => setDismissId(recommendation.id)}
          style={buttonStyle("danger")}
        >
          <X size={13} />
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => onAction?.({ type: "suppress", id: recommendation.id })}
          style={buttonStyle()}
        >
          <Ban size={13} />
          Suppress
        </button>
      </div>
    </aside>
  );
}

export function ImproveQueueSurface({
  companyCode,
  companyName,
  loading,
  error,
  recommendations,
  triggerControls,
  triggerFirings = [],
  filters,
  automationPaused = false,
  selectedRecommendationId,
  onFilterChange,
  onClearFilters,
  onToggleAutomation,
  onTriggerToggle,
  onTriggerThresholdChange,
  onSelectRecommendation,
  onRecommendationAction,
}: {
  companyCode: string;
  companyName?: string;
  loading: boolean;
  error?: string | null;
  recommendations: ImproveRecommendation[];
  triggerControls: ImproveTriggerControl[];
  triggerFirings?: ImproveTriggerFiring[];
  filters: ImproveQueueFilters;
  automationPaused?: boolean;
  selectedRecommendationId?: string | null;
  onFilterChange?: (patch: Partial<ImproveQueueFilters>) => void;
  onClearFilters?: () => void;
  onToggleAutomation?: () => void;
  onTriggerToggle?: (id: ImproveTriggerId) => void;
  onTriggerThresholdChange?: (id: ImproveTriggerId, value: number) => void;
  onSelectRecommendation?: (id: string) => void;
  onRecommendationAction?: (action: ImproveQueueAction) => void;
}) {
  const counts = useMemo(() => countImproveStatuses(recommendations), [recommendations]);
  const filtered = useMemo(() => filterImproveRecommendations(recommendations, filters), [recommendations, filters]);
  const groups = useMemo(() => groupImproveRecommendations(filtered), [filtered]);
  const selected = filtered.find((item) => item.id === selectedRecommendationId) ?? filtered[0] ?? null;
  const hasActiveFilters = filters.status !== DEFAULT_IMPROVE_FILTERS.status
    || filters.trigger !== "all"
    || filters.severity !== "all"
    || filters.confidence !== "all"
    || filters.suppression !== DEFAULT_IMPROVE_FILTERS.suppression
    || Boolean(filters.query.trim());
  const criticalCount = recommendations.filter((item) => item.severity === "critical" && item.status === "suggested" && !item.suppressed).length;
  const suppressedCount = recommendations.filter((item) => item.suppressed).length;

  return (
    <div data-improve-queue style={{ ...pageStyle, maxWidth: 1320 }}>
      <PageHeader
        icon={<ShieldCheck size={17} />}
        title="Improve"
        description={`${companyName ?? companyCode} recommendation queue and trigger controls`}
        actions={(
          <button type="button" onClick={onToggleAutomation} style={buttonStyle(automationPaused ? "primary" : "default")}>
            {automationPaused ? <Play size={13} /> : <Pause size={13} />}
            {automationPaused ? "Resume automation" : "Pause automation"}
          </button>
        )}
      />

      <div className="grid gap-3 md:grid-cols-4" style={{ marginBottom: space.xl }}>
        <div style={{ borderRadius: radius.md, border: `0.5px solid ${color.border}`, padding: space.md }}>
          <MetricCell label="Open suggestions" value={counts.suggested + counts["needs-more-evidence"]} />
        </div>
        <div style={{ borderRadius: radius.md, border: `0.5px solid ${color.border}`, padding: space.md }}>
          <MetricCell label="Accepted for approval" value={counts["accepted-for-approval"]} />
        </div>
        <div style={{ borderRadius: radius.md, border: `0.5px solid ${color.border}`, padding: space.md }}>
          <MetricCell label="Suppressed" value={suppressedCount} />
        </div>
        <div style={{ borderRadius: radius.md, border: `0.5px solid ${criticalCount > 0 ? color.negative : color.border}`, padding: space.md }}>
          <MetricCell label="Critical active" value={criticalCount} />
        </div>
      </div>

      <Section
        title="Trigger Controls"
        card={false}
        trailing={automationPaused ? "Company automation paused" : "Company automation active"}
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {triggerControls.map((control) => (
            <TriggerControlRow
              key={control.id}
              control={control}
              onToggle={onTriggerToggle}
              onThresholdChange={onTriggerThresholdChange}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Recent Trigger Firings"
        card={false}
        trailing={`${triggerFirings.length} recent decisions`}
      >
        <RecentTriggerFirings firings={triggerFirings} />
      </Section>

      <Section
        title="Recommendation Queue"
        card={false}
        trailing={loading ? "Loading" : `${filtered.length} shown / ${recommendations.length} total`}
      >
        <div style={{ display: "grid", gap: space.md }}>
          <div role="tablist" aria-label="Recommendation status" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
            {(["all", ...IMPROVE_STATUS_ORDER] as const).map((status) => {
              const active = filters.status === status;
              return (
                <button
                  key={status}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onFilterChange?.({ status })}
                  style={{
                    ...buttonStyle(active ? "primary" : "default"),
                    flex: "0 0 auto",
                  }}
                >
                  {prettyToken(status)}
                  <span style={{ fontFamily: font.mono }}>{counts[status]}</span>
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: space.md,
              borderRadius: radius.md,
              border: `0.5px solid ${color.border}`,
              background: color.surfaceElevated,
              padding: space.lg,
            }}
          >
            <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: T.caption.size, color: color.textMuted }}>Search</span>
              <span style={{ position: "relative", minWidth: 0 }}>
                <Search size={14} style={{ position: "absolute", left: 9, top: 10, color: color.textMuted }} />
                <input
                  value={filters.query}
                  onChange={(event) => onFilterChange?.({ query: event.target.value })}
                  placeholder="Agent, trigger, scope"
                  style={{ ...selectStyle(), paddingLeft: 30 }}
                />
              </span>
            </label>
            <FilterSelect label="Trigger" value={filters.trigger} onChange={(value) => onFilterChange?.({ trigger: value as ImproveQueueFilters["trigger"] })}>
              <option value="all">All triggers</option>
              {IMPROVE_TRIGGER_OPTIONS.map((trigger) => (
                <option key={trigger} value={trigger}>{prettyToken(trigger)}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Severity" value={filters.severity} onChange={(value) => onFilterChange?.({ severity: value as ImproveQueueFilters["severity"] })}>
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </FilterSelect>
            <FilterSelect label="Confidence" value={filters.confidence} onChange={(value) => onFilterChange?.({ confidence: value as ImproveQueueFilters["confidence"] })}>
              <option value="all">All confidence</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </FilterSelect>
            <FilterSelect label="Suppression" value={filters.suppression} onChange={(value) => onFilterChange?.({ suppression: value as ImproveQueueFilters["suppression"] })}>
              <option value="active">Hide suppressed</option>
              <option value="suppressed">Suppressed only</option>
              <option value="all">All records</option>
            </FilterSelect>
            <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
              <button type="button" onClick={onClearFilters} disabled={!hasActiveFilters} style={{ ...buttonStyle(), opacity: hasActiveFilters ? 1 : 0.5 }}>
                <Filter size={13} />
                Clear
              </button>
            </div>
          </div>

          {error ? (
            <div style={{ color: color.negative, background: color.negativeSoft, border: `0.5px solid ${color.negative}`, borderRadius: radius.md, padding: space.lg }}>
              {error}
            </div>
          ) : loading ? (
            <div style={{ display: "grid", placeItems: "center", minHeight: 220, color: color.textMuted }}>
              <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]" style={{ alignItems: "start" }}>
              <div style={{ display: "grid", gap: space.md, minWidth: 0 }}>
                {groups.length === 0 ? (
                  <div style={{ borderRadius: radius.md, border: `0.5px dashed ${color.border}`, padding: space.xxl }}>
                    <EmptyState
                      icon={<Archive size={22} />}
                      title={hasActiveFilters ? "No recommendations match these filters." : "No improvement recommendations yet."}
                      description={hasActiveFilters ? "Clear or broaden the queue filters." : "Trigger-created recommendations will appear here before approval."}
                    />
                  </div>
                ) : groups.map((group) => (
                  <section
                    key={group.label}
                    data-improve-group={group.label}
                    style={{
                      borderRadius: radius.md,
                      border: `0.5px solid ${color.border}`,
                      background: "transparent",
                      padding: space.md,
                      display: "grid",
                      gap: space.sm,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, color: color.textMuted, fontSize: T.caption.size, textTransform: "uppercase", letterSpacing: T.sectionLabel.letterSpacing }}>
                          Grouped Recommendations
                        </p>
                        <h2 style={{ margin: "3px 0 0", color: color.text, fontSize: T.cardTitle.size, fontWeight: 700, overflowWrap: "anywhere" }}>
                          {group.label}
                        </h2>
                      </div>
                      <span style={{ color: color.textMuted, fontSize: T.caption.size, whiteSpace: "nowrap" }} suppressHydrationWarning>{group.items.length} items</span>
                    </div>
                    <div style={{ display: "grid", gap: space.sm }}>
                      {group.items.map((recommendation) => (
                        <RecommendationRow
                          key={recommendation.id}
                          recommendation={recommendation}
                          active={selected?.id === recommendation.id}
                          onSelect={(id) => onSelectRecommendation?.(id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <RecommendationDetail recommendation={selected} onAction={onRecommendationAction} />
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

export function ImproveQueueView({ companySlug }: { companySlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlFilters = useMemo(() => readImproveFilters(searchParams), [searchParams]);
  const [filters, setLocalFilters] = useState<ImproveQueueFilters>(urlFilters);
  const filtersRef = useRef<ImproveQueueFilters>(urlFilters);
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [automationPaused, setAutomationPaused] = useState(false);
  const [triggerControls, setTriggerControls] = useState<ImproveTriggerControl[]>(() => createSeedImproveTriggerControls());
  const [triggerFirings, setTriggerFirings] = useState<ImproveTriggerFiring[]>(() => createSeedImproveTriggerFirings());
  const [recommendations, setRecommendations] = useState<ImproveRecommendation[]>([]);
  const [usingSeedRecommendations, setUsingSeedRecommendations] = useState(false);
  const [seededCompanyCode, setSeededCompanyCode] = useState("");
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);

  useEffect(() => {
    filtersRef.current = urlFilters;
    setLocalFilters(urlFilters);
  }, [urlFilters]);

  const loadData = useCallback(async (currentCompanyCode: string) => {
    try {
      const dashboard = await getCompanyImprovementDashboard(companySlug);
      if (!dashboard) return;

      setAutomationPaused(dashboard.companyControl.automationPaused);

      const mappedTriggers: ImproveTriggerControl[] = dashboard.triggers.map((trigger) => {
        const firedCount = dashboard.firings.filter((f) => f.triggerKey === trigger.triggerKey).length;
        const recCount = dashboard.recommendations.filter((r) => r.triggerKey === trigger.triggerKey).length;
        const suppCount = dashboard.suppressions.filter((s) => s.triggerKey === trigger.triggerKey).length;

        return {
          id: trigger.triggerKey,
          label: trigger.label,
          description: trigger.description,
          enabled: trigger.enabled,
          thresholdLabel: "Threshold",
          thresholdValue: thresholdValue(trigger.threshold),
          lastFiredAt: trigger.latestFiring?.firedAt ?? null,
          fireCount: firedCount,
          recommendationCount: recCount,
          suppressedCount: suppCount,
        };
      });
      setTriggerControls(mappedTriggers);

      const mappedFirings: ImproveTriggerFiring[] = dashboard.firings.map((firing) => ({
        id: firing.id,
        trigger: firing.triggerKey,
        status: firing.status,
        decisionReason: firing.decisionReason,
        scope: formatImproveScope(firing.scope.type, firing.scope.key),
        recommendationTitle: firing.recommendationTitle,
        suppressionReason: firing.suppressionReason,
        firedAt: firing.firedAt,
      }));
      setTriggerFirings(mappedFirings.length > 0
        ? mappedFirings
        : dashboard.recommendations.length === 0
          ? createSeedImproveTriggerFirings()
          : []);

      const mappedRecs: ImproveRecommendation[] = dashboard.recommendations.map((rec) => {
        const trigger = normalizeImproveTriggerId(rec.triggerKey);
        const evidenceSummaries: OrchestrationImprovementEvidenceSummary[] = Array.isArray(rec.evidence?.summaries)
          ? rec.evidence.summaries
          : [];
        const evidenceLinks = evidenceSummaries.map((evidence, index) => (
          evidenceLinkFromSummary(rec.id, evidence, index)
        ));

        return {
          id: rec.id,
          title: rec.title,
          group: rec.category?.trim() ? prettyToken(rec.category) : prettyToken(trigger),
          status: rec.status,
          trigger,
          severity: rec.severity,
          confidence: rec.confidence,
          scope: formatImproveScope(rec.scope.type, rec.scope.key, rec.scopeLabel),
          scopeType: rec.scope.type,
          scopeKey: rec.scope.key,
          affected: rec.affectedSurfaces?.map((surface) => String(surface.label ?? surface.id ?? "Affected surface")) ?? [],
          rationale: rec.rationale,
          proposedChange: rec.proposedChange,
          originalSuggestion: String(rec.originalRecommendation?.proposedChange ?? ""),
          rollbackNotes: rec.rollbackNotes ?? "",
          evidence: evidenceLinks,
          updatedAt: rec.updatedAt,
          suppressed: !!rec.suppressionId,
          suppressedScope: rec.suppression
            ? formatImproveScope(rec.suppression.scope.type, rec.suppression.scope.key)
            : rec.suppressionScope ?? undefined,
          suppressedUntil: rec.suppressionExpiresAt ?? undefined,
          dismissalCategory: rec.dismissalReason ?? undefined,
          dismissalNote: rec.dismissalNotes ?? undefined,
          approvalDraftId: rec.approvalId ?? undefined,
        };
      });

      if (mappedRecs.length > 0) {
        setUsingSeedRecommendations(false);
        setRecommendations(mappedRecs);
      } else {
        const seeded = createSeedImproveRecommendations(currentCompanyCode);
        setUsingSeedRecommendations(true);
        setRecommendations(seeded);
      }

    } catch (e) {
      console.error(e);
    }
  }, [companySlug]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const companies = await listCompanies();
        if (cancelled) return;
        const current = companies.find((item) => item.slug === companySlug || item.code === companySlug.toUpperCase()) ?? null;
        setCompany(current);
        if (!current) {
          setError("Company not found.");
          setRecommendations([]);
          setUsingSeedRecommendations(false);
          setTriggerFirings([]);
          return;
        }

        if (seededCompanyCode !== current.code) {
          await loadData(current.code);
          setSeededCompanyCode(current.code);
        }
      } catch {
        if (!cancelled) setError("Improve queue could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [companySlug, loadData, seededCompanyCode]);

  const filtered = useMemo(() => filterImproveRecommendations(recommendations, filters), [recommendations, filters]);

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedRecommendationId !== null) setSelectedRecommendationId(null);
      return;
    }

    if (!selectedRecommendationId || !filtered.some((item) => item.id === selectedRecommendationId)) {
      setSelectedRecommendationId(filtered[0].id);
    }
  }, [filtered, selectedRecommendationId]);

  function setFilters(patch: Partial<ImproveQueueFilters>) {
    const nextFilters = { ...filtersRef.current, ...patch };
    filtersRef.current = nextFilters;
    setLocalFilters(nextFilters);
    const next = new URLSearchParams(searchParams.toString());

    if (nextFilters.status === DEFAULT_IMPROVE_FILTERS.status) next.delete("status");
    else next.set("status", nextFilters.status);

    if (nextFilters.trigger === "all") next.delete("trigger");
    else next.set("trigger", nextFilters.trigger);

    if (nextFilters.severity === "all") next.delete("severity");
    else next.set("severity", nextFilters.severity);

    if (nextFilters.confidence === "all") next.delete("confidence");
    else next.set("confidence", nextFilters.confidence);

    if (nextFilters.suppression === DEFAULT_IMPROVE_FILTERS.suppression) next.delete("suppression");
    else next.set("suppression", nextFilters.suppression);

    if (nextFilters.query.trim()) next.set("q", nextFilters.query.trim());
    else next.delete("q");

    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearFilters() {
    filtersRef.current = DEFAULT_IMPROVE_FILTERS;
    setLocalFilters(DEFAULT_IMPROVE_FILTERS);
    router.replace(pathname, { scroll: false });
  }

  async function handleToggleAutomation() {
    const nextPaused = !automationPaused;
    setAutomationPaused(nextPaused);
    try {
      await setCompanyImprovementPaused(companySlug, { paused: nextPaused, reason: "Operator toggled" });
    } catch {
      // revert on error
      setAutomationPaused(!nextPaused);
    }
  }

  async function handleTriggerToggle(id: ImproveTriggerId) {
    const target = triggerControls.find((c) => c.id === id);
    if (!target) return;
    const nextEnabled = !target.enabled;
    setTriggerControls((controls) => controls.map((control) => (
      control.id === id ? { ...control, enabled: nextEnabled } : control
    )));
    try {
      await setCompanyImprovementTriggerEnabled(companySlug, { triggerKey: id, enabled: nextEnabled });
    } catch {
      setTriggerControls((controls) => controls.map((control) => (
        control.id === id ? { ...control, enabled: !nextEnabled } : control
      )));
    }
  }

  function handleTriggerThresholdChange(id: ImproveTriggerId, value: number) {
    if (!Number.isFinite(value) || value < 1) return;
    setTriggerControls((controls) => controls.map((control) => (
      control.id === id ? { ...control, thresholdValue: value } : control
    )));
    // (We could persist threshold here but the API needs `threshold: Record<string, unknown>`)
  }

  async function handleRecommendationAction(action: ImproveQueueAction) {
    setRecommendations((current) => applyImproveQueueAction(current, action));
    if (usingSeedRecommendations) return;

    try {
      if (action.type === "accept") {
        await acceptCompanyImproveRecommendationForApproval(companySlug, action.id);
      } else if (action.type === "dismiss") {
        await dismissCompanyImprovementRecommendation(companySlug, {
          recommendationId: action.id,
          reason: action.category,
          notes: action.note,
        });
      } else if (action.type === "suppress") {
        const target = recommendations.find((r) => r.id === action.id);
        await suppressCompanyImproveRecommendation(
          companySlug,
          action.id,
          buildImproveRecommendationSuppressionInput(target),
        );
      } else if (action.type === "edit") {
        const apiPatch = {
          proposedChange: action.patch.proposedChange,
          rationale: action.patch.rationale,
          rollbackNotes: action.patch.rollbackNotes,
        };
        await editCompanyImproveRecommendation(companySlug, action.id, apiPatch);
      }
    } catch (e) {
      console.error(e);
      // We could revert on failure
    }
  }

  return (
    <ImproveQueueSurface
      companyCode={company?.code ?? companySlug.toUpperCase()}
      companyName={company?.name}
      loading={loading}
      error={error}
      recommendations={recommendations}
      triggerControls={triggerControls}
      triggerFirings={triggerFirings}
      filters={filters}
      automationPaused={automationPaused}
      selectedRecommendationId={selectedRecommendationId}
      onFilterChange={setFilters}
      onClearFilters={clearFilters}
      onToggleAutomation={handleToggleAutomation}
      onTriggerToggle={handleTriggerToggle}
      onTriggerThresholdChange={handleTriggerThresholdChange}
      onSelectRecommendation={setSelectedRecommendationId}
      onRecommendationAction={handleRecommendationAction}
    />
  );
}
