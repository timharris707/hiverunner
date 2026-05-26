"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Megaphone,
  FileText,
  Send,
  Calendar,
  TrendingUp,
  Eye,
  Linkedin,
  Twitter,
  Sparkles,
  ChevronRight,
  Clock,
  CheckCircle2,
  Edit3,
  BarChart3,
  Target,
  Zap,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Youtube,
  Hash,
  RefreshCw,
  Trash2,
  Globe,
  AlertCircle,
  Check,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { ContentDraft, ContentType } from "@/types/content";

// ── Static marketing data (unchanged) ───────────────────────────────
interface Campaign {
  id: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  status: "planning" | "active" | "completed";
  reach?: number;
}

interface CompetitorEntry {
  name: string;
  recentMove: string;
  threat: "low" | "medium" | "high";
  lastChecked: string;
}

const campaigns: Campaign[] = [
  { id: "c1", name: "SnapAudit 2.0 Launch", type: "Product Launch", startDate: "2026-03-25", endDate: "2026-04-15", status: "active", reach: 12400 },
  { id: "c2", name: "HiveRunner Operator Launch", type: "Enterprise Sales", startDate: "2026-04-01", endDate: "2026-04-30", status: "planning" },
  { id: "c3", name: "Thought Leadership Series", type: "Content", startDate: "2026-03-01", endDate: "2026-05-31", status: "active", reach: 8200 },
  { id: "c4", name: "Developer Community Launch", type: "Community", startDate: "2026-04-15", endDate: "2026-05-15", status: "planning" },
];

const competitors: CompetitorEntry[] = [
  { name: "AutoGov Inc.", recentMove: "Launched AI operations assistant for executive workflows", threat: "high", lastChecked: "2026-03-26" },
  { name: "AuditFlow", recentMove: "Series B raised, expanding into automated compliance", threat: "medium", lastChecked: "2026-03-25" },
  { name: "AgentOps.ai", recentMove: "Open-sourced agent monitoring framework", threat: "low", lastChecked: "2026-03-24" },
  { name: "Governa", recentMove: "Partnership with Big 4 firm announced", threat: "medium", lastChecked: "2026-03-26" },
];

// ── Helpers ──────────────────────────────────────────────────────────
const statusColor = (status: string) => {
  switch (status) {
    case "published": case "posted": case "completed": case "approved": return "var(--positive)";
    case "review": case "active": return "var(--info)";
    case "scheduled": return "var(--warning)";
    case "rejected": return "var(--negative)";
    case "draft": case "planning": return "var(--text-secondary, #888)";
    default: return "var(--text-secondary, #888)";
  }
};

const threatColor = (threat: string) => {
  switch (threat) {
    case "high": return "var(--negative)";
    case "medium": return "var(--warning)";
    case "low": return "var(--positive)";
    default: return "var(--text-secondary, #888)";
  }
};

const contentTypeLabel: Record<ContentType, string> = {
  tweet: "Tweet / X Post",
  linkedin: "LinkedIn Post",
  "youtube-idea": "YouTube Idea",
  "blog-intro": "Blog Post",
};

const contentTypeIcon = (type: ContentType) => {
  switch (type) {
    case "tweet": return <Twitter size={13} />;
    case "linkedin": return <Linkedin size={13} />;
    case "youtube-idea": return <Youtube size={13} />;
    case "blog-intro": return <FileText size={13} />;
  }
};

const platformColor: Record<string, string> = {
  x: "var(--info)",
  linkedin: "var(--info)",
  youtube: "var(--negative)",
  blog: "var(--text-secondary)",
};

