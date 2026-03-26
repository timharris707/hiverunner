"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
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
} from "lucide-react";

/* ── types ─────────────────────────────────────────────────────── */

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

/* ── constants ─────────────────────────────────────────────────── */

const SOURCE_BADGES: Record<string, { icon: string; label: string }> = {
  youtube: { icon: "🎬", label: "YouTube" },
  reddit: { icon: "💬", label: "Reddit" },
  hn: { icon: "🔶", label: "HN" },
  article: { icon: "🔗", label: "Article" },
  manual: { icon: "🔗", label: "Link" },
};

const TAKEAWAY_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  idea: { label: "Idea", color: "#60a5fa", bg: "rgba(96,165,250,0.15)" },
  approved: { label: "Approved", color: "#34d399", bg: "rgba(52,211,153,0.15)" },
  building: { label: "Building", color: "#fbbf24", bg: "rgba(251,191,36,0.15)" },
  shipped: { label: "Shipped", color: "#10b981", bg: "rgba(16,185,129,0.15)" },
  rejected: { label: "Rejected", color: "#f87171", bg: "rgba(248,113,113,0.15)" },
};

const REVIEW_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "#60a5fa", bg: "rgba(96,165,250,0.15)" },
  archived: { label: "Archived", color: "#9ca3af", bg: "rgba(156,163,175,0.15)" },
  rejected: { label: "Rejected", color: "#f87171", bg: "rgba(248,113,113,0.15)" },
};

const PRIORITY_ICONS: Record<string, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

type FilterTab = "all" | "active" | "archived" | "rejected";

/* ── helpers ────────────────────────────────────────────────────── */

function getVideoId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
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
            backgroundColor: "var(--accent)",
            color: "#fff",
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

/* ── takeaway row ──────────────────────────────────────────────── */

function TakeawayRow({
  takeaway,
  reviewId,
  onUpdate,
}: {
  takeaway: Takeaway;
  reviewId: string;
  onUpdate: () => void;
}) {
  const [notes, setNotes] = useState(takeaway.notes);
  const [saving, setSaving] = useState(false);
  const sm = TAKEAWAY_STATUS[takeaway.status] ?? TAKEAWAY_STATUS.idea;

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

  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-3 transition-colors"
      style={{
        backgroundColor: "var(--bg)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Top row: title + badges */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
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
          </div>
          <p className="text-[12px] m-0 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {takeaway.description}
          </p>
        </div>

        {/* Agent avatar */}
        {takeaway.assigned_to && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <AgentAvatar agentId={takeaway.assigned_to} size={24} />
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {takeaway.assigned_to}
            </span>
          </div>
        )}
      </div>

      {/* Timestamp + context + GitHub */}
      <div className="flex items-center gap-4 flex-wrap">
        {takeaway.video_url && (
          <a
            href={takeaway.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] font-mono font-semibold px-2 py-1 rounded-md no-underline transition-colors hover:brightness-110"
            style={{
              color: "#f59e0b",
              backgroundColor: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.2)",
            }}
          >
            📹 @{takeaway.video_timestamp}
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
              style={{ backgroundColor: "rgba(52,211,153,0.15)", color: "#34d399" }}
            >
              <Check size={12} /> Approve
            </button>
            <button
              onClick={() => updateTakeaway({ status: "rejected" })}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border-none cursor-pointer transition-colors"
              style={{ backgroundColor: "rgba(248,113,113,0.15)", color: "#f87171" }}
            >
              <XCircle size={12} /> Reject
            </button>
          </>
        )}
        {takeaway.status === "approved" && (
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  await fetch(`/api/ideas/${reviewId}/takeaways/${takeaway.id}/build`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "build-now", project: "mission-control" }),
                  });
                  updateTakeaway({ status: "building" });
                } finally { setSaving(false); }
              }}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border-none cursor-pointer transition-colors"
              style={{ backgroundColor: "rgba(239,68,68,0.2)", color: "#ef4444" }}
            >
              <Hammer size={12} /> Build Now
            </button>
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  await fetch(`/api/ideas/${reviewId}/takeaways/${takeaway.id}/build`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "add-to-queue", project: "mission-control" }),
                  });
                  updateTakeaway({ status: "building" });
                } finally { setSaving(false); }
              }}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border-none cursor-pointer transition-colors"
              style={{ backgroundColor: "rgba(251,191,36,0.15)", color: "#fbbf24" }}
            >
              <Plus size={12} /> Add to Queue
            </button>
          </div>
        )}
        {takeaway.status === "building" && (
          <button
            onClick={() => updateTakeaway({ status: "shipped" })}
            disabled={saving}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border-none cursor-pointer transition-colors"
            style={{ backgroundColor: "rgba(16,185,129,0.15)", color: "#10b981" }}
          >
            <Check size={12} /> Mark Shipped
          </button>
        )}

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
    </div>
  );
}

