"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronRight, GitBranch, Lightbulb, ShieldAlert, Terminal, UserPlus } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { formatAge } from "@/components/orchestration/ui";
import { listCompanies, listCompanyApprovals } from "@/lib/orchestration/client";
import { buildApprovalDetailPath, buildCanonicalCompanyPath } from "@/lib/orchestration/route-paths";
import type {
  ApprovalStatus,
  ApprovalType,
  OrchestrationApproval,
  OrchestrationCompany,
} from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

type QueueView = "pending" | "all";

const P = {
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
  ghost: tokens.muted,
  line: tokens.cardBorder,
  lineSoft: tokens.cardBorder,
  card: tokens.surface,
  cardHover: tokens.surfaceHover,
  page: tokens.bg,
};

const ACTIONABLE_STATUSES = new Set<ApprovalStatus>(["pending", "revision_requested"]);

function approvalTitle(approval: OrchestrationApproval): string {
  const { payload, type } = approval;
  if (type === "hire_agent") {
    const agentName =
      (typeof payload.agentName === "string" && payload.agentName) ||
      (typeof payload.name === "string" && payload.name);
    return agentName ? `Hire Agent: ${agentName}` : "Hire Agent";
  }
  if (type === "approve_ceo_strategy") {
    return typeof payload.title === "string" ? payload.title : "CEO Strategy Approval";
  }
  if (type === "budget_override_required") {
    return typeof payload.scopeName === "string" ? `Budget Override: ${payload.scopeName}` : "Budget Override Required";
  }
  if (type === "provider_switch") {
    const agentName = typeof payload.agentName === "string"
      ? payload.agentName
      : typeof payload.agentId === "string"
        ? payload.agentId
        : "Agent";
    const target = typeof payload.targetProvider === "string" ? payload.targetProvider : "runtime";
    return `Provider Switch: ${agentName} to ${target}`;
  }
  if (type === "protected_runtime_command") {
    return "Protected Runtime Command";
  }
  return "Approval Request";
}

function approvalSummary(approval: OrchestrationApproval): string | null {
  const { payload, type } = approval;
  if (type === "hire_agent") {
    const role =
      (typeof payload.role === "string" && payload.role) ||
      (typeof payload.desiredRole === "string" && payload.desiredRole);
    if (role) return role;
    if (typeof payload.model === "string" && payload.model) return `Model ${payload.model}`;
    if (typeof payload.reason === "string" && payload.reason) return payload.reason;
  }
  if (type === "approve_ceo_strategy") {
    if (typeof payload.summary === "string" && payload.summary) return payload.summary;
    if (typeof payload.description === "string" && payload.description) return payload.description;
  }
  if (type === "budget_override_required") {
    if (typeof payload.reason === "string" && payload.reason) return payload.reason;
    if (typeof payload.scopeName === "string" && payload.scopeName) return `Blocked scope: ${payload.scopeName}`;
  }
  if (type === "provider_switch") {
    const current = typeof payload.currentProvider === "string" ? payload.currentProvider : "current provider";
    const target = typeof payload.targetProvider === "string" ? payload.targetProvider : "target provider";
    return `Switch from ${current} to ${target}`;
  }
  if (type === "protected_runtime_command") {
    if (typeof payload.command === "string" && payload.command) return payload.command;
    if (typeof payload.reason === "string" && payload.reason) return payload.reason;
  }
  return null;
}

function approvalTypeLabel(type: ApprovalType): string {
  switch (type) {
    case "hire_agent":
      return "Hire request";
    case "approve_ceo_strategy":
      return "Strategy approval";
    case "budget_override_required":
      return "Budget override";
    case "provider_switch":
      return "Provider switch";
    case "protected_runtime_command":
      return "Protected command";
  }
}

function typeIcon(type: ApprovalType) {
  switch (type) {
    case "hire_agent":
      return <UserPlus size={16} color={P.textSec} />;
    case "approve_ceo_strategy":
      return <Lightbulb size={16} color={P.textSec} />;
    case "budget_override_required":
      return <ShieldAlert size={16} color={P.textSec} />;
    case "provider_switch":
      return <GitBranch size={16} color={P.textSec} />;
    case "protected_runtime_command":
      return <Terminal size={16} color={P.textSec} />;
  }
}