// ── Component ─────────────────────────────────────────────────────────
export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState<"drafts" | "calendar" | "products" | "competitors">("drafts");

  const tabs = [
    { key: "drafts", label: "Content Drafts", icon: Sparkles },
    { key: "calendar", label: "Calendar", icon: Calendar },
    { key: "products", label: "Product Marketing", icon: Target },
    { key: "competitors", label: "Competitors", icon: Eye },
  ] as const;

  return (
    <div style={{ padding: "24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "var(--surface-hover)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Megaphone size={20} color="var(--accent)" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text-primary)", margin: 0 }}>
              Marketing Command Center
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-secondary, #888)", margin: 0 }}>
              Quill — Content & Marketing Strategy · Drafts, Approvals, Publishing
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 24,
        borderBottom: "1px solid var(--border, #2A2A2A)", paddingBottom: 0,
      }}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 16px", fontSize: 13, fontWeight: active ? 600 : 400,
                color: active ? "var(--text-primary)" : "var(--text-secondary, #888)",
                background: "transparent", border: "none", cursor: "pointer",
                borderBottom: active ? "2px solid rgba(222,220,209,0.22)" : "2px solid transparent",
                transition: "all 150ms ease",
                fontFamily: "var(--font-body)",
              }}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "drafts" && <DraftsView />}
      {activeTab === "calendar" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>
          <CalendarView campaigns={campaigns} />
        </div>
      )}
      {activeTab === "products" && <ProductMarketing />}
      {activeTab === "competitors" && <CompetitorTracking competitors={competitors} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

// ── Drafts View — main feature ─────────────────────────────────────────────────

function DraftsView() {
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<"all" | "draft" | "approved" | "rejected" | "published">("all");

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch("/api/content/drafts");
      const data = await res.json();
      setDrafts(data.drafts || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  const filtered = filterStatus === "all" ? drafts : drafts.filter((d) => d.status === filterStatus);

  const counts = {
    all: drafts.length,
    draft: drafts.filter((d) => d.status === "draft").length,
    approved: drafts.filter((d) => d.status === "approved").length,
    rejected: drafts.filter((d) => d.status === "rejected").length,
    published: drafts.filter((d) => d.status === "published").length,
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 24 }}>
      {/* Draft list */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <SectionLabel>Content Drafts</SectionLabel>
          <button
            onClick={fetchDrafts}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #888)", padding: 4 }}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Status filter pills */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {(["all", "draft", "approved", "rejected", "published"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                padding: "4px 12px", fontSize: 11, fontWeight: 600, borderRadius: 20,
                border: `1px solid ${filterStatus === s ? statusColor(s === "all" ? "draft" : s) : "var(--border, #2A2A2A)"}`,
                background: filterStatus === s ? `${statusColor(s === "all" ? "draft" : s)}18` : "transparent",
                color: filterStatus === s ? statusColor(s === "all" ? "draft" : s) : "var(--text-secondary, #888)",
                cursor: "pointer", textTransform: "capitalize",
              }}
            >
              {s} {counts[s] > 0 && `(${counts[s]})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary, #888)", fontSize: 13 }}>
            Loading drafts...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            textAlign: "center", padding: 48,
            background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
            borderRadius: 12, color: "var(--text-secondary, #888)", fontSize: 13,
          }}>
            <Sparkles size={32} style={{ opacity: 0.3, marginBottom: 12, display: "block", margin: "0 auto 12px" }} />
            No {filterStatus !== "all" ? filterStatus : ""} drafts yet.
            <br />Use the generator on the right to create content with Quill.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map((draft) => (
              <DraftCard key={draft.id} draft={draft} onUpdate={fetchDrafts} />
            ))}
          </div>
        )}
      </div>

      {/* Generator side panel */}
      <ContentGenerator onGenerated={fetchDrafts} />
    </div>
  );
}

// ── Draft Card ─────────────────────────────────────────────────────────────────

function DraftCard({ draft, onUpdate }: { draft: ContentDraft; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(draft.content);
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const color = platformColor[draft.platform] || "var(--text-secondary)";

  const patch = useCallback(async (body: Record<string, unknown>) => {
    setLoading(true);
    try {
      await fetch(`/api/content/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onUpdate();
    } finally {
      setLoading(false);
    }
  }, [draft.id, onUpdate]);

  const handleDelete = useCallback(async () => {
    if (!confirm("Delete this draft?")) return;
    await fetch(`/api/content/drafts/${draft.id}`, { method: "DELETE" });
    onUpdate();
  }, [draft.id, onUpdate]);

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      await fetch(`/api/content/drafts/${draft.id}/publish`, { method: "POST" });
      onUpdate();
    } finally {
      setPublishing(false);
    }
  }, [draft.id, onUpdate]);

  return (
    <div style={{
      background: "var(--surface, #1A1A1A)",
      border: `1px solid var(--border, #2A2A2A)`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* Header row */}
      <div
        style={{ padding: "14px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
        onClick={() => setExpanded((x) => !x)}
      >
        <div style={{ color, display: "flex" }}>{contentTypeIcon(draft.type)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>
            {draft.title || draft.topic}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary, #888)", display: "flex", gap: 8, alignItems: "center" }}>
            <span>{contentTypeLabel[draft.type]}</span>
            <span>·</span>
            <span>{new Date(draft.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          color: statusColor(draft.status), background: "var(--surface-hover)", border: `1px solid ${statusColor(draft.status)}`,
          padding: "3px 8px", borderRadius: 4,
        }}>
          {draft.status}
        </span>
        {expanded ? <ChevronUp size={14} color="var(--text-secondary, #888)" /> : <ChevronDown size={14} color="var(--text-secondary, #888)" />}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--border, #2A2A2A)" }}>
          {/* Content */}
          <div style={{ marginTop: 12 }}>
            {editing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                style={{
                  width: "100%", minHeight: 120, padding: "10px 12px",
                  background: "var(--surface-elevated, #242424)",
                  border: "1px solid var(--border, #2A2A2A)", borderRadius: 8,
                  color: "var(--text-primary)", fontSize: 13, lineHeight: 1.6, resize: "vertical",
                  fontFamily: "var(--font-body)", boxSizing: "border-box",
                }}
              />
            ) : (
              <div style={{
                fontSize: 13, color: "var(--text-secondary, #ccc)",
                lineHeight: 1.6, whiteSpace: "pre-wrap",
                background: "var(--surface-elevated, #1E1E1E)",
                padding: "12px 14px", borderRadius: 8,
              }}>
                {draft.content}
              </div>
            )}
          </div>

          {/* Hashtags */}
          {draft.hashtags && draft.hashtags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {draft.hashtags.map((h) => (
                <span key={h} style={{
                  fontSize: 11, color: color, background: `${color}12`,
                  padding: "2px 8px", borderRadius: 12, display: "flex", alignItems: "center", gap: 2,
                }}>
                  <Hash size={9} />{h.replace(/^#/, "")}
                </span>
              ))}
            </div>
          )}

          {/* YouTube extras */}
          {draft.type === "youtube-idea" && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {draft.hook && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--negative)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                    Opening Hook (0–15s)
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary, #ccc)", fontStyle: "italic", lineHeight: 1.5 }}>
                    &quot;{draft.hook}&quot;
                  </div>
                </div>
              )}
              {draft.videoTags && draft.videoTags.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted, #666)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                    Tags
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {draft.videoTags.map((t) => (
                      <span key={t} style={{
                        fontSize: 10, color: "var(--text-secondary, #888)",
                        background: "var(--surface-elevated, #242424)",
                        padding: "1px 6px", borderRadius: 3,
                      }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reject note */}
          {draft.status === "rejected" && draft.notes && (
            <div style={{
              marginTop: 10, padding: "8px 12px",
              background: "var(--negative, #ef444418)", borderRadius: 6,
              fontSize: 12, color: "var(--negative, #ef4444)",
            }}>
              <AlertCircle size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "text-bottom" }} />
              {draft.notes}
            </div>
          )}

          {/* Reject input */}
          {showRejectInput && (
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <input
                placeholder="Reason for rejection (optional)"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                style={{
                  flex: 1, padding: "7px 10px", fontSize: 12,
                  background: "var(--surface-elevated, #242424)",
                  border: "1px solid var(--border, #2A2A2A)", borderRadius: 6,
                  color: "var(--text-primary)", outline: "none", fontFamily: "var(--font-body)",
                }}
              />
              <button
                onClick={async () => {
                  await patch({ status: "rejected", notes: rejectNote });
                  setShowRejectInput(false);
                }}
                style={{
                  padding: "7px 14px", fontSize: 12, borderRadius: 6,
                  background: "var(--negative, #ef4444)", border: "none",
                  color: "#fff", cursor: "pointer", fontWeight: 600,
                }}
              >
                Confirm
              </button>
              <button
                onClick={() => setShowRejectInput(false)}
                style={{
                  padding: "7px 10px", fontSize: 12, borderRadius: 6,
                  background: "transparent", border: "1px solid var(--border, #2A2A2A)",
                  color: "var(--text-secondary, #888)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Action bar */}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {/* Edit toggle */}
            {draft.status !== "published" && (
              editing ? (
                <>
                  <button
                    onClick={async () => {
                      await patch({ content: editContent });
                      setEditing(false);
                    }}
                    disabled={loading}
                    style={actionBtnStyle("var(--positive)")}
                  >
                    <Check size={12} /> Save
                  </button>
                  <button onClick={() => { setEditing(false); setEditContent(draft.content); }} style={actionBtnStyle()}>
                    <X size={12} /> Cancel
                  </button>
                </>
              ) : (
                <button onClick={() => setEditing(true)} style={actionBtnStyle()}>
                  <Edit3 size={12} /> Edit
                </button>
              )
            )}

            {/* Approve */}
            {(draft.status === "draft" || draft.status === "rejected") && (
              <button
                onClick={() => patch({ status: "approved" })}
                disabled={loading}
                style={actionBtnStyle("var(--positive)")}
              >
                <ThumbsUp size={12} /> Approve
              </button>
            )}

            {/* Reject */}
            {draft.status === "draft" && (
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={loading}
                style={actionBtnStyle("var(--negative)")}
              >
                <ThumbsDown size={12} /> Reject
              </button>
            )}

            {/* Un-approve (reset to draft) */}
            {draft.status === "approved" && (
              <button
                onClick={() => patch({ status: "draft" })}
                disabled={loading}
                style={actionBtnStyle()}
              >
                <RefreshCw size={12} /> Reset
              </button>
            )}

            {/* Publish */}
            {draft.status === "approved" && (
              <button
                onClick={handlePublish}
                disabled={publishing}
                style={actionBtnStyle(color)}
              >
                {publishing ? (
                  <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                ) : (
                  <Globe size={12} />
                )}
                Publish to {draft.platform === "x" ? "X" : draft.platform === "linkedin" ? "LinkedIn" : draft.platform === "youtube" ? "YouTube" : "Blog"}
              </button>
            )}

            {/* Published link placeholder */}
            {draft.status === "published" && (
              <span style={{ fontSize: 12, color: "var(--positive)", display: "flex", alignItems: "center", gap: 4 }}>
                <CheckCircle2 size={12} /> Published {draft.publishedAt ? new Date(draft.publishedAt).toLocaleDateString() : ""}
              </span>
            )}

            {/* Delete */}
            <button
              onClick={handleDelete}
              style={{ ...actionBtnStyle(), marginLeft: "auto" }}
              title="Delete draft"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function actionBtnStyle(color?: string): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 5,
    padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6,
    border: `1px solid ${color || "var(--border, #2A2A2A)"}`,
    background: color ? "var(--surface-hover)" : "transparent",
    color: color || "var(--text-secondary, #888)",
    cursor: "pointer", transition: "all 120ms ease",
    fontFamily: "var(--font-body)",
  };
}

// ── Content Generator ──────────────────────────────────────────────────────────

function ContentGenerator({ onGenerated }: { onGenerated: () => void }) {
  const [type, setType] = useState<ContentType>("tweet");
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [lastDraft, setLastDraft] = useState<ContentDraft | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!topic.trim()) return;
    setGenerating(true);
    setError("");
    setLastDraft(null);
    try {
      const res = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, topic: topic.trim(), context: context.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setLastDraft(data.draft);
      onGenerated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [type, topic, context, onGenerated]);

  const typeOptions: { value: ContentType; label: string; icon: React.ReactNode; color: string }[] = [
    { value: "tweet", label: "Tweet / X", icon: <Twitter size={13} />, color: "var(--info)" },
    { value: "linkedin", label: "LinkedIn", icon: <Linkedin size={13} />, color: "var(--info)" },
    { value: "youtube-idea", label: "YouTube Idea", icon: <Youtube size={13} />, color: "var(--negative)" },
    { value: "blog-intro", label: "Blog Post", icon: <FileText size={13} />, color: "var(--text-secondary)" },
  ];

  return (
    <div style={{
      background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
      borderRadius: 12, padding: 20, height: "fit-content", position: "sticky", top: 72,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: "var(--surface-hover)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Sparkles size={14} color="var(--accent)" />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
            Quill Content Generator
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary, #888)" }}>
            AI-powered · Approval flow
          </div>
        </div>
      </div>

      {/* Content type selector */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted, #666)", marginBottom: 8, textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
          Content Type
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {typeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setType(opt.value)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 10px", fontSize: 12, fontWeight: type === opt.value ? 700 : 500,
                borderRadius: 7,
                border: `1px solid ${type === opt.value ? opt.color : "var(--border, #2A2A2A)"}`,
                background: type === opt.value ? "var(--surface-hover)" : "var(--surface-elevated, #1E1E1E)",
                color: type === opt.value ? opt.color : "var(--text-secondary, #888)",
                cursor: "pointer", transition: "all 120ms ease",
              }}
            >
              <span style={{ color: opt.color }}>{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Topic input */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted, #666)", marginBottom: 6, textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
          Topic / Brief
        </label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) handleGenerate(); }}
          placeholder={
            type === "tweet" ? "e.g. Our AI agents just shipped a feature in 3 minutes" :
            type === "linkedin" ? "e.g. Why every founder needs an AI operations team" :
            type === "youtube-idea" ? "e.g. How we use AI agents to run our startup" :
            "e.g. The future of mortgage lending and AI"
          }
          rows={3}
          style={{
            width: "100%", padding: "10px 12px", fontSize: 13,
            background: "var(--surface-elevated, #1E1E1E)",
            border: "1px solid var(--border, #2A2A2A)", borderRadius: 8,
            color: "var(--text-primary)", outline: "none", resize: "vertical",
            fontFamily: "var(--font-body)", lineHeight: 1.5, boxSizing: "border-box",
          }}
        />
      </div>

      {/* Brand context toggle */}
      <button
        onClick={() => setShowContext((x) => !x)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 11, color: "var(--text-secondary, #888)", marginBottom: 10,
          display: "flex", alignItems: "center", gap: 4, padding: 0,
        }}
      >
        {showContext ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        {showContext ? "Hide" : "Add"} brand context
      </button>

      {showContext && (
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Optional: paste brand guidelines, key messages, or relevant context for Quill..."
          rows={3}
          style={{
            width: "100%", padding: "10px 12px", fontSize: 12, marginBottom: 10,
            background: "var(--surface-elevated, #1E1E1E)",
            border: "1px solid var(--border, #2A2A2A)", borderRadius: 8,
            color: "var(--text-secondary, #ccc)", outline: "none", resize: "vertical",
            fontFamily: "var(--font-body)", lineHeight: 1.5, boxSizing: "border-box",
          }}
        />
      )}

      {/* Error */}
      {error && (
        <div style={{
          marginBottom: 10, padding: "8px 12px", borderRadius: 6,
          background: "var(--negative, #ef444418)", fontSize: 12, color: "var(--negative, #ef4444)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating || !topic.trim()}
        style={{
          width: "100%", padding: "11px 0", fontSize: 13, fontWeight: 700,
          background: generating ? "var(--surface-elevated, #242424)" : "var(--surface-hover)",
          border: "none", borderRadius: 8, cursor: generating ? "wait" : !topic.trim() ? "not-allowed" : "pointer",
          color: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          opacity: !topic.trim() ? 0.4 : 1, transition: "all 150ms ease",
          fontFamily: "var(--font-body)",
        }}
      >
        {generating ? (
          <>
            <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
            Quill is writing...
          </>
        ) : (
          <>
            <Edit3 size={14} />
            Generate with Quill
          </>
        )}
      </button>

      <div style={{ fontSize: 10, color: "var(--text-tertiary, #555)", textAlign: "center", marginTop: 6 }}>
        ⌘+Enter to generate · Drafts go to approval queue
      </div>

      {/* Last generated preview */}
      {lastDraft && !generating && (
        <div style={{
          marginTop: 14, padding: 12,
          background: "var(--surface-elevated, #1E1E1E)",
          borderRadius: 8, border: "1px solid var(--positive, #10b98130)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--positive)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
            <Check size={10} /> Draft Created
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary, #ccc)", lineHeight: 1.5 }}>
            {lastDraft.title || lastDraft.topic}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary, #666)", marginTop: 4 }}>
            See in drafts list → approve or edit before publishing
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section label helper ───────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2,
      color: "var(--text-primary)", marginBottom: 0, display: "flex", alignItems: "center", gap: 8,
    }}>
      <div style={{ width: 3, height: 14, background: "var(--accent)", borderRadius: 2 }} />
      {children}
    </div>
  );
}

// ── Calendar View ──────────────────────────────────────────────────────────────

function CalendarView({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <div>
      <SectionLabel>Active Campaigns</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        {campaigns.map((c) => (
          <div key={c.id} style={{
            background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
            borderRadius: 10, padding: "14px 18px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{c.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary, #888)", marginTop: 2 }}>
                {c.type} · {c.startDate} → {c.endDate}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {c.reach && (
                <span style={{ fontSize: 12, color: "var(--text-secondary, #888)" }}>
                  {c.reach.toLocaleString()} reach
                </span>
              )}
              <span style={{
                fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                color: statusColor(c.status), background: "var(--surface-hover)", border: `1px solid ${statusColor(c.status)}`,
                padding: "3px 8px", borderRadius: 4,
              }}>
                {c.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Product Marketing ──────────────────────────────────────────────────────────

function ProductMarketing() {
  const products = [
    {
      name: "HiveRunner",
      tagline: "Autonomous Team Operations",
      description: "Local-first workspace orchestration for goals, tasks, agents, and execution review.",
      status: "GA",
      metrics: { users: "142", nps: "72", mrr: "$48K" },
      color: "#7C3AED",
      campaigns: ["Enterprise Push Q2", "Thought Leadership Series"],
      keyMessages: [
        "Save 40+ hours/month on board preparation",
        "AI-generated minutes with 99.2% accuracy",
        "Full compliance audit trail built-in",
      ],
    },
    {
      name: "SnapAudit",
      tagline: "Financial Reviews at Machine Speed",
      description: "Automated financial audit and review tool that processes complex financial statements in under 60 seconds.",
      status: "v2.0 Launch",
      metrics: { users: "89", nps: "68", mrr: "$32K" },
      color: "#10B981",
      campaigns: ["SnapAudit 2.0 Launch", "Developer Community"],
      keyMessages: [
        "60-second financial reviews vs. 3-day manual process",
        "SOC 2 Type II certified",
        "Integrates with QuickBooks, Xero, NetSuite",
      ],
    },
  ];

  return (
    <div>
      <SectionLabel>Product Marketing</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
        {products.map((product) => (
          <div key={product.name} style={{
            background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
            borderRadius: 12, padding: 20, borderLeft: `3px solid ${product.color}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>{product.name}</div>
                <div style={{ fontSize: 12, color: product.color, fontWeight: 500 }}>{product.tagline}</div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                color: product.color, background: `${product.color}18`,
                padding: "4px 10px", borderRadius: 4,
              }}>
                {product.status}
              </span>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary, #ccc)", lineHeight: 1.6, margin: "0 0 14px 0" }}>
              {product.description}
            </p>
            <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
              {Object.entries(product.metrics).map(([key, val]) => (
                <div key={key} style={{ background: "var(--surface-elevated, #242424)", padding: "8px 14px", borderRadius: 6 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{val}</div>
                  <div style={{ fontSize: 10, color: "var(--text-secondary, #888)", textTransform: "uppercase" }}>{key}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>Key Messages</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
              {product.keyMessages.map((msg, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary, #ccc)" }}>
                  <ChevronRight size={10} color={product.color} />
                  {msg}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary, #888)", display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart3 size={10} />
              Campaigns: {product.campaigns.join(", ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Competitor Tracking ───────────────────────────────────────────────────────

function CompetitorTracking({ competitors }: { competitors: CompetitorEntry[] }) {
  return (
    <div>
      <SectionLabel>Competitor Tracking</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        {competitors.map((comp) => (
          <div key={comp.name} style={{
            background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
            borderRadius: 10, padding: "14px 18px",
            borderLeft: `3px solid ${threatColor(comp.threat)}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{comp.name}</div>
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                color: threatColor(comp.threat), background: `${threatColor(comp.threat)}18`,
                padding: "2px 8px", borderRadius: 3,
              }}>
                {comp.threat} threat
              </span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary, #ccc)", marginBottom: 4 }}>{comp.recentMove}</div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary, #666)" }}>Last checked: {comp.lastChecked}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
