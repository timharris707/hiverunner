"use client";

import { Suspense, useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AgentAvatar } from "@/components/AgentAvatar";
import { buildTimestampedVideoUrl, normalizeVideoTimestampLabel } from "@/lib/ideas-processing";
import {
  Lightbulb,
  Plus,
  X,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Star,
  Archive,
  Trash2,
  Check,
  XCircle,
  Hammer,
  Camera,
  Image as ImageIcon,
  Loader2,
  Rocket,
  Sparkles,
} from "lucide-react";

/* ── types ─────────────────────────────────────────────────────── */

interface Screenshot {
  filename: string;
  timestamp: number;
  url: string;
  formattedTime: string;
}

interface Takeaway {
  id: string;
  title: string;
  description: string;
  video_timestamp: string;
  video_url: string;
  video_context: string;
  priority: string;
  effort: string;
  status: string;
  github_issue: string;
  assigned_to: string;
  notes: string;
}

interface Review {
  id: string;
  type: string;
  url: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: string;
  reviewed_at: string;
  submitted_by: string;
  status: string;
  summary: string;
  assessment: string;
  rating: number;
  takeaways: Takeaway[];
}

interface OrchestrationProjectOption {
  id: string;
  name: string;
  companyId?: string;
}

interface OrchestrationAgentOption {
  id: string;
  name: string;
}

interface OrchestrationSprintOption {
  id: string;
  name: string;
}

type BuildTakeawayAction = "build-now" | "add-to-queue";

interface BuildToast {
  id: string;
  kind: "success" | "error";
  text: string;
}

interface BuildCreateResponse {
  task?: {
    id?: string;
    project?: string;
  };
  takeaway?: {
    status?: string;
  };
}

interface LinkedTaskSnapshot {
  id: string;
  project: string;
  status: string;
  executionMode?: string;
  assignee?: string;
}

/* ── constants ─────────────────────────────────────────────────── */

const SOURCE_BADGES: Record<string, { icon: string; label: string }> = {
  youtube: { icon: "🎬", label: "YouTube" },
  reddit: { icon: "💬", label: "Reddit" },
  hn: { icon: "🔶", label: "HN" },
  article: { icon: "🔗", label: "Article" },
  manual: { icon: "🔗", label: "Link" },
};

const TAKEAWAY_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  idea: { label: "Idea", color: "var(--text-secondary)", bg: "var(--surface-hover)" },
  approved: { label: "Promoted", color: "var(--positive)", bg: "var(--surface-hover)" },
  building: { label: "Building", color: "var(--info)", bg: "var(--surface-hover)" },
  shipped: { label: "Shipped", color: "var(--positive)", bg: "var(--surface-hover)" },
  rejected: { label: "Rejected", color: "var(--negative)", bg: "var(--surface-hover)" },
};

const REVIEW_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "var(--text-secondary)", bg: "var(--surface-hover)" },
  archived: { label: "Archived", color: "var(--text-muted)", bg: "var(--surface-hover)" },
  rejected: { label: "Rejected", color: "var(--negative)", bg: "var(--surface-hover)" },
};

const PRIORITY_ICONS: Record<string, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

const TASK_STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  backlog: { label: "Backlog", color: "#fcd34d", bg: "rgba(217,119,6,0.14)", border: "rgba(251,191,36,0.34)" },
  "to-do": { label: "To-Do", color: "#fcd34d", bg: "rgba(217,119,6,0.14)", border: "rgba(251,191,36,0.34)" },
  "in-progress": { label: "In Progress", color: "#7dd3fc", bg: "rgba(3,105,161,0.16)", border: "rgba(125,211,252,0.34)" },
  review: { label: "In Review", color: "#c4b5fd", bg: "rgba(91,33,182,0.18)", border: "rgba(196,181,253,0.34)" },
  done: { label: "Done", color: "#86efac", bg: "rgba(21,128,61,0.18)", border: "rgba(134,239,172,0.34)" },
  blocked: { label: "Blocked", color: "#fca5a5", bg: "rgba(127,29,29,0.2)", border: "rgba(248,113,113,0.36)" },
};

type FilterTab = "all" | "active" | "archived" | "rejected";
type SelectedTakeawayLookup = Record<string, true>;

/* ── helpers ────────────────────────────────────────────────────── */

function getVideoId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function takeawaySelectionKey(reviewId: string, takeawayId: string): string {
  return `${reviewId}::${takeawayId}`;
}

function isTakeawaySelectable(status: string): boolean {
  return status === "idea" || status === "approved";
}