function statusBadge(status: ApprovalStatus) {
  const styles: Record<ApprovalStatus, { bg: string; text: string; border: string }> = {
    pending: {
      bg: tokens.warnDim,
      text: tokens.warn,
      border: "color-mix(in srgb, var(--warning) 30%, var(--border))",
    },
    revision_requested: {
      bg: tokens.errorDim,
      text: tokens.error,
      border: "color-mix(in srgb, var(--negative) 30%, var(--border))",
    },
    approved: {
      bg: tokens.successDim,
      text: tokens.success,
      border: "color-mix(in srgb, var(--positive) 30%, var(--border))",
    },
    rejected: {
      bg: tokens.errorDim,
      text: tokens.error,
      border: "color-mix(in srgb, var(--negative) 30%, var(--border))",
    },
    cancelled: {
      bg: P.cardHover,
      text: P.textSec,
      border: P.line,
    },
  };

  const tone = styles[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: "999px",
        border: `0.5px solid ${tone.border}`,
        background: tone.bg,
        color: tone.text,
        fontSize: "11px",
        fontWeight: 600,
        textTransform: "capitalize",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function truncate(value: string, max = 140): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export function ApprovalsQueuePage({ view, initialCompanyCode }: { view: QueueView; initialCompanyCode?: string | null }) {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [approvals, setApprovals] = useState<OrchestrationApproval[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, approvalRows] = await Promise.all([
          listCompanies(),
          listCompanyApprovals({ companySlug: slug }),
        ]);
        if (cancelled) return;
        setCompany(companyRows.find((row) => row.slug === slug || row.code === slug.toUpperCase()) ?? null);
        setApprovals(approvalRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const pendingCount = useMemo(
    () => approvals.filter((approval) => ACTIONABLE_STATUSES.has(approval.status)).length,
    [approvals]
  );
  const approvedCount = useMemo(
    () => approvals.filter((approval) => approval.status === "approved").length,
    [approvals]
  );
  const closedCount = useMemo(
    () => approvals.filter((approval) => !ACTIONABLE_STATUSES.has(approval.status)).length,
    [approvals]
  );
  const visibleApprovals = useMemo(() => {
    if (view === "all") return approvals;
    return approvals.filter((approval) => ACTIONABLE_STATUSES.has(approval.status));
  }, [approvals, view]);

  const queueTitle = view === "pending" ? "Pending approvals" : "All approvals";
  const queueDescription =
    view === "pending"
      ? "Requests waiting on operator review or revision follow-up."
      : "Full approval history for this company, including resolved items.";
  const companyCode = company?.code ?? initialCompanyCode?.trim() ?? slug;

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved." href="/" />;
  }

  return (
    <div style={{ padding: "16px 20px", color: P.text, fontSize: 13, background: P.page, minHeight: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: P.text }}>
            {queueTitle}
          </h1>
          <p style={{ margin: 0, color: P.muted, maxWidth: 620 }}>{queueDescription}</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <QueueTab
            href={buildCanonicalCompanyPath(companyCode, "/approvals/pending")}
            label="Pending"
            active={view === "pending"}
            count={pendingCount}
          />
          <QueueTab
            href={buildCanonicalCompanyPath(companyCode, "/approvals/all")}
            label="All"
            active={view === "all"}
            count={approvals.length}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <SummaryCard label="Awaiting decision" value={pendingCount} detail="Pending or revision requested" />
        <SummaryCard label="Approved" value={approvedCount} detail="Resolved positively" />
        <SummaryCard label="Closed" value={closedCount} detail="Approved, rejected, or cancelled" />
      </div>

      <section
        style={{
          borderRadius: 14,
          border: `0.5px solid ${P.line}`,
          background: P.card,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: `0.5px solid ${P.lineSoft}`,
            background: P.cardHover,
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: P.textSec }}>{queueTitle}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: P.ghost }}>
              {visibleApprovals.length} approval{visibleApprovals.length === 1 ? "" : "s"} visible
            </p>
          </div>
          {view === "pending" ? (
            <p style={{ margin: 0, fontSize: 12, color: P.ghost }}>
              Use All to review resolved decisions.
            </p>
          ) : null}
        </div>

        {loading ? (
          <div style={{ padding: "32px 18px", color: P.ghost, textAlign: "center" }}>Loading approvals…</div>
        ) : visibleApprovals.length === 0 ? (
          <EmptyState view={view} />
        ) : (
          visibleApprovals.map((approval) => {
            const summary = approvalSummary(approval);
            const href = buildApprovalDetailPath({
              companyCode: company?.code,
              companySlug: slug,
              approvalId: approval.id,
              linkedTaskKey: approval.linkedTaskKey,
            });
            return (
              <Link
                key={approval.id}
                href={href}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "16px",
                  textDecoration: "none",
                  borderBottom: `0.5px solid ${P.lineSoft}`,
                  transition: "background 120ms ease, border-color 120ms ease",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = P.cardHover;
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `0.5px solid ${P.line}`,
                    background: P.cardHover,
                  }}
                >
                  {typeIcon(approval.type)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: P.text }}>{approvalTitle(approval)}</span>
                    {statusBadge(approval.status)}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: summary ? 8 : 0, fontSize: 12, color: P.ghost }}>
                    <span>{approvalTypeLabel(approval.type)}</span>
                    <span>•</span>
                    <span>Requested by {approval.requestedByAgentName ?? "System"}</span>
                    {approval.approverAgentName ? (
                      <>
                        <span>•</span>
                        <span>Routed to {approval.approverAgentName}</span>
                      </>
                    ) : null}
                    <span>•</span>
                    <span>{formatAge(approval.createdAt)} ago</span>
                    {approval.linkedTaskId ? (
                      <>
                        <span>•</span>
                        <span>Task {approval.linkedTaskId.slice(0, 8).toUpperCase()}</span>
                      </>
                    ) : null}
                  </div>

                  {summary ? (
                    <p style={{ margin: 0, fontSize: 13, color: P.muted, whiteSpace: "pre-wrap" }}>
                      {truncate(summary)}
                    </p>
                  ) : null}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, color: P.ghost, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Open</span>
                  <ChevronRight size={14} />
                </div>
              </Link>
            );
          })
        )}
      </section>
    </div>
  );
}

