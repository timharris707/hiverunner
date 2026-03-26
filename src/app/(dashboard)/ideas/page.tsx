"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  Lightbulb,
  Search,
  Plus,
  X,
  ExternalLink,
  ArrowRight,
  Filter,
} from "lucide-react";

/* ── types ─────────────────────────────────────────────────────── */

interface Idea {
  id: string;
  title: string;
  source: string;
  source_url: string;
  source_timestamp?: string;
  source_context?: string;
  discovered_at: string;
  discovered_by: string;
  status: string;
  summary: string;
  priority: string;
  effort: string;
  tags: string[];
  github_issue: string;
  assigned_to: string;
}

/* ── constants ─────────────────────────────────────────────────── */

const STATUS_ORDER = [
  "idea",
  "discovered",
  "reviewed",
  "approved",
  "building",
  "shipped",
  "rejected",
  "parked",
];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  idea: { label: "Discovered", color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  discovered: { label: "Discovered", color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  reviewed: { label: "Reviewed", color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  approved: { label: "Approved", color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  building: { label: "Building", color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  shipped: { label: "Shipped", color: "#10b981", bg: "rgba(16,185,129,0.12)" },
  rejected: { label: "Rejected", color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  parked: { label: "Parked", color: "#9ca3af", bg: "rgba(156,163,175,0.12)" },
};

const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: "High", color: "#f87171", bg: "rgba(248,113,113,0.15)" },
  medium: { label: "Med", color: "#fbbf24", bg: "rgba(251,191,36,0.15)" },
  low: { label: "Low", color: "#34d399", bg: "rgba(52,211,153,0.15)" },
};

const SOURCE_ICONS: Record<string, string> = {
  youtube: "🎬",
  reddit: "💬",
  hn: "🔶",
  manual: "🔗",
  scout: "🔭",
};

/* ── helpers ────────────────────────────────────────────────────── */

function Badge({
  label,
  color,
  bg,
}: {
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 600,
        padding: "2px 7px",
        borderRadius: "4px",
        color,
        backgroundColor: bg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
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
      style={{ color: "var(--text-muted)", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "3px" }}
    >
      #{m[2]} <ExternalLink size={10} />
    </a>
  );
}

/* ── submit modal ──────────────────────────────────────────────── */

function SubmitModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("manual");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, title, notes, source }),
      });
      onSubmitted();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "24px",
          width: "100%",
          maxWidth: "480px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
            Submit Idea
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </div>

        <input
          className="input"
          placeholder="URL (optional)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px", color: "var(--text-primary)", fontSize: "13px", width: "100%" }}
        />
        <input
          className="input"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px", color: "var(--text-primary)", fontSize: "13px", width: "100%" }}
        />
        <textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px", color: "var(--text-primary)", fontSize: "13px", width: "100%", resize: "vertical" }}
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px", color: "var(--text-primary)", fontSize: "13px", width: "100%" }}
        >
          <option value="manual">🔗 Manual</option>
          <option value="youtube">🎬 YouTube</option>
          <option value="reddit">💬 Reddit</option>
          <option value="hn">🔶 Hacker News</option>
          <option value="scout">🔭 Scout</option>
        </select>

        <button
          onClick={handleSubmit}
          disabled={submitting || (!url && !title)}
          style={{
            backgroundColor: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "10px 16px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: submitting || (!url && !title) ? "not-allowed" : "pointer",
            opacity: submitting || (!url && !title) ? 0.5 : 1,
          }}
        >
          {submitting ? "Submitting…" : "Submit Idea"}
        </button>
      </div>
    </div>
  );
}

/* ── detail drawer ─────────────────────────────────────────────── */

