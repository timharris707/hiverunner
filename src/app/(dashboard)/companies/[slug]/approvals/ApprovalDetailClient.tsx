"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, GitBranch, Lightbulb, ShieldAlert, Terminal, UserPlus } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { formatAge } from "@/components/orchestration/ui";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";
import {
  getApprovalDetail,
  approveApproval,
  rejectApproval,
  requestApprovalRevision,
  resubmitApproval,
  addApprovalComment,
} from "@/lib/orchestration/client";
import type { OrchestrationApproval, ApprovalType } from "@/lib/orchestration/types";

function approvalLabel(type: ApprovalType, payload: Record<string, unknown>): string {
  switch (type) {
    case "hire_agent":
      return `Hire Agent: ${
        typeof payload.agentName === "string"
          ? payload.agentName
          : typeof payload.name === "string"
            ? payload.name
            : "Unknown"
      }`;
    case "approve_ceo_strategy":
      return typeof payload.title === "string" ? payload.title : "CEO Strategy Approval";
    case "budget_override_required":
      return typeof payload.scopeName === "string" ? `Budget Override: ${payload.scopeName}` : "Budget Override Required";
    case "provider_switch": {
      const agentName = typeof payload.agentName === "string"
        ? payload.agentName
        : typeof payload.agentId === "string"
          ? payload.agentId
          : "Agent";
      const target = typeof payload.targetProvider === "string" ? payload.targetProvider : "runtime";
      return `Provider Switch: ${agentName} to ${target}`;
    }
    case "protected_runtime_command":
      return "Protected Runtime Command";
    default:
      return "Approval Request";
  }
}

function typeIcon(type: ApprovalType) {
  switch (type) {
    case "hire_agent": return <UserPlus size={20} color="var(--text-secondary)" />;
    case "approve_ceo_strategy": return <Lightbulb size={20} color="var(--text-secondary)" />;
    case "budget_override_required": return <ShieldAlert size={20} color="var(--text-secondary)" />;
    case "provider_switch": return <GitBranch size={20} color="var(--text-secondary)" />;
    case "protected_runtime_command": return <Terminal size={20} color="var(--text-secondary)" />;
  }
}