function QueueTab({
  href,
  label,
  active,
  count,
}: {
  href: string;
  label: string;
  active: boolean;
  count: number;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 10,
        border: active ? `0.5px solid ${tokens.accent}` : `0.5px solid ${P.line}`,
        background: active ? tokens.accentSoft : P.card,
        color: active ? tokens.accent : P.textSec,
        textDecoration: "none",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span>{label}</span>
      <span
        style={{
          display: "inline-flex",
          minWidth: 20,
          justifyContent: "center",
          padding: "1px 6px",
          borderRadius: 999,
          background: active ? tokens.accentSoft : P.cardHover,
          color: active ? tokens.accent : P.textSec,
          fontSize: 11,
        }}
      >
        {count}
      </span>
    </Link>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: `0.5px solid ${P.line}`,
        background: P.card,
        padding: "14px 16px",
      }}
    >
      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: P.ghost }}>
        {label}
      </p>
      <p style={{ margin: "10px 0 4px", fontSize: 26, fontWeight: 600, color: P.text }}>{value}</p>
      <p style={{ margin: 0, fontSize: 12, color: P.muted }}>{detail}</p>
    </div>
  );
}

function EmptyState({ view }: { view: QueueView }) {
  return (
    <div style={{ padding: "42px 18px", textAlign: "center" }}>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: P.textSec }}>
        {view === "pending" ? "No approvals waiting." : "No approvals recorded yet."}
      </p>
      <p style={{ margin: "8px auto 0", maxWidth: 460, fontSize: 13, color: P.ghost }}>
        {view === "pending"
          ? "New approval requests will appear here when operators need to review a hire, strategy decision, or budget override."
          : "When this company creates approval requests, they will appear here with their current status and decision history."}
      </p>
    </div>
  );
}