function DetailDrawer({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const sm = STATUS_META[idea.status] ?? STATUS_META.idea;
  const pm = PRIORITY_META[idea.priority] ?? PRIORITY_META.medium;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
        backgroundColor: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(3px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "520px",
          backgroundColor: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          padding: "28px 24px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "22px" }}>{SOURCE_ICONS[idea.source] ?? "🔗"}</span>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
              {idea.title}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", flexShrink: 0 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Badge label={sm.label} color={sm.color} bg={sm.bg} />
          <Badge label={`Priority: ${pm.label}`} color={pm.color} bg={pm.bg} />
          <Badge label={`Effort: ${idea.effort}`} color="var(--text-secondary)" bg="rgba(255,255,255,0.06)" />
        </div>

        <p style={{ fontSize: "13px", lineHeight: 1.7, color: "var(--text-secondary)" }}>
          {idea.summary || "No summary available."}
        </p>

        {idea.assigned_to && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <AgentAvatar agentId={idea.assigned_to} size={28} />
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Assigned to <strong style={{ color: "var(--text-primary)" }}>{idea.assigned_to}</strong>
            </span>
          </div>
        )}

        {idea.tags.length > 0 && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {idea.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: "10px",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(255,255,255,0.05)",
                  color: "var(--text-muted)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px", color: "var(--text-muted)" }}>
          {idea.source_url && (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <a href={idea.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                {idea.source === "youtube" ? "📹" : "🔗"} Source{idea.source_timestamp ? ` @ ${idea.source_timestamp}` : ""} <ExternalLink size={11} />
              </a>
              {idea.source_context && (
                <span style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic", paddingLeft: "2px" }}>
                  {idea.source_context}
                </span>
              )}
            </div>
          )}
          <GithubIssueLink issue={idea.github_issue} />
          <span>Discovered {new Date(idea.discovered_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

/* ── idea card ─────────────────────────────────────────────────── */

function IdeaCard({ idea, onClick }: { idea: Idea; onClick: () => void }) {
  const sm = STATUS_META[idea.status] ?? STATUS_META.idea;
  const pm = PRIORITY_META[idea.priority] ?? PRIORITY_META.medium;

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "16px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        transition: "border-color 150ms ease, background-color 150ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = sm.color;
        e.currentTarget.style.backgroundColor = "var(--surface-elevated)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.backgroundColor = "var(--surface)";
      }}
    >
      {/* header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <span style={{ fontSize: "16px", flexShrink: 0 }}>{SOURCE_ICONS[idea.source] ?? "🔗"}</span>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {idea.title}
          </span>
        </div>
        <ArrowRight size={14} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: "2px" }} />
      </div>

      {/* badges */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        <Badge label={sm.label} color={sm.color} bg={sm.bg} />
        <Badge label={pm.label} color={pm.color} bg={pm.bg} />
        <Badge label={idea.effort} color="var(--text-secondary)" bg="rgba(255,255,255,0.06)" />
      </div>

      {/* summary */}
      <p style={{ fontSize: "11px", lineHeight: 1.5, color: "var(--text-muted)", margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {idea.summary}
      </p>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {idea.tags.slice(0, 3).map((t) => (
            <span key={t} style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "3px", backgroundColor: "rgba(255,255,255,0.04)", color: "var(--text-muted)" }}>
              {t}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <GithubIssueLink issue={idea.github_issue} />
          {idea.assigned_to && <AgentAvatar agentId={idea.assigned_to} size={22} />}
        </div>
      </div>
    </button>
  );
}

/* ── main page ─────────────────────────────────────────────────── */

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<Idea | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const fetchIdeas = useCallback(async () => {
    try {
      const res = await fetch("/api/ideas");
      const data = await res.json();
      setIdeas(data.ideas ?? []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIdeas(); }, [fetchIdeas]);

  /* derived */
  const sources = useMemo(() => [...new Set(ideas.map((i) => i.source))], [ideas]);
  const agents = useMemo(() => [...new Set(ideas.map((i) => i.assigned_to).filter(Boolean))], [ideas]);

  const filtered = useMemo(() => {
    return ideas.filter((i) => {
      if (filterStatus !== "all" && i.status !== filterStatus) return false;
      if (filterPriority !== "all" && i.priority !== filterPriority) return false;
      if (filterSource !== "all" && i.source !== filterSource) return false;
      if (filterAgent !== "all" && i.assigned_to !== filterAgent) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          i.title.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [ideas, search, filterStatus, filterPriority, filterSource, filterAgent]);

  /* stats */
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    ideas.forEach((i) => {
      byStatus[i.status] = (byStatus[i.status] || 0) + 1;
      byPriority[i.priority] = (byPriority[i.priority] || 0) + 1;
    });
    return { total: ideas.length, byStatus, byPriority };
  }, [ideas]);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* hero */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "10px",
              backgroundColor: "rgba(251,191,36,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Lightbulb size={22} color="#fbbf24" />
          </div>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-heading)", margin: 0 }}>
              Idea Pipeline
            </h1>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
              Capture, analyze, and ship ideas from any source
            </p>
          </div>
        </div>

        {/* stat chips */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <StatChip label="Total" value={stats.total} color="#60a5fa" />
          {STATUS_ORDER.filter((s) => stats.byStatus[s]).map((s) => {
            const m = STATUS_META[s];
            return <StatChip key={s} label={m.label} value={stats.byStatus[s]} color={m.color} />;
          })}
        </div>
      </div>

      {/* toolbar */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: "320px" }}>
          <Search size={14} color="var(--text-muted)" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)" }} />
          <input
            placeholder="Search ideas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              backgroundColor: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "8px 12px 8px 30px",
              color: "var(--text-primary)",
              fontSize: "12px",
            }}
          />
        </div>

        <button
          onClick={() => setShowFilters((p) => !p)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            backgroundColor: showFilters ? "var(--accent-soft)" : "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "8px 12px",
            color: showFilters ? "var(--accent)" : "var(--text-secondary)",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          <Filter size={13} /> Filters
        </button>

        <button
          onClick={() => setShowModal(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            backgroundColor: "var(--accent)",
            border: "none",
            borderRadius: "8px",
            padding: "8px 14px",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          <Plus size={14} /> Submit Idea
        </button>
      </div>

      {/* filter row */}
      {showFilters && (
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
          <FilterSelect label="Status" value={filterStatus} onChange={setFilterStatus} options={[{ value: "all", label: "All Statuses" }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label }))]} />
          <FilterSelect label="Priority" value={filterPriority} onChange={setFilterPriority} options={[{ value: "all", label: "All Priorities" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
          <FilterSelect label="Source" value={filterSource} onChange={setFilterSource} options={[{ value: "all", label: "All Sources" }, ...sources.map((s) => ({ value: s, label: `${SOURCE_ICONS[s] ?? "🔗"} ${s}` }))]} />
          <FilterSelect label="Agent" value={filterAgent} onChange={setFilterAgent} options={[{ value: "all", label: "All Agents" }, ...agents.map((a) => ({ value: a, label: a }))]} />
        </div>
      )}

      {/* card grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)", fontSize: "13px" }}>Loading ideas…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)", fontSize: "13px" }}>
          No ideas found.{" "}
          <button onClick={() => setShowModal(true)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", fontSize: "13px" }}>
            Submit one?
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "14px",
          }}
        >
          {filtered.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} onClick={() => setSelected(idea)} />
          ))}
        </div>
      )}

      {/* modals */}
      {showModal && <SubmitModal onClose={() => setShowModal(false)} onSubmitted={fetchIdeas} />}
      {selected && <DetailDrawer idea={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ── small components ──────────────────────────────────────────── */

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px",
        borderRadius: "8px",
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{value}</span>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        backgroundColor: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        padding: "6px 10px",
        color: "var(--text-secondary)",
        fontSize: "11px",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
