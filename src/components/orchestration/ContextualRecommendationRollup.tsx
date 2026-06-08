"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { AlertTriangle, ArrowRight, Lightbulb } from "lucide-react";

import { getCompanyImprovementDashboard } from "@/lib/orchestration/client";
import type {
  OrchestrationImprovementRecommendation,
  OrchestrationImprovementScope,
} from "@/lib/orchestration/types";
import { color, radius, space, type as T } from "@/lib/ui/tokens";

export type ContextualRecommendationSeverity = "low" | "medium" | "high" | "critical";

export type ContextualRecommendationCounts = {
  total: number;
  critical: number;
  high: number;
  medium?: number;
  low?: number;
  acceptedForApproval?: number;
};

export type ContextualRecommendationNotable = {
  id: string;
  title: string;
  severity: ContextualRecommendationSeverity;
  href?: string;
};

export type ContextualRecommendationContextIds = Record<string, string | number | boolean | null | undefined>;

export type ContextualRecommendationSurface =
  | "run-trace"
  | "evals"
  | "template"
  | "team"
  | "goal"
  | "sprint"
  | "task";

const surfaceLabels: Record<ContextualRecommendationSurface, string> = {
  "run-trace": "Run Trace",
  evals: "Evals",
  template: "Template",
  team: "Team",
  goal: "Goal",
  sprint: "Sprint",
  task: "Task",
};

const severityTone: Record<"critical" | "high", { color: string; bg: string; border: string }> = {
  critical: {
    color: color.negative,
    bg: color.negativeSoft,
    border: "rgba(239,68,68,0.28)",
  },
  high: {
    color: color.warning,
    bg: color.warningSoft,
    border: "rgba(245,158,11,0.28)",
  },
};

const activeStatuses = new Set<string>([
  "suggested",
  "needs-more-evidence",
  "needs_more_evidence",
  "accepted-for-approval",
  "accepted_for_approval",
]);

function safeCount(value: number | undefined): number {
  return Math.max(0, Number.isFinite(value ?? 0) ? Number(value ?? 0) : 0);
}

function countLabel(count: number, noun: string): string {
  if (noun === "critical" || noun === "high") return `${count} ${noun}`;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function normalizeCounts(counts?: Partial<ContextualRecommendationCounts>): ContextualRecommendationCounts {
  return {
    total: safeCount(counts?.total),
    critical: safeCount(counts?.critical),
    high: safeCount(counts?.high),
    medium: safeCount(counts?.medium),
    low: safeCount(counts?.low),
    acceptedForApproval: safeCount(counts?.acceptedForApproval),
  };
}

function severityLabel(severity: "critical" | "high"): string {
  return severity === "critical" ? "Critical" : "High";
}

function appendRecommendationQuery(href: string, recommendationId: string): string {
  const joiner = href.includes("?") ? "&" : "?";
  return `${href}${joiner}recommendation=${encodeURIComponent(recommendationId)}`;
}

function collectSearchStrings(value: unknown, output = new Set<string>(), depth = 0): Set<string> {
  if (depth > 5 || value === null || value === undefined) return output;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const normalized = String(value).trim().toLowerCase();
    if (normalized) output.add(normalized);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchStrings(item, output, depth + 1);
    return output;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.trim().toLowerCase();
      if (normalizedKey) output.add(normalizedKey);
      collectSearchStrings(item, output, depth + 1);
    }
  }
  return output;
}

function contextNeedles(contextIds?: ContextualRecommendationContextIds): string[] {
  return Object.values(contextIds ?? {})
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
}

function matchesNeedle(haystack: Set<string>, needle: string): boolean {
  if (haystack.has(needle)) return true;
  if (needle.length < 5) return false;
  return Array.from(haystack).some((value) => value.includes(needle));
}

