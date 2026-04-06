"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Code,
  Eye,
  FileText,
  FolderOpen,
  Paperclip,
  Trash2,
  X,
} from "lucide-react";

const P = {
  bg: "#0f0f0f",
  surface: "#1a1a1a",
  card: "#1e1e1e",
  cardBorder: "rgba(255,255,255,0.08)",
  cardBorderHover: "rgba(255,255,255,0.16)",
  text: "#e5e5e5",
  textSec: "#a3a3a3",
  muted: "#737373",
};

interface SkillData {
  id: string;
  name: string;
  description: string;
  source: string;
  fileCount: number;
  files: string[];
  fullContent: string;
  agents: string[];
  location: string;
}

export default function SkillDetailPage({
  params,
}: {
  params: Promise<{ slug: string; skillId: string }>;
}) {
  const { slug, skillId } = use(params);
  const router = useRouter();
  const decodedSkillId = decodeURIComponent(skillId);

  const [skill, setSkill] = useState<SkillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"view" | "code">("view");
  const [deleting, setDeleting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/skills", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { skills?: SkillData[] }) => {
        const match = (data.skills ?? []).find(
          (s) => s.id === decodedSkillId || s.name === decodedSkillId
        );
        setSkill(match ?? null);
      })
      .catch(() => setSkill(null))
      .finally(() => setLoading(false));
  }, [decodedSkillId]);

  const handleRemove = async () => {
    if (!skill) return;
    setDeleting(true);
    const res = await fetch("/api/skills", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: skill.id }),
    }).catch(() => null);
    if (res?.ok) {
      router.push(`/companies/${slug}/skills`);
    }
    setDeleting(false);
  };

  const handleFileClick = async (filePath: string) => {
    if (selectedFile === filePath) { setSelectedFile(null); setFileContent(null); return; }
    setSelectedFile(filePath);
    setFileContent(null);
    setFileError(null);
    setFileLoading(true);
    try {
      const params = new URLSearchParams({ skill: skill?.name ?? "", path: filePath });
      const res = await fetch(`/api/skills/file?${params}`);
      if (!res.ok) { setFileError("Could not read file"); setFileLoading(false); return; }
      const data = await res.json();
      if (data.truncated) { setFileError(`File too large (${(data.size / 1024).toFixed(0)} KB)`); }
      else { setFileContent(data.content); }
    } catch { setFileError("Failed to load file"); }
    setFileLoading(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 8, background: P.card, border: `1px solid ${P.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (!skill) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          Skill &quot;{decodedSkillId}&quot; not found.
        </div>
        <Link href={`/companies/${slug}/skills`} style={{ color: P.textSec, fontSize: 12, marginTop: 8, display: "inline-block" }}>
          Back to Skills
        </Link>
      </div>
    );
  }

  const sourceLabel = skill.source === "system" ? "System" : "Workspace";
  const isReadOnly = skill.source === "system";
  const key = `${slug}/${skill.id}`;

  return (
    <div style={{ padding: "16px 24px", color: P.text, fontSize: 13, maxWidth: 900 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 12, color: P.muted }}>
        <Link href={`/companies/${slug}/skills`} style={{ color: P.muted, textDecoration: "none" }}>Skills</Link>
        <ChevronRight size={12} />
        <span style={{ color: P.textSec }}>{skill.name}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Paperclip size={16} style={{ color: P.muted }} />
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: P.text, fontFamily: "var(--font-heading)" }}>
            {skill.name}
          </h1>
        </div>
        {isReadOnly && (
          <span style={{ fontSize: 11, color: P.muted, fontStyle: "italic" }}>
            System skills are read-only.
          </span>
        )}
      </div>

      {/* Description */}
      {skill.description && (
        <p style={{ margin: "0 0 16px", fontSize: 12, color: P.textSec, lineHeight: 1.5 }}>
          {skill.description}
        </p>
      )}

      {/* Metadata */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16, fontSize: 11, color: P.muted }}>
        <div>
          <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Source</span>
          <span style={{ color: P.textSec }}>{sourceLabel}</span>
        </div>
        <div>
          <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Key</span>
          <span style={{ color: P.textSec, fontFamily: "var(--font-mono)" }}>{key}</span>
        </div>
        <div>
          <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Mode</span>
          <span style={{ color: P.textSec }}>{isReadOnly ? "Read only" : "Editable"}</span>
        </div>
      </div>

      <div style={{ marginBottom: 20, fontSize: 11, color: P.muted }}>
        <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Used by</span>
        <span style={{ color: P.textSec }}>
          {skill.agents.length > 0 ? skill.agents.join(", ") : "No agents attached"}
        </span>
      </div>

      {/* Files */}
      {skill.files.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Files ({skill.fileCount})
          </div>
          <div style={{ borderRadius: 6, border: `1px solid ${P.cardBorder}`, overflow: "hidden" }}>
            {skill.files.map((file) => {
              const isDir = file.endsWith("/");
              const isSelected = selectedFile === file;
              return (
                <div key={file}>
                  <button
                    type="button"
                    onClick={() => { if (!isDir) void handleFileClick(file); }}
                    disabled={isDir}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 10px", fontSize: 12, width: "100%",
                      color: isSelected ? P.text : P.textSec,
                      background: isSelected ? "rgba(217,119,6,0.08)" : "transparent",
                      borderBottom: `1px solid ${P.cardBorder}`,
                      border: "none", borderBottomStyle: "solid", borderBottomWidth: 1, borderBottomColor: P.cardBorder,
                      cursor: isDir ? "default" : "pointer",
                      textAlign: "left",
                      transition: "background 100ms",
                    }}
                    onMouseEnter={(e) => { if (!isDir && !isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  >
                    {isDir ? <FolderOpen size={12} style={{ color: P.muted }} /> : <FileText size={12} style={{ color: isSelected ? "#d97706" : P.muted }} />}
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, flex: 1 }}>{file}</span>
                    {isSelected && <ChevronRight size={12} style={{ color: "#d97706" }} />}
                  </button>
                  {/* File content panel */}
                  {isSelected && (
                    <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.25)", borderBottom: `1px solid ${P.cardBorder}` }}>
                      {fileLoading && <span style={{ fontSize: 11, color: P.muted }}>Loading...</span>}
                      {fileError && <span style={{ fontSize: 11, color: "#fca5a5" }}>{fileError}</span>}
                      {fileContent != null && (
                        <pre style={{
                          margin: 0, padding: 8, borderRadius: 4,
                          background: "rgba(0,0,0,0.3)", border: `1px solid ${P.cardBorder}`,
                          fontSize: 11, color: P.textSec, fontFamily: "var(--font-mono)",
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                          lineHeight: 1.5, overflow: "auto", maxHeight: 400,
                        }}>
                          {fileContent}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SKILL.md content */}
      {skill.fullContent ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${P.cardBorder}`, marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: P.textSec, fontFamily: "var(--font-mono)" }}>SKILL.md</span>
            <div style={{ display: "flex", gap: 0 }}>
              <ToggleBtn icon={<Eye size={12} />} label="View" active={viewMode === "view"} onClick={() => setViewMode("view")} />
              <ToggleBtn icon={<Code size={12} />} label="Code" active={viewMode === "code"} onClick={() => setViewMode("code")} />
            </div>
          </div>
          {viewMode === "code" ? (
            <pre style={{ padding: 14, borderRadius: 6, background: "rgba(0,0,0,0.3)", border: `1px solid ${P.cardBorder}`, fontSize: 11, color: P.textSec, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5, overflow: "auto", maxHeight: 600 }}>
              {skill.fullContent}
            </pre>
          ) : (
            <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.7, maxHeight: 600, overflow: "auto" }}>
              <SimpleMarkdown content={skill.fullContent} />
            </div>
          )}
        </>
      ) : null}

      {/* Remove button */}
      {!isReadOnly && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${P.cardBorder}` }}>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={deleting}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 500,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
              color: "#f87171", cursor: "pointer", opacity: deleting ? 0.5 : 1,
            }}
          >
            <Trash2 size={12} /> {deleting ? "Removing..." : "Remove skill"}
          </button>
        </div>
      )}
    </div>
  );
}

function ToggleBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "4px 10px", fontSize: 11, fontWeight: active ? 600 : 400,
      color: active ? P.text : P.muted,
      background: active ? "rgba(255,255,255,0.06)" : "transparent",
      border: `1px solid ${active ? P.cardBorderHover : P.cardBorder}`,
      borderRadius: 4, cursor: "pointer",
    }}>
      {icon} {label}
    </button>
  );
}

function SimpleMarkdown({ content }: { content: string }) {
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
      elements.push(<div key={i} style={{ display: "flex", gap: 8, paddingLeft: 8, margin: "2px 0" }}><span style={{ color: P.muted }}>-</span><span>{line.slice(2)}</span></div>);
    } else if (line.startsWith("```")) {
      const endIdx = lines.indexOf("```", i + 1);
      const codeLines = endIdx > i ? lines.slice(i + 1, endIdx) : [];
      elements.push(<pre key={i} style={{ padding: 10, borderRadius: 4, background: "rgba(0,0,0,0.3)", border: `1px solid ${P.cardBorder}`, fontSize: 11, color: P.textSec, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", margin: "8px 0", lineHeight: 1.5 }}>{codeLines.join("\n")}</pre>);
      if (endIdx > i) i = endIdx;
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      elements.push(<p key={i} style={{ margin: "2px 0" }}>{line}</p>);
    }
  }
  return <>{elements}</>;
}
