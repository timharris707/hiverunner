"use client";

import { useCallback, useState } from "react";
import { FileText, Save, ChevronRight, Pencil } from "lucide-react";
import { useAgentProfile, A } from "../layout";

export default function AgentInstructionsPage() {
  const { profile, slug, reload } = useAgentProfile();
  const { agent } = profile;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [instructions, setInstructions] = useState(agent.personality ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const personality = agent.personality ?? "";
  const hasContent = personality.trim().length > 0;
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

        {/* System prompt entry */}
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
            System Prompt
          </span>
          {hasContent && (
            <span style={{ fontSize: 10, color: A.muted }}>
              {formatBytes(byteSize)}
            </span>
          )}
        </button>

        {/* Info about multi-file bundles */}
        <div style={{ padding: "12px 14px 4px", fontSize: 10, color: A.muted, lineHeight: 1.5 }}>
          Multi-file instruction bundles (AGENTS.md, HEARTBEAT.md, etc.) require the Paperclip provider. This agent uses a single system prompt.
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
                <div style={{ fontSize: 14, fontWeight: 600, color: A.text }}>System Prompt</div>
                <div style={{ fontSize: 11, color: A.muted, marginTop: 2 }}>
                  Sent as the system message when this agent runs tasks
                </div>
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
                <Pencil size={11} />
                Edit
              </button>
            </div>

            {/* Rendered content */}
            {!hasContent ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: A.muted, fontSize: 12 }}>
                No instructions configured. Click Edit to add a system prompt.
              </div>
            ) : (
              <div style={{ fontSize: 13, color: A.text, lineHeight: 1.7, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {personality}
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
                  System Prompt
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
          </div>
        )}
      </div>
    </div>
  );
}