function recommendationMatchesContext(
  recommendation: OrchestrationImprovementRecommendation,
  scope?: OrchestrationImprovementScope,
  contextIds?: ContextualRecommendationContextIds,
): boolean {
  if (scope && recommendation.scope.type === scope.type && recommendation.scope.key === scope.key) {
    return true;
  }

  const needles = contextNeedles(contextIds);
  if (needles.length === 0) {
    return !scope;
  }

  const haystack = collectSearchStrings({
    id: recommendation.id,
    triggerKey: recommendation.triggerKey,
    scope: recommendation.scope,
    title: recommendation.title,
    rationale: recommendation.rationale,
    proposedChange: recommendation.proposedChange,
    evidence: recommendation.evidence,
    originalRecommendation: recommendation.originalRecommendation,
    currentRecommendation: recommendation.currentRecommendation,
  });

  return needles.some((needle) => matchesNeedle(haystack, needle));
}

function countsFromRecommendations(recommendations: OrchestrationImprovementRecommendation[]): ContextualRecommendationCounts {
  return recommendations.reduce<ContextualRecommendationCounts>((acc, item) => {
    acc.total += 1;
    if (item.severity === "critical") acc.critical += 1;
    else if (item.severity === "high") acc.high += 1;
    else if (item.severity === "medium") acc.medium = safeCount(acc.medium) + 1;
    else acc.low = safeCount(acc.low) + 1;
    const normalizedStatus = String(item.status);
    if (normalizedStatus === "accepted-for-approval" || normalizedStatus === "accepted_for_approval") {
      acc.acceptedForApproval = safeCount(acc.acceptedForApproval) + 1;
    }
    return acc;
  }, emptyContextualRecommendationCounts());
}

function notableFromRecommendation(
  recommendation: OrchestrationImprovementRecommendation,
  improveHref: string,
): ContextualRecommendationNotable {
  return {
    id: recommendation.id,
    title: recommendation.title,
    severity: recommendation.severity,
    href: appendRecommendationQuery(improveHref, recommendation.id),
  };
}

export function emptyContextualRecommendationCounts(): ContextualRecommendationCounts {
  return {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    acceptedForApproval: 0,
  };
}

