"use client";

import { useState } from "react";
import { FileText, Save } from "lucide-react";
import { useAgentProfile, A } from "../layout";

export default function AgentInstructionsPage() {
  const { profile } = useAgentProfile();
  const { agent } = profile;

  const [instructions, setInstructions] = useState(agent.personality ?? "");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // TODO: wire up to API when endpoint exists
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ ...cardStyle }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: A.accent, fontSize: 12, fontWeight: 600 }}>
          <FileText size={13} />
          System Prompt / Instructions
        </div>
        <button
          onClick={handleSave}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "6px 14px", borderRadius: 6,
            background: saved ? "rgba(34,197,94,0.15)" : "rgba(217,119,6,0.10)",
            border: `1px solid ${saved ? "rgba(34,197,94,0.3)" : A.cardBorder}`,
            color: saved ? "#4ade80" : A.accentLight,
            fontSize: 11, fontWeight: 500, cursor: "pointer",
          }}
        >
          <Save size={12} />
          {saved ? "Saved" : "Save"}
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
  );
}

const cardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  background: A.card,
  border: `1px solid ${A.cardBorder}`,
};
