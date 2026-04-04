"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ChevronRight,
  ChevronDown,
  Eye,
  Code,
  FileText,
  FolderOpen,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { listCompanies, listCompanyAgents } from "@/lib/orchestration/client";
import type { OrchestrationAgent, OrchestrationCompany } from "@/lib/orchestration/types";

/* ─── Palette ─── */
const P = {
  bg: "#0f0f0f",
  surface: "#1a1a1a",
  card: "#1e1e1e",
  cardBorder: "rgba(255,255,255,0.08)",
  cardBorderHover: "rgba(255,255,255,0.16)",
  text: "#e5e5e5",
  textSec: "#a3a3a3",
  muted: "#737373",
  accent: "#d97706",
};

/* ─── Types ─── */
type SkillSource = "workspace" | "system" | "bundled";

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  fileCount: number;
  files: string[];
  fullContent: string;
  owners: string[];
  key: string;
  mode: "read-only" | "editable";
}

/* ─── Page ─── */
export default function CompanySkillsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [registrySkills, setRegistrySkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"view" | "code">("view");
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [companyRows, companyAgents, registryResponse] = await Promise.all([
      listCompanies(),
      listCompanyAgents(slug),
      fetch("/api/skills", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);

    setCompany(companyRows.find((r) => r.slug === slug) ?? null);
    setAgents(companyAgents);

    const raw = (registryResponse as { skills?: Record<string, unknown>[] })?.skills ?? [];
    const ownerMap = new Map<string, Set<string>>();
    for (const agent of companyAgents) {
      const skillIds = Array.isArray(agent.skills) ? agent.skills : [];
      for (const sid of skillIds) {
        const trimmed = sid.trim();
        if (!trimmed) continue;
        const set = ownerMap.get(trimmed) ?? new Set();
        set.add(agent.name);
        ownerMap.set(trimmed, set);
      }
    }

    setRegistrySkills(
      raw
        .filter((r) => typeof r.id === "string" && String(r.id).trim())
        .map((r) => {
          const id = String(r.id);
          const owners = Array.from(ownerMap.get(id) ?? []);
          const files = Array.isArray(r.files) ? (r.files as string[]) : [];
          return {
            id,
            name: String(r.name ?? id),
            description: String(r.description ?? ""),
            source: r.source === "system" ? "system" : r.source === "bundled" ? "bundled" : "workspace",
            fileCount: Number(r.fileCount ?? files.length),
            files,
            fullContent: String(r.fullContent ?? ""),
            owners,
            key: `${slug}/${id}`,
            mode: r.source === "system" || r.source === "bundled" ? "read-only" : "editable",
          } satisfies SkillEntry;
        })
    );

    setLoading(false);
  };

  useEffect(() => { void load(); }, [slug]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return registrySkills;
    const needle = query.trim().toLowerCase();
    return registrySkills.filter((s) =>
      `${s.name} ${s.id} ${s.description} ${s.owners.join(" ")}`.toLowerCase().includes(needle)
    );
  }, [registrySkills, query]);

  const selectedSkill = useMemo(
    () => registrySkills.find((s) => s.id === selectedSkillId) ?? null,
    [registrySkills, selectedSkillId],
  );

  const toggleExpand = (id: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 8, background: P.card, border: `1px solid ${P.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (!company) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          Company not found.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", color: P.text, fontSize: 13, display: "flex", gap: 0, height: "calc(100vh - 80px)" }}>
      {/* ── Left: Skills list ── */}
      <div style={{ flex: selectedSkill ? "0 0 50%" : "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: P.text, fontFamily: "var(--font-heading)" }}>
              Skills
            </h1>
            <span style={{ fontSize: 11, color: P.muted }}>{filtered.length} available</span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              title="Refresh"
              style={{
                width: 28, height: 28, borderRadius: 6, display: "grid", placeItems: "center",
                background: "transparent", border: `1px solid ${P.cardBorder}`, color: P.muted, cursor: "pointer",
              }}
            >
              <RefreshCw size={13} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
            </button>
            <button
              type="button"
              title="Add skill"
              style={{
                width: 28, height: 28, borderRadius: 6, display: "grid", placeItems: "center",
                background: "transparent", border: `1px solid ${P.cardBorder}`, color: P.muted, cursor: "pointer",
              }}
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        {/* Filter */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: P.muted }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter skills"
            style={{
              width: "100%", padding: "7px 10px 7px 30px", borderRadius: 6,
              border: `1px solid ${P.cardBorder}`, background: "transparent",
              color: P.text, fontSize: 12, outline: "none",
            }}
          />
        </div>

        {/* Skill list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: P.muted, fontSize: 12 }}>
              No skills found.
            </div>
          ) : (
            filtered.map((skill) => {
              const isSelected = skill.id === selectedSkillId;
              const isExpanded = expandedSkills.has(skill.id);
              const hasFiles = skill.files.length > 0;

              return (
                <div key={skill.id}>
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 10px",
                      background: isSelected ? "rgba(255,255,255,0.04)" : "transparent",
                      borderBottom: `1px solid ${P.cardBorder}`,
                      cursor: "pointer",
                      transition: "background 0.12s",
                    }}
                    onClick={() => {
                      setSelectedSkillId(isSelected ? null : skill.id);
                      setViewMode("view");
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  >
                    {/* Expand toggle */}
                    {hasFiles ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(skill.id); }}
                        style={{ background: "transparent", border: "none", color: P.muted, cursor: "pointer", padding: 0, display: "grid", placeItems: "center", width: 16, flexShrink: 0 }}
                      >
                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    ) : (
                      <div style={{ width: 16, flexShrink: 0 }} />
                    )}

                    <Paperclip size={13} style={{ color: P.muted, flexShrink: 0 }} />

                    <span style={{
                      flex: 1, fontSize: 13, color: P.text, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {skill.name}
                    </span>

                    {skill.owners.length > 0 && (
                      <span style={{ fontSize: 10, color: P.muted, flexShrink: 0 }}>
                        {skill.owners.length} agent{skill.owners.length !== 1 ? "s" : ""}
                      </span>
                    )}

                    <ChevronRight size={13} style={{ color: P.muted, flexShrink: 0, opacity: 0.5 }} />
                  </div>

                  {/* Expanded file tree */}
                  {isExpanded && hasFiles && (
                    <div style={{ paddingLeft: 42, borderBottom: `1px solid ${P.cardBorder}` }}>
                      {skill.files.map((file) => {
                        const isDir = file.endsWith("/");
                        return (
                          <div
                            key={file}
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              padding: "4px 8px", fontSize: 12, color: P.textSec,
                            }}
                          >
                            {isDir ? <FolderOpen size={12} style={{ color: P.muted }} /> : <FileText size={12} style={{ color: P.muted }} />}
                            {file}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: Skill detail ── */}
      {selectedSkill && (
        <SkillDetailPanel
          skill={selectedSkill}
          viewMode={viewMode}
          setViewMode={setViewMode}
          onClose={() => setSelectedSkillId(null)}
        />
      )}
    </div>
  );
}

/* ─── Skill Detail Panel ─── */
function SkillDetailPanel({
  skill, viewMode, setViewMode, onClose,
}: {
  skill: SkillEntry;
  viewMode: "view" | "code";
  setViewMode: (m: "view" | "code") => void;
  onClose: () => void;
}) {
  const isReadOnly = skill.mode === "read-only";
  const sourceLabel = skill.source === "bundled" ? "MC bundled"
    : skill.source === "system" ? "System"
    : "Workspace";

  return (
    <div style={{
      flex: "0 0 50%", borderLeft: `1px solid ${P.cardBorder}`,
      display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden",
    }}>
      <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Paperclip size={16} style={{ color: P.muted }} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: P.text, fontFamily: "var(--font-heading)" }}>
              {skill.name}
            </h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isReadOnly && (
              <span style={{ fontSize: 11, color: P.muted, fontStyle: "italic" }}>
                {sourceLabel} skills are read-only.
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{ width: 24, height: 24, borderRadius: 4, display: "grid", placeItems: "center", background: "transparent", border: "none", color: P.muted, cursor: "pointer" }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Description */}
        {skill.description && (
          <p style={{ margin: "0 0 16px", fontSize: 12, color: P.textSec, lineHeight: 1.5 }}>
            {skill.description}
          </p>
        )}

        {/* Metadata row */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16,
          fontSize: 11, color: P.muted,
        }}>
          <div>
            <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Source</span>
            <span style={{ color: P.textSec }}>
              <Paperclip size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
              {sourceLabel}
            </span>
          </div>
          <div>
            <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Key</span>
            <span style={{ color: P.textSec, fontFamily: "var(--font-mono)", fontSize: 11 }}>{skill.key}</span>
          </div>
          <div>
            <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Mode</span>
            <span style={{ color: P.textSec }}>{skill.mode === "read-only" ? "Read only" : "Editable"}</span>
          </div>
        </div>

        {/* Used by */}
        <div style={{ marginBottom: 20, fontSize: 11, color: P.muted }}>
          <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Used by</span>
          <span style={{ color: P.textSec }}>
            {skill.owners.length > 0 ? skill.owners.join(", ") : "No agents attached"}
          </span>
        </div>

        {/* Content area */}
        {skill.fullContent ? (
          <>
            {/* SKILL.md header with view/code toggle */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 0", borderBottom: `1px solid ${P.cardBorder}`, marginBottom: 12,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: P.textSec, fontFamily: "var(--font-mono)" }}>
                SKILL.md
              </span>
              <div style={{ display: "flex", gap: 0 }}>
                <ToggleBtn icon={<Eye size={12} />} label="View" active={viewMode === "view"} onClick={() => setViewMode("view")} />
                <ToggleBtn icon={<Code size={12} />} label="Code" active={viewMode === "code"} onClick={() => setViewMode("code")} />
              </div>
            </div>

            {viewMode === "code" ? (
              <pre style={{
                padding: 14, borderRadius: 6,
                background: "rgba(0,0,0,0.3)", border: `1px solid ${P.cardBorder}`,
                fontSize: 11, color: P.textSec, fontFamily: "var(--font-mono)",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
                lineHeight: 1.5, overflow: "auto", maxHeight: 600,
              }}>
                {skill.fullContent}
              </pre>
            ) : (
              <div style={{
                fontSize: 13, color: P.textSec, lineHeight: 1.7,
                maxHeight: 600, overflow: "auto",
              }}>
                <MarkdownContent content={skill.fullContent} />
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: 24, textAlign: "center", color: P.muted, fontSize: 12, borderRadius: 6, border: `1px dashed ${P.cardBorder}` }}>
            No skill content available.
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Toggle button ─── */
function ToggleBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "4px 10px", fontSize: 11, fontWeight: active ? 600 : 400,
        color: active ? P.text : P.muted,
        background: active ? "rgba(255,255,255,0.06)" : "transparent",
        border: `1px solid ${active ? P.cardBorderHover : P.cardBorder}`,
        borderRadius: 4, cursor: "pointer",
      }}
    >
      {icon} {label}
    </button>
  );
}

/* ─── Simple Markdown Renderer ─── */
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("# ")) {
      elements.push(<h1 key={i} style={{ fontSize: 20, fontWeight: 700, color: P.text, margin: "16px 0 8px", fontFamily: "var(--font-heading)" }}>{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} style={{ fontSize: 16, fontWeight: 600, color: P.text, margin: "14px 0 6px", fontFamily: "var(--font-heading)" }}>{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={i} style={{ fontSize: 14, fontWeight: 600, color: P.text, margin: "12px 0 4px", fontFamily: "var(--font-heading)" }}>{line.slice(4)}</h3>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} style={{ display: "flex", gap: 8, paddingLeft: 8, margin: "2px 0" }}>
          <span style={{ color: P.muted }}>-</span>
          <InlineMarkdown text={line.slice(2)} />
        </div>
      );
    } else if (line.startsWith("```")) {
      // Code block
      const endIdx = lines.indexOf("```", i + 1);
      const codeLines = endIdx > i ? lines.slice(i + 1, endIdx) : [];
      elements.push(
        <pre key={i} style={{
          padding: 10, borderRadius: 4,
          background: "rgba(0,0,0,0.3)", border: `1px solid ${P.cardBorder}`,
          fontSize: 11, color: P.textSec, fontFamily: "var(--font-mono)",
          whiteSpace: "pre-wrap", margin: "8px 0", lineHeight: 1.5,
        }}>
          {codeLines.join("\n")}
        </pre>
      );
      if (endIdx > i) i = endIdx;
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      elements.push(<p key={i} style={{ margin: "2px 0" }}><InlineMarkdown text={line} /></p>);
    }
  }

  return <>{elements}</>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Handle inline code (`...`) and bold (**...**)
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/);
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/);

    if (codeMatch && (!boldMatch || codeMatch.index! <= boldMatch.index!)) {
      if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>);
      parts.push(
        <code key={key++} style={{
          padding: "1px 5px", borderRadius: 3,
          background: "rgba(255,255,255,0.06)", border: `1px solid ${P.cardBorder}`,
          fontFamily: "var(--font-mono)", fontSize: "0.9em",
        }}>
          {codeMatch[2]}
        </code>
      );
      remaining = codeMatch[3];
    } else if (boldMatch) {
      if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
      parts.push(<strong key={key++} style={{ fontWeight: 600, color: P.text }}>{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
    } else {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
  }

  return <>{parts}</>;
}
