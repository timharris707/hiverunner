"use client";

import { useCallback, useState } from "react";
import { FileText, Save, File, ChevronRight } from "lucide-react";
import { useAgentProfile, A } from "../layout";

/* ── Parse personality into a document-style view ── */

interface InstructionSection {
  heading: string;
  content: string;
}

function parseInstructionSections(text: string): InstructionSection[] {
  const lines = text.split("\n");
  const sections: InstructionSection[] = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentHeading || currentLines.length > 0) {
        sections.push({ heading: currentHeading, content: currentLines.join("\n").trim() });
      }
      currentHeading = headingMatch[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentHeading || currentLines.length > 0) {
    sections.push({ heading: currentHeading, content: currentLines.join("\n").trim() });
  }
  return sections;
}

export default function AgentInstructionsPage() {
  const { profile, slug, agentId, reload } = useAgentProfile();
  const { agent } = profile;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [instructions, setInstructions] = useState(agent.personality ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const personality = agent.personality ?? "";
  const hasContent = personality.trim().length > 0;
  const sections = hasContent ? parseInstructionSections(personality) : [];
  const byteSize = new TextEncoder().encode(personality).length;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(agent.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personality: instructions }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        reload();
      }
    } finally {
      setSaving(false);
    }
  }, [slug, agent.id, instructions, reload]);

  const formatBytes = (b: number) => b < 1024 ? `${b}B` : `${(b / 1024).toFixed(1)}KB`;

  return (
    <div style={{ display: "flex", gap: 16 }}>
      {/* ── File panel (left) ── */}
      <div style={{
        width: 220, flexShrink: 0, padding: "12px 0",
        borderRadius: 10, background: A.card, border: `1px solid ${A.cardBorder}`,
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 14px 10px", borderBottom: `1px solid ${A.cardBorder}`,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Files</span>
        </div>

        {/* Main instruction file */}
        <button
          type="button"
          onClick={() => setMode("view")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            width: "100%", padding: "8px 14px", border: "none",
            background: mode === "view" ? "rgba(217,119,6,0.08)" : "transparent",
            cursor: "pointer", textAlign: "left",
          }}
        >
          <FileText size={13} color={A.accent} />
          <span style={{ flex: 1, fontSize: 12, color: A.text, fontWeight: 500 }}>
            AGENT.md
          </span>
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 4,
            background: "rgba(217,119,6,0.12)", color: A.accentLight,
            fontWeight: 600,
          }}>
            ENTRY
          </span>
        </button>

        {/* Personality file (if exists) */}
        {hasContent && (
          <button
            type="button"
            onClick={() => setMode("edit")}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", padding: "8px 14px", border: "none",
              background: mode === "edit" ? "rgba(217,119,6,0.08)" : "transparent",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <File size={13} color={A.muted} />
            <span style={{ flex: 1, fontSize: 12, color: A.textSec }}>
              PERSONALITY.md
            </span>
            <span style={{ fontSize: 10, color: A.muted }}>
              {formatBytes(byteSize)}
            </span>
          </button>
        )}

        {/* Info */}
        <div style={{ padding: "12px 14px 4px", fontSize: 10, color: A.muted, lineHeight: 1.5 }}>
          Multi-file instruction bundles require the Paperclip provider. OpenClaw agents use a single system prompt.
        </div>
      </div>

      {/* ── Content panel (right) ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {mode === "view" ? (
          /* ── Document view ── */
          <div style={{
            padding: "16px 20px", borderRadius: 10,
            background: A.card, border: `1px solid ${A.cardBorder}`,
          }}>
            {/* File header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 16, paddingBottom: 12,
              borderBottom: `1px solid ${A.cardBorder}`,
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: A.text }}>AGENT.md</div>
                <div style={{ fontSize: 11, color: A.muted, marginTop: 2 }}>markdown file</div>
              </div>
              <button
                type="button"
                onClick={() => setMode("edit")}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500,
                  background: "rgba(217,119,6,0.10)", border: `1px solid ${A.cardBorder}`,
                  color: A.accentLight, cursor: "pointer",
                }}
              >
                Edit
              </button>
            </div>

            {/* Rendered content */}
            {!hasContent ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: A.muted, fontSize: 12 }}>
                No instructions configured. Click Edit to add a system prompt.
              </div>
            ) : (
              <div style={{ fontSize: 13, color: A.text, lineHeight: 1.7, fontFamily: "monospace" }}>
                {sections.map((section, i) => (
                  <div key={i} style={{ marginBottom: 16 }}>
                    {section.heading && (
                      <h3 style={{
                        fontSize: 15, fontWeight: 700, color: A.text,
                        margin: "0 0 8px", letterSpacing: "-0.01em",
                      }}>
                        {section.heading}
                      </h3>
                    )}
                    {section.content && (
                      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {section.content}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Edit view ── */
          <div style={{
            padding: "14px 16px", borderRadius: 10,
            background: A.card, border: `1px solid ${A.cardBorder}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "4px 10px", borderRadius: 6, fontSize: 11,
                    background: "transparent", border: `1px solid ${A.cardBorder}`,
                    color: A.textSec, cursor: "pointer",
                  }}
                >
                  <ChevronRight size={11} style={{ transform: "rotate(180deg)" }} />
                  Back
                </button>
                <span style={{ color: A.accent, fontSize: 12, fontWeight: 600 }}>
                  <FileText size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  System Prompt / Instructions
                </span>
              </div>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "6px 14px", borderRadius: 6,
                  background: saved ? "rgba(34,197,94,0.15)" : "rgba(217,119,6,0.10)",
                  border: `1px solid ${saved ? "rgba(34,197,94,0.3)" : A.cardBorder}`,
                  color: saved ? "#4ade80" : A.accentLight,
                  fontSize: 11, fontWeight: 500, cursor: saving ? "wait" : "pointer",
                  opacity: saving ? 0.5 : 1,
                }}
              >
                <Save size={12} />
                {saved ? "Saved" : saving ? "Saving…" : "Save"}
              </button>
            </div>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Enter agent instructions / system prompt..."
              style={{
                width: "100%", minHeight: 400, padding: 12, borderRadius: 8,
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                color: A.text, fontSize: 13, fontFamily: "monospace", lineHeight: 1.6,
                resize: "vertical", outline: "none",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = A.cardBorderHover; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
            />
            <p style={{ margin: "8px 0 0", fontSize: 11, color: A.muted }}>
              This prompt is sent as the system message when the agent runs tasks.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