/* ── review card ───────────────────────────────────────────────── */

function ReviewCard({
  review,
  onUpdate,
  defaultExpanded,
}: {
  review: Review;
  onUpdate: () => void;
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
                    style={{ backgroundColor: "rgba(96,165,250,0.12)", color: "#60a5fa" }}
                    title="Restore review"
                  >
                    Restore
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border-none cursor-pointer"
                  style={{ backgroundColor: "rgba(248,113,113,0.1)", color: "#f87171" }}
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
                        backgroundColor: "#10b981",
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
                  Henry&apos;s Summary
                </h4>
                <blockquote
                  className="m-0 text-[12px] leading-relaxed rounded-lg p-4"
                  style={{
                    color: "var(--text-secondary)",
                    backgroundColor: "rgba(96,165,250,0.06)",
                    borderLeft: "3px solid #60a5fa",
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
                  Henry&apos;s Assessment
                </h4>
                <div
                  className="text-[12px] leading-relaxed rounded-lg p-4"
                  style={{
                    color: "var(--text-secondary)",
                    backgroundColor: "rgba(251,191,36,0.06)",
                    borderLeft: "3px solid #fbbf24",
                  }}
                >
                  {review.assessment}
                </div>
              </div>
            )}

            {/* Takeaways list */}
            {review.takeaways.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
                  Takeaways ({review.takeaways.length})
                </h4>
                <div className="flex flex-col gap-3">
                  {review.takeaways.map((tw) => (
                    <TakeawayRow
                      key={tw.id}
                      takeaway={tw}
                      reviewId={review.id}
                      onUpdate={onUpdate}
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

export default function IdeasPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>("all");
  const [showModal, setShowModal] = useState(false);

  const fetchReviews = useCallback(async () => {
    try {
      const res = await fetch("/api/ideas");
      const data = await res.json();
      setReviews(data.reviews ?? []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  /* filtered by tab */
  const filtered = useMemo(() => {
    if (tab === "all") return reviews;
    return reviews.filter((r) => r.status === tab);
  }, [reviews, tab]);

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

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      {/* Hero */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-[42px] h-[42px] rounded-[10px] flex items-center justify-center"
            style={{ backgroundColor: "rgba(251,191,36,0.12)" }}
          >
            <Lightbulb size={22} color="#fbbf24" />
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
          <StatChip label="Reviews" value={stats.totalReviews} color="#60a5fa" />
          <StatChip label="Takeaways" value={stats.totalTakeaways} color="#a78bfa" />
          <StatChip label="Shipped" value={stats.implemented} color="#10b981" />
          <StatChip label="Pending" value={stats.pending} color="#fbbf24" />
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
          style={{ backgroundColor: "var(--accent)", color: "#fff" }}
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
            style={{ color: "var(--accent)" }}
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
              onUpdate={fetchReviews}
              defaultExpanded={review.status === "active"}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <SubmitModal onClose={() => setShowModal(false)} onSubmitted={fetchReviews} />
      )}
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