function GithubIssueLink({ issue }: { issue: string }) {
  if (!issue) return null;
  const m = issue.match(/^(.+?)#(\d+)$/);
  if (!m) return null;
  return (
    <a
      href={`https://github.com/${m[1]}/issues/${m[2]}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[11px] hover:underline"
      style={{ color: "var(--text-muted)" }}
    >
      #{m[2]} <ExternalLink size={10} />
    </a>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={14}
          fill={i <= rating ? "#fbbf24" : "transparent"}
          color={i <= rating ? "#fbbf24" : "var(--text-muted)"}
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}

/* ── submit URL modal ──────────────────────────────────────────── */

function SubmitModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, title }),
      });
      onSubmitted();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col gap-4 w-full max-w-[480px] rounded-xl p-6"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex justify-between items-center">
          <h3 className="text-base font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
            Submit URL for Review
          </h3>
          <button onClick={onClose} className="border-none bg-transparent cursor-pointer" style={{ color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </div>

        <input
          placeholder="Paste URL (YouTube, Reddit, article…)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-lg px-3 py-2.5 text-[13px]"
          style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          autoFocus
        />
        <input
          placeholder="Title (optional — auto-detected for YouTube)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg px-3 py-2.5 text-[13px]"
          style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />

        <button
          onClick={handleSubmit}
          disabled={submitting || !url}
          className="rounded-lg px-4 py-2.5 text-[13px] font-semibold border-none cursor-pointer"
          style={{
            backgroundColor: "var(--surface-hover)",
            color: "var(--text-primary)",
            opacity: submitting || !url ? 0.5 : 1,
            cursor: submitting || !url ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Submitting…" : "Submit for Review"}
        </button>
      </div>
    </div>
  );
}

/* ── confirm dialog ────────────────────────────────────────────── */

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col gap-4 w-full max-w-[360px] rounded-xl p-6"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-xs border-none cursor-pointer"
            style={{ backgroundColor: "var(--surface-elevated)", color: "var(--text-secondary)" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg px-4 py-2 text-xs font-semibold border-none cursor-pointer"
            style={{ backgroundColor: "#ef4444", color: "#fff" }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function BuildTakeawayModal({
  open,
  onClose,
  loading,
  onConfirm,
  projectOptions,
  selectedProjectId,
  onProjectChange,
  agentOptions,
  selectedAssignee,
  onAssigneeChange,
  sprintOptions,
  selectedSprintId,
  onSprintChange,
  action,
  onActionChange,
  loadingSelectors,
  error,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  onConfirm: () => void;
  projectOptions: OrchestrationProjectOption[];
  selectedProjectId: string;
  onProjectChange: (next: string) => void;
  agentOptions: OrchestrationAgentOption[];
  selectedAssignee: string;
  onAssigneeChange: (next: string) => void;
  sprintOptions: OrchestrationSprintOption[];
  selectedSprintId: string;
  onSprintChange: (next: string) => void;
  action: BuildTakeawayAction;
  onActionChange: (next: BuildTakeawayAction) => void;
  loadingSelectors: boolean;
  error: string | null;
}) {
  if (!open) return null;
  const selectedAssigneeAgent = agentOptions.find((agent) => agent.id === selectedAssignee);
  const targetColumnLabel = action === "build-now" ? "In Progress" : "Backlog";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: "rgba(2,6,23,0.66)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Promote takeaway to orchestration task"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[560px] rounded-2xl border p-5 md:p-6"
        style={{
          borderColor: "rgba(148,163,184,0.25)",
          background:
            "linear-gradient(140deg, rgba(15,23,42,0.92), rgba(2,6,23,0.88) 55%, rgba(8,47,73,0.8))",
          boxShadow: "0 24px 70px rgba(2,6,23,0.65), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="m-0 text-[11px] uppercase tracking-[0.2em]" style={{ color: "rgba(125,211,252,0.8)" }}>
              Orchestration Launch
            </p>
            <h3 className="mt-1 text-[18px] font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
              Build This Takeaway
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border-none bg-transparent p-1.5"
            style={{ color: "var(--text-muted)", cursor: loading ? "not-allowed" : "pointer" }}
            aria-label="Close build modal"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mb-4 grid gap-2 rounded-xl border p-2" style={{ borderColor: "rgba(148,163,184,0.22)", background: "rgba(15,23,42,0.5)" }}>
          <button
            type="button"
            onClick={() => onActionChange("build-now")}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-left transition-all"
            style={{
              border: action === "build-now" ? "1px solid rgba(248,113,113,0.48)" : "1px solid transparent",
              background: action === "build-now" ? "rgba(127,29,29,0.35)" : "rgba(15,23,42,0.3)",
              color: action === "build-now" ? "#fecaca" : "var(--text-secondary)",
            }}
          >
            <span className="inline-flex items-center gap-2 text-[12px] font-semibold"><Rocket size={14} /> Build now</span>
            <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "rgba(248,113,113,0.9)" }}>Fast lane</span>
          </button>
          <button
            type="button"
            onClick={() => onActionChange("add-to-queue")}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-left transition-all"
            style={{
              border: action === "add-to-queue" ? "1px solid rgba(251,191,36,0.45)" : "1px solid transparent",
              background: action === "add-to-queue" ? "rgba(120,53,15,0.35)" : "rgba(15,23,42,0.3)",
              color: action === "add-to-queue" ? "#fde68a" : "var(--text-secondary)",
            }}
          >
            <span className="inline-flex items-center gap-2 text-[12px] font-semibold"><Sparkles size={14} /> Promote to queue</span>
            <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "rgba(251,191,36,0.9)" }}>Backlog</span>
          </button>
        </div>
        <p className="mb-4 text-[11px]" style={{ color: "rgba(148,163,184,0.95)" }}>
          Target board column: <span style={{ color: "#f8fafc", fontWeight: 600 }}>{targetColumnLabel}</span>
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
            Project
            <select
              value={selectedProjectId}
              onChange={(event) => onProjectChange(event.target.value)}
              disabled={loading || loadingSelectors}
              className="rounded-lg px-3 py-2"
              style={{ backgroundColor: "rgba(15,23,42,0.75)", border: "1px solid rgba(148,163,184,0.26)", color: "var(--text-primary)" }}
            >
              <option value="" disabled>
                {loadingSelectors ? "Loading projects..." : "Select project"}
              </option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
            Assignee
            <select
              value={selectedAssignee}
              onChange={(event) => onAssigneeChange(event.target.value)}
              disabled={loading || loadingSelectors}
              className="rounded-lg px-3 py-2"
              style={{ backgroundColor: "rgba(15,23,42,0.75)", border: "1px solid rgba(148,163,184,0.26)", color: "var(--text-primary)" }}
            >
              <option value="">Unassigned</option>
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
              {!loadingSelectors && agentOptions.length === 0 ? (
                <option value="" disabled>
                  No agents in this project
                </option>
              ) : null}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold md:col-span-2" style={{ color: "var(--text-muted)" }}>
            Sprint
            <select
              value={selectedSprintId}
              onChange={(event) => onSprintChange(event.target.value)}
              disabled={loading || loadingSelectors}
              className="rounded-lg px-3 py-2"
              style={{ backgroundColor: "rgba(15,23,42,0.75)", border: "1px solid rgba(148,163,184,0.26)", color: "var(--text-primary)" }}
            >
              <option value="">Backlog</option>
              {sprintOptions.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
              {!loadingSelectors && sprintOptions.length === 0 ? (
                <option value="" disabled>
                  No active sprints
                </option>
              ) : null}
            </select>
          </label>
        </div>
        {selectedAssigneeAgent ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "rgba(148,163,184,0.3)", backgroundColor: "rgba(15,23,42,0.52)" }}>
            <AgentAvatar agentId={selectedAssigneeAgent.id} size={16} />
            <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {selectedAssigneeAgent.name}
            </span>
          </div>
        ) : null}

        {loadingSelectors && (
          <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Loading orchestration options…
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-lg px-3 py-2 text-[11px]" style={{ backgroundColor: "rgba(127,29,29,0.35)", color: "#fca5a5" }}>
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border-none px-3 py-2 text-[12px] font-semibold"
            style={{ backgroundColor: "rgba(148,163,184,0.16)", color: "var(--text-secondary)", cursor: loading ? "not-allowed" : "pointer" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || !selectedProjectId}
            className="inline-flex items-center gap-1.5 rounded-lg border-none px-3.5 py-2 text-[12px] font-semibold"
            style={{
              background: action === "build-now" ? "linear-gradient(135deg,#f97316,#ef4444)" : "rgba(255,255,255,0.08)",
              color: "#fff",
              opacity: loading || !selectedProjectId ? 0.6 : 1,
              cursor: loading || !selectedProjectId ? "not-allowed" : "pointer",
            }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : action === "build-now" ? <Rocket size={13} /> : <Sparkles size={13} />}
            {loading ? "Launching..." : action === "build-now" ? "Build now" : "Promote to queue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkApproveModal({
  open,
  onClose,
  loading,
  onConfirm,
  selectedCount,
  selectedReviewCount,
  projectOptions,
  selectedProjectId,
  onProjectChange,
  agentOptions,
  selectedAssignee,
  onAssigneeChange,
  sprintOptions,
  selectedSprintId,
  onSprintChange,
  loadingSelectors,
  error,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  onConfirm: () => void;
  selectedCount: number;
  selectedReviewCount: number;
  projectOptions: OrchestrationProjectOption[];
  selectedProjectId: string;
  onProjectChange: (next: string) => void;
  agentOptions: OrchestrationAgentOption[];
  selectedAssignee: string;
  onAssigneeChange: (next: string) => void;
  sprintOptions: OrchestrationSprintOption[];
  selectedSprintId: string;
  onSprintChange: (next: string) => void;
  loadingSelectors: boolean;
  error: string | null;
}) {
  if (!open) return null;
  const selectedAssigneeAgent = agentOptions.find((agent) => agent.id === selectedAssignee);

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center p-4"
      style={{ background: "rgba(2,6,23,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Approve selected takeaways"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[620px] rounded-2xl border p-5 md:p-6"
        style={{
          borderColor: "rgba(148,163,184,0.25)",
          background:
            "linear-gradient(140deg, rgba(15,23,42,0.95), rgba(2,6,23,0.9) 55%, rgba(8,47,73,0.82))",
          boxShadow: "0 24px 70px rgba(2,6,23,0.68), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="m-0 text-[11px] uppercase tracking-[0.2em]" style={{ color: "rgba(110,231,183,0.8)" }}>
              Bulk Promotion
            </p>
            <h3 className="mt-1 text-[18px] font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
              Approve and Create Tasks
            </h3>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              Create {selectedCount} task{selectedCount === 1 ? "" : "s"} from {selectedReviewCount} video
              {selectedReviewCount === 1 ? "" : "s"}?
            </p>
            <p className="mt-1 text-[11px]" style={{ color: "rgba(148,163,184,0.95)" }}>
              Target board column: <span style={{ color: "#f8fafc", fontWeight: 600 }}>Backlog</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border-none bg-transparent p-1.5"
            style={{ color: "var(--text-muted)", cursor: loading ? "not-allowed" : "pointer" }}
            aria-label="Close bulk approval modal"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
            Project
            <select
              value={selectedProjectId}
              onChange={(event) => onProjectChange(event.target.value)}
              disabled={loading || loadingSelectors}
              className="rounded-lg px-3 py-2"
              style={{ backgroundColor: "rgba(15,23,42,0.75)", border: "1px solid rgba(148,163,184,0.26)", color: "var(--text-primary)" }}
            >
              <option value="" disabled>
                {loadingSelectors ? "Loading projects..." : "Select project"}
              </option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
            Assignee
            <select
              value={selectedAssignee}
              onChange={(event) => onAssigneeChange(event.target.value)}
              disabled={loading || loadingSelectors}
              className="rounded-lg px-3 py-2"
              style={{ backgroundColor: "rgba(15,23,42,0.75)", border: "1px solid rgba(148,163,184,0.26)", color: "var(--text-primary)" }}
            >
              <option value="">Unassigned</option>
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
              {!loadingSelectors && agentOptions.length === 0 ? (
                <option value="" disabled>
                  No agents in this project
                </option>
              ) : null}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold md:col-span-2" style={{ color: "var(--text-muted)" }}>
            Sprint
            <select
              value={selectedSprintId}
              onChange={(event) => onSprintChange(event.target.value)}
              disabled={loading || loadingSelectors}
              className="rounded-lg px-3 py-2"
              style={{ backgroundColor: "rgba(15,23,42,0.75)", border: "1px solid rgba(148,163,184,0.26)", color: "var(--text-primary)" }}
            >
              <option value="">Backlog</option>
              {sprintOptions.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
              {!loadingSelectors && sprintOptions.length === 0 ? (
                <option value="" disabled>
                  No active sprints
                </option>
              ) : null}
            </select>
          </label>
        </div>
        {selectedAssigneeAgent ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "rgba(148,163,184,0.3)", backgroundColor: "rgba(15,23,42,0.52)" }}>
            <AgentAvatar agentId={selectedAssigneeAgent.id} size={16} />
            <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {selectedAssigneeAgent.name}
            </span>
          </div>
        ) : null}

        {loadingSelectors && (
          <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Loading orchestration options…
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-lg px-3 py-2 text-[11px]" style={{ backgroundColor: "rgba(127,29,29,0.35)", color: "#fca5a5" }}>
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border-none px-3 py-2 text-[12px] font-semibold"
            style={{ backgroundColor: "rgba(148,163,184,0.16)", color: "var(--text-secondary)", cursor: loading ? "not-allowed" : "pointer" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || !selectedProjectId || selectedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border-none px-3.5 py-2 text-[12px] font-semibold"
            style={{
              background: "linear-gradient(135deg,#22c55e,#16a34a)",
              color: "#fff",
              opacity: loading || !selectedProjectId || selectedCount === 0 ? 0.6 : 1,
              cursor: loading || !selectedProjectId || selectedCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {loading ? "Creating tasks..." : `Approve ${selectedCount} Selected`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── takeaway row ──────────────────────────────────────────────── */

function TakeawayRow({
  takeaway,
  reviewId,
  highlighted,
  selected,
  selectable,
  onToggleSelect,
  onUpdate,
  onToast,
}: {
  takeaway: Takeaway;
  reviewId: string;
  highlighted?: boolean;
  selected: boolean;
  selectable: boolean;
  onToggleSelect: (next: boolean) => void;
  onUpdate: () => void;
  onToast: (kind: BuildToast["kind"], text: string) => void;
}) {
  const [notes, setNotes] = useState(takeaway.notes);
  const [saving, setSaving] = useState(false);
  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [projects, setProjects] = useState<OrchestrationProjectOption[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgentOption[]>([]);
  const [sprints, setSprints] = useState<OrchestrationSprintOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [buildAction, setBuildAction] = useState<BuildTakeawayAction>("build-now");
  const [buildError, setBuildError] = useState<string | null>(null);
  const [createdTask, setCreatedTask] = useState<{ id: string; projectId: string } | null>(null);
  const [linkedTask, setLinkedTask] = useState<LinkedTaskSnapshot | null>(null);
  const [resolvedAssignee, setResolvedAssignee] = useState<{ id: string; name: string } | null>(null);
  const anchorId = useMemo(() => `takeaway-${reviewId}-${takeaway.id}`, [reviewId, takeaway.id]);
  const sm = TAKEAWAY_STATUS[takeaway.status] ?? TAKEAWAY_STATUS.idea;
  const timestampLink = useMemo(
    () => buildTimestampedVideoUrl(takeaway.video_url, takeaway.video_timestamp),
    [takeaway.video_timestamp, takeaway.video_url]
  );
  const timestampLabel = useMemo(
    () => normalizeVideoTimestampLabel(takeaway.video_timestamp, timestampLink),
    [takeaway.video_timestamp, timestampLink]
  );

  useEffect(() => {
    const name = takeaway.assigned_to?.trim();
    if (!name) {
      setResolvedAssignee(null);
      return;
    }

    let active = true;
    (async () => {
      try {
        const params = new URLSearchParams({ name });
        const response = await fetch(`/api/orchestration/agents/lookup?${params.toString()}`);
        if (!response.ok) {
          if (active) setResolvedAssignee(null);
          return;
        }
        const payload = (await response.json().catch(() => ({}))) as { id?: string; name?: string };
        if (!active || !payload.id || !payload.name) {
          if (active) setResolvedAssignee(null);
          return;
        }
        setResolvedAssignee({ id: payload.id, name: payload.name });
      } catch {
        if (active) setResolvedAssignee(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [takeaway.assigned_to]);

  useEffect(() => {
    if (!buildModalOpen || takeaway.status !== "approved") return;

    let active = true;
    (async () => {
      setBuildError(null);
      setSelectorLoading(true);
      try {
        const projectsRes = await fetch("/api/orchestration/projects");
        const projectsData = await projectsRes.json().catch(() => ({}));

        const projectOptions = Array.isArray(projectsData?.projects)
          ? projectsData.projects.map(
              (project: { id: string; name: string; companyId?: string }) => ({
                id: project.id,
                name: project.name,
                companyId: project.companyId,
              })
            )
          : [];

        if (!active) return;

        setProjects(projectOptions);
        if (!selectedProjectId && projectOptions.length > 0) {
          setSelectedProjectId(projectOptions[0].id);
        }
        if (projectOptions.length === 0) {
          setBuildError("No orchestration projects available yet.");
        }
      } catch {
        if (!active) return;
        setProjects([]);
        setBuildError("Unable to load orchestration projects.");
      } finally {
        if (active) {
          setSelectorLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [buildModalOpen, selectedProjectId, takeaway.status]);

  useEffect(() => {
    if (!buildModalOpen) return;
    if (!selectedProjectId) {
      setAgents([]);
      setSprints([]);
      setSelectedAssignee("");
      setSelectedSprintId("");
      return;
    }

    let active = true;
    setSelectedAssignee("");
    setSelectedSprintId("");
    (async () => {
      try {
        const [agentsRes, sprintsRes] = await Promise.all([
          fetch(`/api/orchestration/projects/${selectedProjectId}/agents`),
          fetch(`/api/orchestration/projects/${selectedProjectId}/sprints`),
        ]);
        const agentsData = await agentsRes.json().catch(() => ({}));
        const sprintsData = await sprintsRes.json().catch(() => ({}));

        if (!active) return;
        setAgents(
          Array.isArray(agentsData?.agents)
            ? agentsData.agents.map((agent: { id: string; name: string }) => ({
                id: agent.id,
                name: agent.name,
              }))
            : []
        );
        setSprints(
          Array.isArray(sprintsData?.sprints)
            ? sprintsData.sprints.map((sprint: { id: string; name: string }) => ({
                id: sprint.id,
                name: sprint.name,
              }))
            : []
        );
      } catch {
        if (!active) return;
        setAgents([]);
        setSprints([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [buildModalOpen, selectedProjectId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const params = new URLSearchParams({
          sourceReviewId: reviewId,
          sourceTakeawayId: takeaway.id,
        });
        const response = await fetch(`/api/orchestration/tasks?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          if (active) setLinkedTask(null);
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          tasks?: Array<{
            id?: string;
            project?: string;
            status?: string;
            executionMode?: string;
            execution_mode?: string;
            assignee?: string;
          }>;
        };

        const rawTask = Array.isArray(payload.tasks) ? payload.tasks[0] : undefined;
        if (!active || !rawTask?.id || !rawTask?.project) {
          if (active) setLinkedTask(null);
          return;
        }

        setLinkedTask({
          id: String(rawTask.id),
          project: String(rawTask.project),
          status: String(rawTask.status ?? ""),
          executionMode: rawTask.executionMode
            ? String(rawTask.executionMode)
            : rawTask.execution_mode
            ? String(rawTask.execution_mode)
            : undefined,
          assignee: rawTask.assignee ? String(rawTask.assignee) : undefined,
        });
      } catch {
        if (active) {
          setLinkedTask(null);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reviewId, takeaway.id, takeaway.status]);

  useEffect(() => {
    if (!highlighted) return;
    const timer = window.setTimeout(() => {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [anchorId, highlighted]);

  const updateTakeaway = async (updates: Partial<Takeaway>) => {
    setSaving(true);
    try {
      await fetch(`/api/ideas/${reviewId}/takeaways/${takeaway.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      onUpdate();
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = () => {
    if (notes !== takeaway.notes) {
      updateTakeaway({ notes });
    }
  };

  const runBuildAction = async () => {
    setSaving(true);
    setBuildError(null);
    try {
      const response = await fetch(`/api/ideas/${reviewId}/takeaways/${takeaway.id}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: buildAction,
          projectId: selectedProjectId,
          assignee: selectedAssignee || undefined,
          sprintId: selectedSprintId || undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as BuildCreateResponse & {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Failed to create orchestration task.");
      }

      const createdTaskId = String(payload.task?.id ?? "").trim();
      const createdProjectId = String(payload.task?.project ?? selectedProjectId).trim();
      if (createdTaskId && createdProjectId) {
        setCreatedTask({ id: createdTaskId, projectId: createdProjectId });
      }

      setBuildModalOpen(false);
      onToast(
        "success",
        buildAction === "build-now"
          ? "Takeaway promoted to active build lane."
          : "Takeaway promoted to orchestration backlog."
      );
      await onUpdate();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to build takeaway.";
      setBuildError(message);
      onToast("error", message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      id={anchorId}
      className="rounded-lg p-4 flex flex-col gap-3 transition-colors"
      style={{
        backgroundColor: "var(--bg)",
        border: highlighted ? "1px solid rgba(125,211,252,0.62)" : "1px solid var(--border)",
        boxShadow: highlighted ? "0 0 0 1px rgba(56,189,248,0.18), 0 16px 36px rgba(2,6,23,0.42)" : "none",
      }}
    >
      {/* Top row: title + badges */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={selected}
                disabled={!selectable}
                onChange={(event) => onToggleSelect(event.target.checked)}
                aria-label={`Select takeaway ${takeaway.title}`}
                className="h-3.5 w-3.5 rounded border"
                style={{
                  accentColor: "#22c55e",
                  cursor: selectable ? "pointer" : "not-allowed",
                  opacity: selectable ? 1 : 0.45,
                }}
              />
            </label>
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {takeaway.title}
            </span>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded"
              style={{ color: sm.color, backgroundColor: sm.bg }}
            >
              {sm.label}
            </span>
            <span className="text-[11px]">{PRIORITY_ICONS[takeaway.priority] ?? "🟡"}</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
            >
              {takeaway.effort}
            </span>
            {!selectable ? (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: "rgba(148,163,184,0.14)", color: "var(--text-muted)" }}
              >
                Not selectable
              </span>
            ) : null}
          </div>
          <p className="text-[12px] m-0 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {takeaway.description}
          </p>
        </div>

        {/* Agent avatar */}
        {takeaway.assigned_to && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <AgentAvatar agentId={resolvedAssignee?.id ?? takeaway.assigned_to} size={24} />
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {resolvedAssignee?.name ?? takeaway.assigned_to}
            </span>
          </div>
        )}
      </div>

      {/* Timestamp + context + GitHub */}
      <div className="flex items-center gap-4 flex-wrap">
        {timestampLink && (
          <a
            href={timestampLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] font-mono font-semibold px-2 py-1 rounded-md no-underline transition-colors hover:brightness-110"
            style={{
              color: "var(--text-secondary)",
              backgroundColor: "var(--surface-hover)",
              border: "1px solid var(--border)",
            }}
          >
            {timestampLabel ? `📹 @${timestampLabel}` : "📹 Open video"}
          </a>
        )}
        {takeaway.video_context && (
          <span className="text-[11px] italic" style={{ color: "var(--text-muted)" }}>
            {takeaway.video_context}
          </span>
        )}
        <GithubIssueLink issue={takeaway.github_issue} />
      </div>

      {/* Action buttons + notes */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Status transition buttons */}
        {takeaway.status === "idea" && (
          <>
            <button
              onClick={() => updateTakeaway({ status: "approved" })}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border-none cursor-pointer transition-colors"
              style={{ backgroundColor: "var(--surface-hover)", color: "var(--positive)", border: "1px solid var(--positive)" }}
            >
              <Check size={12} /> Approve
            </button>
            <button
              onClick={() => updateTakeaway({ status: "rejected" })}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border-none cursor-pointer transition-colors"
              style={{ backgroundColor: "var(--surface-hover)", color: "var(--negative)", border: "1px solid var(--negative)" }}
            >
              <XCircle size={12} /> Reject
            </button>
          </>
        )}
        {takeaway.status === "approved" && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setBuildModalOpen(true)}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md border-none px-2.5 py-1 text-[11px] font-semibold transition-colors"
              style={{
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.72 : 1,
                background: "var(--surface-hover)",
                color: "var(--text-primary)",
              }}
            >
              <Hammer size={12} /> Build
            </button>
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Open launch modal
            </span>
          </div>
        )}
        {takeaway.status === "building" && (
          <button
            onClick={() => updateTakeaway({ status: "shipped" })}
            disabled={saving}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border-none cursor-pointer transition-colors"
            style={{ backgroundColor: "var(--surface-hover)", color: "var(--positive)", border: "1px solid var(--positive)" }}
          >
            <Check size={12} /> Mark Shipped
          </button>
        )}
        {(() => {
          const taskForUi = linkedTask ?? (createdTask ? {
            id: createdTask.id,
            project: createdTask.projectId,
            status: "",
            executionMode: undefined,
            assignee: undefined,
          } : null);
          if (!taskForUi) return null;
          const statusMeta = TASK_STATUS_META[taskForUi.status] ?? null;
          return (
            <>
              {statusMeta ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
                  style={{
                    color: statusMeta.color,
                    backgroundColor: statusMeta.bg,
                    border: `1px solid ${statusMeta.border}`,
                  }}
                >
                  🛰️ {statusMeta.label}
                </span>
              ) : null}
              {taskForUi.executionMode ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase"
                  style={{
                    color: "#cbd5f5",
                    backgroundColor: "rgba(30,41,59,0.74)",
                    border: "1px solid rgba(148,163,184,0.32)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {taskForUi.executionMode}
                </span>
              ) : null}
              {taskForUi.assignee ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
                  style={{
                    color: "#e2e8f0",
                    backgroundColor: "rgba(15,23,42,0.72)",
                    border: "1px solid rgba(148,163,184,0.3)",
                  }}
                >
                  <AgentAvatar agentId={taskForUi.assignee} size={14} />
                  {taskForUi.assignee}
                </span>
              ) : null}
              <a
                href={`/projects/${taskForUi.project}/board?task=${taskForUi.id}`}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold no-underline transition-colors"
                style={{
                  color: "#7dd3fc",
                  backgroundColor: "rgba(12,74,110,0.28)",
                  border: "1px solid rgba(125,211,252,0.35)",
                }}
              >
                <ExternalLink size={11} /> View task on board
              </a>
            </>
          );
        })()}

        {/* Notes */}
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Add notes…"
          className="flex-1 min-w-[120px] text-[11px] rounded-md px-2.5 py-1.5"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        />
      </div>

      <BuildTakeawayModal
        open={buildModalOpen}
        onClose={() => {
          if (saving) return;
          setBuildModalOpen(false);
        }}
        loading={saving}
        onConfirm={runBuildAction}
        projectOptions={projects}
        selectedProjectId={selectedProjectId}
        onProjectChange={setSelectedProjectId}
        agentOptions={agents}
        selectedAssignee={selectedAssignee}
        onAssigneeChange={setSelectedAssignee}
        sprintOptions={sprints}
        selectedSprintId={selectedSprintId}
        onSprintChange={setSelectedSprintId}
        action={buildAction}
        onActionChange={setBuildAction}
        loadingSelectors={selectorLoading}
        error={buildError}
      />
    </div>
  );
}

/* ── screenshot gallery ────────────────────────────────────────── */

function ScreenshotGallery({ reviewId, isYouTube }: { reviewId: string; isYouTube: boolean }) {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [captured, setCaptured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!isYouTube) { setLoading(false); return; }
    fetch(`/api/ideas/${reviewId}/screenshots`)
      .then((r) => r.json())
      .then((data) => {
        setScreenshots(data.screenshots ?? []);
        setCaptured(data.captured ?? false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [reviewId, isYouTube]);

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const res = await fetch(`/api/ideas/${reviewId}/screenshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval: 30 }),
      });
      const data = await res.json();
      if (data.screenshots) {
        setScreenshots(data.screenshots);
        setCaptured(true);
      }
    } catch {
      /* silent */
    } finally {
      setCapturing(false);
    }
  };

  if (!isYouTube) return null;
  if (loading) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <h4
          className="text-[11px] font-semibold uppercase tracking-wider m-0"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="inline-flex items-center gap-1.5">
            <ImageIcon size={12} /> Screenshots {captured && `(${screenshots.length})`}
          </span>
        </h4>
        {!captured && (
          <button
            onClick={handleCapture}
            disabled={capturing}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border-none cursor-pointer transition-colors"
            style={{
              backgroundColor: "var(--surface-hover)",
              color: "var(--text-secondary)",
              opacity: capturing ? 0.6 : 1,
              cursor: capturing ? "wait" : "pointer",
            }}
          >
            {capturing ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Capturing…
              </>
            ) : (
              <>
                <Camera size={12} /> Capture Screenshots
              </>
            )}
          </button>
        )}
        {captured && screenshots.length > 0 && (
          <button
            onClick={handleCapture}
            disabled={capturing}
            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border-none cursor-pointer"
            style={{ backgroundColor: "rgba(156,163,175,0.12)", color: "var(--text-muted)" }}
          >
            {capturing ? <Loader2 size={10} className="animate-spin" /> : <Camera size={10} />}
            {capturing ? " Recapturing…" : " Recapture"}
          </button>
        )}
      </div>

      {capturing && !captured && (
        <div
          className="text-[12px] rounded-lg p-4 text-center"
          style={{ backgroundColor: "rgba(255,255,255,0.02)", color: "var(--text-secondary)" }}
        >
          Downloading video and extracting frames… This may take a few minutes.
        </div>
      )}

      {screenshots.length > 0 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
          {screenshots.map((s, idx) => (
            <button
              key={s.filename}
              onClick={() => setSelectedIdx(selectedIdx === idx ? null : idx)}
              className="relative rounded-lg overflow-hidden border-none p-0 cursor-pointer group"
              style={{
                border: selectedIdx === idx ? "2px solid rgba(222,220,209,0.22)" : "1px solid var(--border)",
                backgroundColor: "var(--bg)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.url}
                alt={`Frame at ${s.formattedTime}`}
                className="w-full h-auto block"
                loading="lazy"
              />
              <span
                className="absolute bottom-1 right-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: "rgba(0,0,0,0.7)",
                  color: "#fff",
                }}
              >
                {s.formattedTime}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Expanded view */}
      {selectedIdx !== null && screenshots[selectedIdx] && (
        <div className="mt-3 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshots[selectedIdx].url}
            alt={`Frame at ${screenshots[selectedIdx].formattedTime}`}
            className="w-full h-auto block"
          />
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ backgroundColor: "var(--surface)" }}
          >
            <span className="text-[12px] font-mono" style={{ color: "var(--text-secondary)" }}>
              {screenshots[selectedIdx].formattedTime}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedIdx(Math.max(0, selectedIdx - 1))}
                disabled={selectedIdx === 0}
                className="text-[11px] px-2 py-1 rounded border-none cursor-pointer"
                style={{
                  backgroundColor: "rgba(255,255,255,0.06)",
                  color: "var(--text-secondary)",
                  opacity: selectedIdx === 0 ? 0.3 : 1,
                }}
              >
                Prev
              </button>
              <button
                onClick={() => setSelectedIdx(Math.min(screenshots.length - 1, selectedIdx + 1))}
                disabled={selectedIdx === screenshots.length - 1}
                className="text-[11px] px-2 py-1 rounded border-none cursor-pointer"
                style={{
                  backgroundColor: "rgba(255,255,255,0.06)",
                  color: "var(--text-secondary)",
                  opacity: selectedIdx === screenshots.length - 1 ? 0.3 : 1,
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── review card ───────────────────────────────────────────────── */

function ReviewCard({
  review,
  focusTakeawayId,
  selectedTakeawayLookup,
  onToggleTakeaway,
  onToggleReviewTakeaways,
  onUpdate,
  onToast,
  defaultExpanded,
}: {
  review: Review;
  focusTakeawayId?: string;
  selectedTakeawayLookup: SelectedTakeawayLookup;
  onToggleTakeaway: (takeawayId: string, next: boolean) => void;
  onToggleReviewTakeaways: (takeawayIds: string[], next: boolean) => void;
  onUpdate: () => void;
  onToast: (kind: BuildToast["kind"], text: string) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? (review.status === "active"));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rs = REVIEW_STATUS[review.status] ?? REVIEW_STATUS.active;
  const source = SOURCE_BADGES[review.type] ?? SOURCE_BADGES.manual;
  const videoId = getVideoId(review.url);
  const thumbnailUrl = videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : review.thumbnail;

  const implementedCount = review.takeaways.filter(
    (t) => t.status === "shipped" || t.status === "building"
  ).length;
  const eligibleTakeawayIds = review.takeaways
    .filter((takeaway) => isTakeawaySelectable(takeaway.status))
    .map((takeaway) => takeaway.id);
  const selectedEligibleCount = eligibleTakeawayIds.reduce(
    (count, takeawayId) =>
      selectedTakeawayLookup[takeawaySelectionKey(review.id, takeawayId)] ? count + 1 : count,
    0
  );
  const allEligibleSelected =
    eligibleTakeawayIds.length > 0 && selectedEligibleCount === eligibleTakeawayIds.length;
  const totalTakeaways = review.takeaways.length;
  const progressPct = totalTakeaways > 0 ? (implementedCount / totalTakeaways) * 100 : 0;

  const updateReview = async (updates: Partial<Review>) => {
    await fetch(`/api/ideas/${review.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    onUpdate();
  };

  const deleteReview = async () => {
    await fetch(`/api/ideas/${review.id}`, { method: "DELETE" });
    onUpdate();
  };

  const isArchived = review.status === "archived";

  return (
    <>
      <div
        className="rounded-xl overflow-hidden transition-all"
        style={{
          backgroundColor: "var(--surface)",
          border: `1px solid ${isArchived ? "var(--border)" : "var(--border)"}`,
          opacity: isArchived ? 0.6 : 1,
        }}
      >
        {/* Card header */}
        <div className="flex gap-4 p-4">
          {/* Thumbnail */}
          {thumbnailUrl && (
            <a
              href={review.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 rounded-lg overflow-hidden block"
              style={{ width: 200, height: 112 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl}
                alt={review.title}
                className="w-full h-full object-cover"
                style={{ width: 200, height: 112 }}
              />
            </a>
          )}

          {/* Info section */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {/* Title row */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3
                  className="text-[16px] font-bold m-0 leading-snug"
                  style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
                >
                  {review.title}
                </h3>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {/* Source badge */}
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
                    style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "var(--text-secondary)" }}
                  >
                    {source.icon} {source.label}
                  </span>
                  {/* Status badge */}
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
                    style={{ color: rs.color, backgroundColor: rs.bg }}
                  >
                    {rs.label}
                  </span>
                  {/* Date + submitter */}
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Reviewed {new Date(review.reviewed_at).toLocaleDateString()} · Submitted by{" "}
                    <span style={{ color: "var(--text-secondary)" }}>{review.submitted_by}</span>
                  </span>
                </div>
              </div>

              {/* Review actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {review.status === "active" && (
                  <button
                    onClick={() => updateReview({ status: "archived" })}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border-none cursor-pointer"
                    style={{ backgroundColor: "rgba(156,163,175,0.12)", color: "var(--text-muted)" }}
                    title="Archive review"
                  >
                    <Archive size={12} /> Archive
                  </button>
                )}
                {review.status === "archived" && (
                  <button
                    onClick={() => updateReview({ status: "active" })}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border-none cursor-pointer"
                    style={{ backgroundColor: "var(--surface-hover)", color: "var(--text-secondary)" }}
                    title="Restore review"
                  >
                    Restore
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border-none cursor-pointer"
                  style={{ backgroundColor: "var(--surface-hover)", color: "var(--negative)", border: "1px solid var(--negative)" }}
                  title="Delete review"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Rating + progress */}
            <div className="flex items-center gap-4 flex-wrap">
              <StarRating rating={review.rating} />
              {totalTakeaways > 0 && (
                <div className="flex items-center gap-2 flex-1 min-w-[120px] max-w-[240px]">
                  <div
                    className="flex-1 h-[6px] rounded-full overflow-hidden"
                    style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${progressPct}%`,
                        backgroundColor: "var(--positive)",
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                    {implementedCount}/{totalTakeaways}
                  </span>
                </div>
              )}
              {review.duration && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {review.duration}
                </span>
              )}
            </div>

            {/* Expand toggle */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold border-none bg-transparent cursor-pointer mt-auto self-start px-0"
              style={{ color: "var(--text-secondary)" }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {expanded ? "Collapse" : `Show ${totalTakeaways} takeaway${totalTakeaways !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div
            className="px-4 pb-4 flex flex-col gap-4"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            {/* Summary blockquote */}
            {review.summary && (
              <div className="mt-4">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                  Assistant&apos;s Summary
                </h4>
                <blockquote
                  className="m-0 text-[12px] leading-relaxed rounded-lg p-4"
                  style={{
                    color: "var(--text-secondary)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    borderLeft: "3px solid rgba(222,220,209,0.22)",
                  }}
                >
                  {review.summary}
                </blockquote>
              </div>
            )}

            {/* Assessment */}
            {review.assessment && (
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                  Assistant&apos;s Assessment
                </h4>
                <div
                  className="text-[12px] leading-relaxed rounded-lg p-4"
                  style={{
                    color: "var(--text-secondary)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    borderLeft: "3px solid rgba(222,220,209,0.22)",
                  }}
                >
                  {review.assessment}
                </div>
              </div>
            )}

            {/* Screenshots */}
            <ScreenshotGallery reviewId={review.id} isYouTube={review.type === "youtube"} />

            {/* Takeaways list */}
            {review.takeaways.length > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider m-0" style={{ color: "var(--text-muted)" }}>
                    Takeaways ({review.takeaways.length})
                  </h4>
                  {eligibleTakeawayIds.length > 0 ? (
                    <label className="inline-flex items-center gap-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={allEligibleSelected}
                        onChange={(event) => onToggleReviewTakeaways(eligibleTakeawayIds, event.target.checked)}
                        className="h-3.5 w-3.5 rounded border"
                        style={{ accentColor: "#22c55e" }}
                        aria-label={`Select all eligible takeaways for ${review.title}`}
                      />
                      Select all ({selectedEligibleCount}/{eligibleTakeawayIds.length})
                    </label>
                  ) : null}
                </div>
                <div className="flex flex-col gap-3">
                  {review.takeaways.map((tw) => (
                    <TakeawayRow
                      key={tw.id}
                      takeaway={tw}
                      reviewId={review.id}
                      highlighted={Boolean(focusTakeawayId && focusTakeawayId === tw.id)}
                      selected={Boolean(selectedTakeawayLookup[takeawaySelectionKey(review.id, tw.id)])}
                      selectable={isTakeawaySelectable(tw.status)}
                      onToggleSelect={(next) => onToggleTakeaway(tw.id, next)}
                      onUpdate={onUpdate}
                      onToast={onToast}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${review.title}"? This cannot be undone.`}
          onConfirm={() => {
            deleteReview();
            setConfirmDelete(false);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

/* ── main page ─────────────────────────────────────────────────── */

export default function IdeasPageWrapper() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading...</div>}>
      <IdeasPage />
    </Suspense>
  );
}

function IdeasPage() {
  const searchParams = useSearchParams();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>("all");
  const [showModal, setShowModal] = useState(false);
  const [toasts, setToasts] = useState<BuildToast[]>([]);
  const [selectedTakeaways, setSelectedTakeaways] = useState<SelectedTakeawayLookup>({});
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSelectorLoading, setBulkSelectorLoading] = useState(false);
  const [bulkProjects, setBulkProjects] = useState<OrchestrationProjectOption[]>([]);
  const [bulkAgents, setBulkAgents] = useState<OrchestrationAgentOption[]>([]);
  const [bulkSprints, setBulkSprints] = useState<OrchestrationSprintOption[]>([]);
  const [bulkSelectedProjectId, setBulkSelectedProjectId] = useState("");
  const [bulkSelectedAssignee, setBulkSelectedAssignee] = useState("");
  const [bulkSelectedSprintId, setBulkSelectedSprintId] = useState("");

  const fetchReviews = useCallback(async () => {
    try {
      const res = await fetch("/api/ideas");
      const data = await res.json();
      setReviews(data.reviews ?? []);
      window.dispatchEvent(new Event("ideas:updated"));
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    setSelectedTakeaways((prev) => {
      const valid = new Set<string>();
      for (const review of reviews) {
        for (const takeaway of review.takeaways) {
          if (isTakeawaySelectable(takeaway.status)) {
            valid.add(takeawaySelectionKey(review.id, takeaway.id));
          }
        }
      }
      const next: SelectedTakeawayLookup = {};
      for (const key of Object.keys(prev)) {
        if (valid.has(key)) {
          next[key] = true;
        }
      }
      return next;
    });
  }, [reviews]);

  const pushToast = useCallback((kind: BuildToast["kind"], text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  /* filtered by tab */
  const filtered = useMemo(() => {
    if (tab === "all") return reviews;
    return reviews.filter((r) => r.status === tab);
  }, [reviews, tab]);

  const allSelectableTakeaways = useMemo(
    () =>
      reviews.flatMap((review) =>
        review.takeaways
          .filter((takeaway) => isTakeawaySelectable(takeaway.status))
          .map((takeaway) => ({
            reviewId: review.id,
            reviewTitle: review.title,
            takeawayId: takeaway.id,
          }))
      ),
    [reviews]
  );

  const selectedItems = useMemo(
    () =>
      allSelectableTakeaways.filter((item) =>
        Boolean(selectedTakeaways[takeawaySelectionKey(item.reviewId, item.takeawayId)])
      ),
    [allSelectableTakeaways, selectedTakeaways]
  );
  const selectedCount = selectedItems.length;
  const selectedReviewCount = useMemo(
    () => new Set(selectedItems.map((item) => item.reviewId)).size,
    [selectedItems]
  );

  useEffect(() => {
    if (!bulkModalOpen) return;

    let active = true;
    (async () => {
      setBulkSelectorLoading(true);
      setBulkError(null);
      try {
        const projectsRes = await fetch("/api/orchestration/projects");
        const projectsData = await projectsRes.json().catch(() => ({}));
        const projectOptions = Array.isArray(projectsData?.projects)
          ? projectsData.projects.map(
              (project: { id: string; name: string; companyId?: string }) => ({
                id: project.id,
                name: project.name,
                companyId: project.companyId,
              })
            )
          : [];

        if (!active) return;
        setBulkProjects(projectOptions);
        if (!bulkSelectedProjectId && projectOptions.length > 0) {
          setBulkSelectedProjectId(projectOptions[0].id);
        }
        if (projectOptions.length === 0) {
          setBulkError("No orchestration projects available yet.");
        }
      } catch {
        if (!active) return;
        setBulkProjects([]);
        setBulkError("Unable to load orchestration projects.");
      } finally {
        if (active) {
          setBulkSelectorLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [bulkModalOpen, bulkSelectedProjectId]);

  useEffect(() => {
    if (!bulkModalOpen) return;
    if (!bulkSelectedProjectId) {
      setBulkAgents([]);
      setBulkSprints([]);
      setBulkSelectedAssignee("");
      setBulkSelectedSprintId("");
      return;
    }

    let active = true;
    setBulkSelectedAssignee("");
    setBulkSelectedSprintId("");
    (async () => {
      try {
        const [agentsRes, sprintsRes] = await Promise.all([
          fetch(`/api/orchestration/projects/${bulkSelectedProjectId}/agents`),
          fetch(`/api/orchestration/projects/${bulkSelectedProjectId}/sprints`),
        ]);
        const agentsData = await agentsRes.json().catch(() => ({}));
        const sprintsData = await sprintsRes.json().catch(() => ({}));

        if (!active) return;
        setBulkAgents(
          Array.isArray(agentsData?.agents)
            ? agentsData.agents.map((agent: { id: string; name: string }) => ({
                id: agent.id,
                name: agent.name,
              }))
            : []
        );
        setBulkSprints(
          Array.isArray(sprintsData?.sprints)
            ? sprintsData.sprints.map((sprint: { id: string; name: string }) => ({
                id: sprint.id,
                name: sprint.name,
              }))
            : []
        );
      } catch {
        if (!active) return;
        setBulkAgents([]);
        setBulkSprints([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [bulkModalOpen, bulkSelectedProjectId]);

  const toggleTakeawaySelection = useCallback(
    (reviewId: string, takeawayId: string, next: boolean) => {
      const key = takeawaySelectionKey(reviewId, takeawayId);
      setSelectedTakeaways((prev) => {
        const updated = { ...prev };
        if (next) {
          updated[key] = true;
        } else {
          delete updated[key];
        }
        return updated;
      });
    },
    []
  );

  const toggleReviewTakeawaysSelection = useCallback(
    (reviewId: string, takeawayIds: string[], next: boolean) => {
      setSelectedTakeaways((prev) => {
        const updated = { ...prev };
        for (const takeawayId of takeawayIds) {
          const key = takeawaySelectionKey(reviewId, takeawayId);
          if (next) {
            updated[key] = true;
          } else {
            delete updated[key];
          }
        }
        return updated;
      });
    },
    []
  );

  const clearSelection = useCallback(() => {
    setSelectedTakeaways({});
  }, []);

  const runBulkApprove = useCallback(async () => {
    if (selectedItems.length === 0 || !bulkSelectedProjectId) return;
    setBulkSubmitting(true);
    setBulkError(null);

    const results = await Promise.allSettled(
      selectedItems.map((item) =>
        fetch(`/api/ideas/${item.reviewId}/takeaways/${item.takeawayId}/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add-to-queue",
            projectId: bulkSelectedProjectId,
            assignee: bulkSelectedAssignee || undefined,
            sprintId: bulkSelectedSprintId || undefined,
          }),
        }).then(async (response) => {
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as {
              message?: string;
              error?: string;
            };
            throw new Error(payload.message || payload.error || "Failed to promote takeaway.");
          }
          return item;
        })
      )
    );

    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - succeeded;
    if (succeeded > 0) {
      pushToast(
        "success",
        `Promoted ${succeeded} takeaway${succeeded === 1 ? "" : "s"} to the orchestration board.`
      );
      await fetchReviews();
    }
    if (failed > 0) {
      setBulkError(`${failed} takeaway${failed === 1 ? "" : "s"} failed. Review errors and retry.`);
      pushToast("error", `${failed} takeaway${failed === 1 ? "" : "s"} failed to promote.`);
    }
    if (failed === 0) {
      setBulkModalOpen(false);
      clearSelection();
    } else {
      setSelectedTakeaways((prev) => {
        const updated: SelectedTakeawayLookup = {};
        for (let idx = 0; idx < results.length; idx += 1) {
          if (results[idx]?.status === "rejected") {
            const failedItem = selectedItems[idx];
            if (failedItem) {
              updated[takeawaySelectionKey(failedItem.reviewId, failedItem.takeawayId)] = true;
            }
          }
        }
        for (const key of Object.keys(prev)) {
          if (!updated[key] && !selectedItems.some((item) => takeawaySelectionKey(item.reviewId, item.takeawayId) === key)) {
            updated[key] = true;
          }
        }
        return updated;
      });
    }

    setBulkSubmitting(false);
  }, [
    bulkSelectedAssignee,
    bulkSelectedProjectId,
    bulkSelectedSprintId,
    clearSelection,
    fetchReviews,
    pushToast,
    selectedItems,
  ]);

  /* stats */
  const stats = useMemo(() => {
    const totalTakeaways = reviews.reduce((sum, r) => sum + r.takeaways.length, 0);
    const implemented = reviews.reduce(
      (sum, r) => sum + r.takeaways.filter((t) => t.status === "shipped").length,
      0
    );
    const pending = reviews.reduce(
      (sum, r) =>
        sum +
        r.takeaways.filter((t) => t.status === "idea" || t.status === "approved").length,
      0
    );
    return {
      totalReviews: reviews.length,
      totalTakeaways,
      implemented,
      pending,
    };
  }, [reviews]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "archived", label: "Archived" },
    { key: "rejected", label: "Rejected" },
  ];
  const focusReviewId = searchParams.get("reviewId") ?? searchParams.get("review") ?? "";
  const focusTakeawayId = searchParams.get("takeawayId") ?? searchParams.get("takeaway") ?? "";

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      {/* Hero */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-[42px] h-[42px] rounded-[10px] flex items-center justify-center"
            style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
          >
            <Lightbulb size={22} color="var(--accent)" />
          </div>
          <div>
            <h1
              className="text-[22px] font-bold m-0"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
            >
              Idea Pipeline
            </h1>
            <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
              Reviews &amp; Takeaways from videos, articles, and research
            </p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex gap-3 flex-wrap">
          <StatChip label="Reviews" value={stats.totalReviews} color="var(--text-secondary)" />
          <StatChip label="Takeaways" value={stats.totalTakeaways} color="var(--text-secondary)" />
          <StatChip label="Shipped" value={stats.implemented} color="var(--positive)" />
          <StatChip label="Pending" value={stats.pending} color="var(--text-secondary)" />
        </div>
      </div>

      {/* Toolbar: tabs + submit button */}
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div className="flex gap-1 rounded-lg p-1" style={{ backgroundColor: "var(--bg)" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-md border-none cursor-pointer transition-colors"
              style={{
                backgroundColor: tab === t.key ? "var(--surface-elevated)" : "transparent",
                color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-2 rounded-lg border-none cursor-pointer"
          style={{ backgroundColor: "var(--surface-hover)", color: "var(--text-primary)", border: "0.5px solid var(--border)" }}
        >
          <Plus size={14} /> Submit URL
        </button>
      </div>

      {/* Reviews list */}
      {loading ? (
        <div className="text-center py-16 text-[13px]" style={{ color: "var(--text-muted)" }}>
          Loading reviews…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-[13px]" style={{ color: "var(--text-muted)" }}>
          No reviews found.{" "}
          <button
            onClick={() => setShowModal(true)}
            className="bg-transparent border-none underline cursor-pointer text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Submit a URL?
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              focusTakeawayId={review.id === focusReviewId ? focusTakeawayId : undefined}
              selectedTakeawayLookup={selectedTakeaways}
              onToggleTakeaway={(takeawayId, next) =>
                toggleTakeawaySelection(review.id, takeawayId, next)
              }
              onToggleReviewTakeaways={(takeawayIds, next) =>
                toggleReviewTakeawaysSelection(review.id, takeawayIds, next)
              }
              onUpdate={fetchReviews}
              onToast={pushToast}
              defaultExpanded={review.id === focusReviewId}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <SubmitModal onClose={() => setShowModal(false)} onSubmitted={fetchReviews} />
      )}
      <BulkApproveModal
        open={bulkModalOpen}
        onClose={() => {
          if (bulkSubmitting) return;
          setBulkModalOpen(false);
        }}
        loading={bulkSubmitting}
        onConfirm={runBulkApprove}
        selectedCount={selectedCount}
        selectedReviewCount={selectedReviewCount}
        projectOptions={bulkProjects}
        selectedProjectId={bulkSelectedProjectId}
        onProjectChange={setBulkSelectedProjectId}
        agentOptions={bulkAgents}
        selectedAssignee={bulkSelectedAssignee}
        onAssigneeChange={setBulkSelectedAssignee}
        sprintOptions={bulkSprints}
        selectedSprintId={bulkSelectedSprintId}
        onSprintChange={setBulkSelectedSprintId}
        loadingSelectors={bulkSelectorLoading}
        error={bulkError}
      />
      {selectedCount > 0 ? (
        <div
          className="fixed bottom-4 left-1/2 z-[75] w-[min(860px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border px-3 py-2.5 md:px-4"
          style={{
            borderColor: "rgba(74,222,128,0.35)",
            background:
              "linear-gradient(130deg, rgba(6,78,59,0.84), rgba(3,105,161,0.74) 65%, rgba(15,23,42,0.9))",
            boxShadow: "0 18px 50px rgba(2,6,23,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
            backdropFilter: "blur(8px)",
          }}
          role="region"
          aria-label="Bulk takeaway actions"
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <p className="m-0 text-[12px] font-semibold" style={{ color: "#dcfce7" }}>
              {selectedCount} selected across {selectedReviewCount} video
              {selectedReviewCount === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-lg border-none px-3 py-1.5 text-[11px] font-semibold"
                style={{ backgroundColor: "rgba(15,23,42,0.42)", color: "#cbd5e1" }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkError(null);
                  setBulkModalOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg border-none px-3 py-1.5 text-[11px] font-semibold"
                style={{ backgroundColor: "rgba(22,163,74,0.9)", color: "#f0fdf4" }}
              >
                <Check size={12} /> Approve {selectedCount} Selected
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
          {toasts.map((toast) => (
            <ToastChip key={toast.id} toast={toast} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── stat chip ─────────────────────────────────────────────────── */

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <span
        className="w-[7px] h-[7px] rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className="text-[14px] font-bold"
        style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
      >
        {value}
      </span>
    </div>
  );
}

function ToastChip({ toast }: { toast: BuildToast }) {
  const isSuccess = toast.kind === "success";
  return (
    <div
      className="rounded-xl border px-3 py-2 text-[12px] shadow-xl"
      style={{
        borderColor: isSuccess ? "rgba(34,197,94,0.38)" : "rgba(248,113,113,0.38)",
        background: isSuccess
          ? "linear-gradient(135deg, rgba(20,83,45,0.82), rgba(6,78,59,0.78))"
          : "linear-gradient(135deg, rgba(127,29,29,0.84), rgba(120,53,15,0.8))",
        color: isSuccess ? "#dcfce7" : "#fecaca",
        backdropFilter: "blur(8px)",
      }}
    >
      {toast.text}
    </div>
  );
}