export function ContextualRecommendationRollup({
  surface,
  improveHref,
  counts,
  notables = [],
  contextLabel,
  companyKey,
  scope,
  contextIds,
  style,
}: {
  surface: ContextualRecommendationSurface;
  improveHref: string;
  counts?: Partial<ContextualRecommendationCounts>;
  notables?: ContextualRecommendationNotable[];
  contextLabel?: string;
  companyKey?: string | null;
  scope?: OrchestrationImprovementScope;
  contextIds?: ContextualRecommendationContextIds;
  style?: CSSProperties;
}) {
  const [dashboardState, setDashboardState] = useState<{
    companyKey: string;
    recommendations: OrchestrationImprovementRecommendation[];
  } | null>(null);

  useEffect(() => {
    if (!companyKey) return;

    let cancelled = false;
    getCompanyImprovementDashboard(companyKey)
      .then((dashboard) => {
        if (!cancelled) {
          setDashboardState({
            companyKey,
            recommendations: dashboard?.recommendations ?? [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDashboardState({
            companyKey,
            recommendations: [],
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [companyKey]);

  const dashboardRecommendations = dashboardState && dashboardState.companyKey === companyKey
    ? dashboardState.recommendations
    : null;

  const contextualRecommendations = useMemo(() => {
    if (!dashboardRecommendations) return null;
    return dashboardRecommendations.filter((item) => (
      activeStatuses.has(item.status)
      && recommendationMatchesContext(item, scope, contextIds)
    ));
  }, [contextIds, dashboardRecommendations, scope]);

  const normalizedCounts = normalizeCounts(
    contextualRecommendations ? countsFromRecommendations(contextualRecommendations) : counts,
  );
  const sourceNotables = contextualRecommendations
    ? contextualRecommendations.map((item) => notableFromRecommendation(item, improveHref))
    : notables;
  const visibleNotables = sourceNotables
    .filter((item): item is ContextualRecommendationNotable & { severity: "critical" | "high" } => (
      item.severity === "critical" || item.severity === "high"
    ))
    .slice(0, 3);
  const highCriticalCount = normalizedCounts.critical + normalizedCounts.high;
  const surfaceLabel = contextLabel ?? surfaceLabels[surface];

  return (
    <section
      data-contextual-recommendations
      data-recommendation-surface={surface}
      aria-label={`${surfaceLabel} recommendations`}
      style={{
        borderRadius: radius.md,
        border: `0.5px solid ${highCriticalCount > 0 ? "rgba(245,158,11,0.34)" : color.border}`,
        background: highCriticalCount > 0 ? "rgba(245,158,11,0.055)" : color.surface,
        padding: space.lg,
        display: "grid",
        gap: space.md,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.md }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: space.sm, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: radius.md,
              color: highCriticalCount > 0 ? color.warning : color.textMuted,
              background: highCriticalCount > 0 ? color.warningSoft : "rgba(255,255,255,0.04)",
              flex: "0 0 auto",
            }}
          >
            {highCriticalCount > 0 ? <AlertTriangle size={15} /> : <Lightbulb size={15} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, color: color.text, fontSize: T.body.size, fontWeight: 650, letterSpacing: 0 }}>
              Contextual recommendations
            </h2>
            <p style={{ margin: "4px 0 0", color: color.textMuted, fontSize: T.caption.size, lineHeight: 1.45 }}>
              {surfaceLabel}
            </p>
          </div>
        </div>
        <Link
          href={improveHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: color.accent,
            fontSize: T.caption.size,
            fontWeight: 650,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Open in Improve
          <ArrowRight size={12} />
        </Link>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <CountChip label={`${normalizedCounts.total} open`} />
        <CountChip label={countLabel(normalizedCounts.critical, "critical")} tone="critical" />
        <CountChip label={countLabel(normalizedCounts.high, "high")} tone="high" />
        {(normalizedCounts.acceptedForApproval ?? 0) > 0 ? (
          <CountChip label={`${normalizedCounts.acceptedForApproval ?? 0} accepted`} tone="accepted" />
        ) : null}
      </div>

      {visibleNotables.length > 0 ? (
        <div style={{ display: "grid", gap: 7 }}>
          {visibleNotables.map((item) => {
            const tone = severityTone[item.severity];
            const content = (
              <>
                <span
                  style={{
                    color: tone.color,
                    background: tone.bg,
                    border: `0.5px solid ${tone.border}`,
                    borderRadius: radius.sm,
                    padding: "1px 6px",
                    fontSize: 10,
                    fontWeight: 750,
                    textTransform: "uppercase",
                    letterSpacing: 0,
                    flex: "0 0 auto",
                  }}
                >
                  {severityLabel(item.severity)}
                </span>
                <span style={{ minWidth: 0, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
                  {item.title}
                </span>
              </>
            );

            return item.href ? (
              <Link
                key={item.id}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                  textDecoration: "none",
                }}
              >
                {content}
              </Link>
            ) : (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ margin: 0, color: color.textMuted, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
          No high or critical recommendations in this context.
        </p>
      )}
    </section>
  );
}

function CountChip({
  label,
  tone,
}: {
  label: string;
  tone?: "critical" | "high" | "accepted";
}) {
  const toneStyle = tone === "accepted"
    ? { color: color.positive, bg: color.positiveSoft, border: "rgba(34,197,94,0.28)" }
    : tone ? severityTone[tone] : null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 22,
        borderRadius: radius.full,
        border: `0.5px solid ${toneStyle?.border ?? color.border}`,
        background: toneStyle?.bg ?? "rgba(255,255,255,0.035)",
        color: toneStyle?.color ?? color.textSecondary,
        padding: "2px 8px",
        fontSize: T.caption.size,
        fontWeight: 650,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