function statusBadge(status: string) {
  const colors: Record<string, { bg: string; text: string }> = {
    pending: { bg: "var(--warning-soft)", text: "var(--warning)" },
    revision_requested: { bg: "var(--info-soft)", text: "var(--info)" },
    approved: { bg: "var(--positive-soft)", text: "var(--positive)" },
    rejected: { bg: "var(--negative-soft)", text: "var(--negative)" },
    cancelled: { bg: "var(--surface-hover)", text: "var(--text-muted)" },
  };
  const c = colors[status] ?? colors.pending;
  return (
    <span style={{
      display: "inline-flex", padding: "2px 10px", borderRadius: "999px",
      background: c.bg, color: c.text, fontSize: "11px", fontWeight: 500,
      textTransform: "capitalize",
    }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const ACTIONABLE = new Set(["pending", "revision_requested"]);

export default function ApprovalDetailClient({
  slug,
  approvalId,
}: {
  slug: string;
  approvalId: string;
}) {
  const router = useRouter();

  const [approval, setApproval] = useState<OrchestrationApproval | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [showRawPayload, setShowRawPayload] = useState(false);
  const [revisionNoteOpen, setRevisionNoteOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getApprovalDetail(approvalId);
    setApproval(data);
    setLoading(false);
  }, [approvalId]);

  useEffect(() => {
    let cancelled = false;

    void getApprovalDetail(approvalId).then((data) => {
      if (cancelled) return;
      setApproval(data);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [approvalId]);

  const doAction = async (fn: () => Promise<boolean>) => {
    setActing(true);
    await fn();
    await load();
    setActing(false);
  };

  const handleRequestRevision = async () => {
    setActing(true);
    await requestApprovalRevision(approvalId, revisionNote.trim() || undefined);
    setRevisionNoteOpen(false);
    setRevisionNote("");
    await load();
    setActing(false);
  };

  const handlePostComment = async () => {
    if (!commentBody.trim() || postingComment) return;
    setPostingComment(true);
    await addApprovalComment(approvalId, commentBody.trim());
    setCommentBody("");
    await load();
    setPostingComment(false);
  };

  if (loading) {
    return <div style={{ padding: "24px 32px", fontSize: 13, color: "var(--text-muted)" }}>Loading approval...</div>;
  }

  if (!approval) {
    return <CompanyErrorState title="Approval not found" detail="This approval could not be found." href={buildCompanyPath(slug, "/approvals/pending")} />;
  }

  const label = approvalLabel(approval.type, approval.payload);
  const isActionable = ACTIONABLE.has(approval.status) && approval.type !== "budget_override_required";
  const isRevisionRequested = approval.status === "revision_requested";
  const comments = approval.comments ?? [];
  const backHref = buildCompanyPath(
    slug,
    ACTIONABLE.has(approval.status) ? "/approvals/pending" : "/approvals/all"
  );
  const linkedTaskHref = approval.linkedTaskKey
    ? buildCompanyPath(slug, `/tasks/${encodeURIComponent(approval.linkedTaskKey)}`)
    : null;
  const linkedTaskLabel = approval.linkedTaskKey
    ? approval.linkedTaskTitle
      ? `${approval.linkedTaskKey} — ${approval.linkedTaskTitle}`
      : approval.linkedTaskKey
    : approval.linkedTaskTitle;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 800 }}>
      <button
        type="button"
        onClick={() => router.push(backHref)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "none", border: "none", color: "var(--text-secondary)",
          fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 20,
        }}
      >
        <ArrowLeft size={14} /> Back to Approvals
      </button>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: "var(--surface-hover)", display: "flex",
          alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {typeIcon(approval.type)}
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
            {label}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {statusBadge(approval.status)}
            {approval.requestedByAgentName ? (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Requested by {approval.requestedByAgentName}
              </span>
            ) : null}
            {approval.approverAgentName ? (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Routed to {approval.approverAgentName}
              </span>
            ) : null}
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {formatAge(approval.createdAt)} ago
            </span>
          </div>
        </div>
      </div>

      {approval.decisionNote ? (
        <div style={{
          padding: "12px 16px", marginBottom: 16, borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--surface-elevated)",
          fontSize: 13, color: "var(--text-primary)",
        }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>Decision note</p>
          {approval.decisionNote}
        </div>
      ) : null}

      {approval.approverAgentName || approval.approvalRouteReason ? (
        <div style={{
          padding: "12px 16px", marginBottom: 16, borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--surface)",
        }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>Approval owner</p>
          {approval.approverAgentName ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-primary)" }}>
              {approval.approverAgentName}
              {approval.approverAgentRole ? (
                <span style={{ color: "var(--text-muted)" }}> — {approval.approverAgentRole}</span>
              ) : null}
            </p>
          ) : null}
          {approval.approvalRouteReason ? (
            <p style={{ margin: approval.approverAgentName ? "6px 0 0" : 0, fontSize: 12, color: "var(--text-muted)" }}>
              {approval.approvalRouteReason}
            </p>
          ) : null}
        </div>
      ) : null}

      <div style={{
        padding: "16px", marginBottom: 16, borderRadius: 8,
        border: "1px solid var(--border)", background: "var(--surface)",
      }}>
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>Request details</p>
        <PayloadDisplay type={approval.type} payload={approval.payload} />

        <button
          type="button"
          onClick={() => setShowRawPayload(!showRawPayload)}
          style={{
            display: "flex", alignItems: "center", gap: 4, marginTop: 12,
            background: "none", border: "none", color: "var(--text-secondary)", fontSize: 12,
            cursor: "pointer", padding: 0,
          }}
        >
          {showRawPayload ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          See full request
        </button>
        {showRawPayload ? (
          <pre style={{
            marginTop: 8, padding: "10px 12px", borderRadius: 6,
            background: "var(--surface-elevated)", border: "1px solid var(--border)",
            fontSize: 11, color: "var(--text-secondary)", overflow: "auto", maxHeight: 300,
            fontFamily: "var(--font-mono, monospace)", whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {JSON.stringify(approval.payload, null, 2)}
          </pre>
        ) : null}
      </div>

      {approval.linkedTaskId ? (
        <div style={{
          padding: "12px 16px", marginBottom: 16, borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--surface)",
        }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>Linked task</p>
          {linkedTaskLabel ? (
            linkedTaskHref ? (
              <Link
                href={linkedTaskHref}
                style={{
                  fontSize: 13,
                  color: "var(--text-primary)",
                  textDecoration: "none",
                }}
              >
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  {approval.linkedTaskKey ?? linkedTaskLabel}
                </span>
                {approval.linkedTaskKey && approval.linkedTaskTitle ? (
                  <span style={{ fontFamily: "inherit" }}>
                    {" — "}
                    {approval.linkedTaskTitle}
                  </span>
                ) : null}
              </Link>
            ) : (
              <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
                {linkedTaskLabel}
              </span>
            )
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
              Linked task available
            </span>
          )}
        </div>
      ) : null}

      {isActionable ? (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton label="Approve" color="#22c55e" disabled={acting} onClick={() => doAction(() => approveApproval(approvalId))} />
            <ActionButton label="Reject" color="#ef4444" disabled={acting} onClick={() => doAction(() => rejectApproval(approvalId))} />
            {!isRevisionRequested ? (
              <ActionButton label="Request revision" color="#a855f7" disabled={acting} onClick={() => setRevisionNoteOpen(!revisionNoteOpen)} />
            ) : null}
          </div>

          {revisionNoteOpen && !isRevisionRequested ? (
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <textarea
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                placeholder="Add revision note (optional)..."
                rows={2}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--surface-elevated)",
                  fontSize: 13, color: "var(--text-primary)", outline: "none", resize: "vertical",
                }}
              />
              <button
                type="button"
                disabled={acting}
                onClick={() => void handleRequestRevision()}
                style={{
                  padding: "8px 16px", borderRadius: 8, alignSelf: "flex-end",
                  border: "1px solid rgba(168,85,247,0.4)", background: "rgba(168,85,247,0.1)",
                  fontSize: 13, fontWeight: 500, color: "#a855f7",
                  cursor: acting ? "wait" : "pointer",
                  opacity: acting ? 0.5 : 1,
                }}
              >
                Submit revision request
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {isRevisionRequested ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <ActionButton label="Mark resubmitted" color="#78716c" disabled={acting} onClick={() => doAction(() => resubmitApproval(approvalId))} />
        </div>
      ) : null}

      {approval.type === "budget_override_required" && approval.status === "pending" ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
          Resolve this budget stop from the budget controls on the Costs page.
        </p>
      ) : null}

      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Approval ID: <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{approval.id}</span>
        </p>
      </div>

      <div>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>
          Comments ({comments.length})
        </h2>

        {comments.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>No comments yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
            {comments.map((c) => (
              <div key={c.id} style={{
                padding: "10px 14px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--surface-elevated)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                    {c.authorAgentName ?? (c.authorUserId ? "Board" : "System")}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{c.body}</p>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Add a comment..."
            rows={2}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 8,
              border: "1px solid var(--border)", background: "var(--surface-elevated)",
              fontSize: 13, color: "var(--text-primary)", outline: "none", resize: "vertical",
            }}
          />
          <button
            type="button"
            disabled={!commentBody.trim() || postingComment}
            onClick={() => void handlePostComment()}
            style={{
              padding: "8px 16px", borderRadius: 8, alignSelf: "flex-end",
              border: "1px solid var(--border)", background: "var(--surface-elevated)",
              fontSize: 13, fontWeight: 500, color: commentBody.trim() ? "var(--text-primary)" : "var(--text-muted)",
              cursor: commentBody.trim() ? "pointer" : "not-allowed",
              opacity: commentBody.trim() ? 1 : 0.5,
            }}
          >
            {postingComment ? "Posting..." : "Post comment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PayloadDisplay({ type, payload }: { type: ApprovalType; payload: Record<string, unknown> }) {
  const fields: Array<{ label: string; value: string; mono?: boolean; preWrap?: boolean }> = [];

  if (type === "hire_agent") {
    if (payload.name) fields.push({ label: "Name", value: String(payload.name) });
    if (payload.agentName) fields.push({ label: "Name", value: String(payload.agentName) });
    if (payload.role) fields.push({ label: "Role", value: String(payload.role) });
    if (payload.title) fields.push({ label: "Title", value: String(payload.title) });
    if (payload.model) fields.push({ label: "Model", value: String(payload.model) });
    if (payload.emoji) fields.push({ label: "Icon", value: String(payload.emoji) });
    if (payload.capabilities) fields.push({ label: "Capabilities", value: String(payload.capabilities), preWrap: true });
    if (payload.reason) fields.push({ label: "Reason", value: String(payload.reason), preWrap: true });
    if (payload.adapterType) fields.push({ label: "Adapter", value: String(payload.adapterType), mono: true });
    if (payload.desiredSkills) {
      const skills = Array.isArray(payload.desiredSkills) ? payload.desiredSkills.join(", ") : String(payload.desiredSkills);
      fields.push({ label: "Skills", value: skills });
    }
  } else if (type === "approve_ceo_strategy") {
    if (payload.title) fields.push({ label: "Title", value: String(payload.title) });
    const plan = payload.plan ?? payload.description ?? payload.strategy ?? payload.text;
    if (plan) fields.push({ label: "Plan", value: String(plan), preWrap: true });
  } else if (type === "budget_override_required") {
    if (payload.scopeName) fields.push({ label: "Scope", value: String(payload.scopeName) });
    if (payload.scopeType) fields.push({ label: "Scope type", value: String(payload.scopeType) });
    if (payload.windowKind) fields.push({ label: "Window", value: String(payload.windowKind) });
    if (payload.metric) fields.push({ label: "Metric", value: String(payload.metric) });
    if (payload.budgetLimit != null || payload.budgetAmount != null) {
      const amt = Number(payload.budgetLimit ?? payload.budgetAmount);
      fields.push({ label: "Budget limit", value: `$${(amt / 100).toFixed(2)}` });
    }
    if (payload.observedAmount != null) {
      fields.push({ label: "Observed", value: `$${(Number(payload.observedAmount) / 100).toFixed(2)}` });
    }
    if (payload.guidance) fields.push({ label: "Guidance", value: String(payload.guidance), preWrap: true });
  } else if (type === "provider_switch") {
    if (payload.agentName) fields.push({ label: "Agent", value: String(payload.agentName) });
    if (payload.agentId) fields.push({ label: "Agent ID", value: String(payload.agentId), mono: true });
    if (payload.currentProvider) fields.push({ label: "Current", value: String(payload.currentProvider), mono: true });
    if (payload.targetProvider) fields.push({ label: "Target", value: String(payload.targetProvider), mono: true });
    if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
      fields.push({
        label: "Warnings",
        value: payload.warnings
          .map((warning) => {
            if (typeof warning === "string") return warning;
            if (warning && typeof warning === "object" && "message" in warning) {
              return String((warning as { message?: unknown }).message ?? "");
            }
            return "";
          })
          .filter(Boolean)
          .join("\n"),
        preWrap: true,
      });
    }
  } else if (type === "protected_runtime_command") {
    if (payload.provider) fields.push({ label: "Provider", value: String(payload.provider), mono: true });
    if (payload.command) fields.push({ label: "Command", value: String(payload.command), mono: true, preWrap: true });
    if (payload.workspaceRoot) fields.push({ label: "Workspace", value: String(payload.workspaceRoot), mono: true });
    if (payload.reason) fields.push({ label: "Reason", value: String(payload.reason), preWrap: true });
    if (Array.isArray(payload.risks) && payload.risks.length > 0) {
      fields.push({
        label: "Risks",
        value: payload.risks
          .map((risk) => {
            if (typeof risk === "string") return risk;
            if (risk && typeof risk === "object" && "label" in risk) {
              const record = risk as { label?: unknown; matched?: unknown };
              return `${String(record.label ?? "Risk")}${record.matched ? ` (${String(record.matched)})` : ""}`;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n"),
        preWrap: true,
      });
    }
  }

  if (fields.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No structured payload data.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {fields.map((f) => (
        <div key={f.label} style={{ display: "flex", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 100, flexShrink: 0 }}>{f.label}</span>
          <span style={{
            fontSize: 13, color: "var(--text-primary)", wordBreak: "break-word",
            whiteSpace: f.preWrap ? "pre-wrap" : undefined,
            fontFamily: f.mono ? "var(--font-mono, monospace)" : undefined,
          }}>
            {f.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ActionButton({ label, color, disabled, onClick }: { label: string; color: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500,
        border: `1px solid ${color}40`,
        background: `${color}15`,
        color: disabled ? "var(--text-muted)" : color,
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 120ms ease",
      }}
    >
      {label}
    </button>
  );
}
