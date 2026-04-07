"use client";

import { useEffect, useRef, useState } from "react";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { P, radius } from "@/lib/ui/tokens";

interface Props {
  current: string | undefined;
  agents: OrchestrationAgent[];
  onChange: (assignee: string) => void;
}

export function InlineAssigneePicker({ current, agents, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const currentAgent = agents.find(
    (a) => a.name.toLowerCase() === (current ?? "").toLowerCase() || a.id.toLowerCase() === (current ?? "").toLowerCase()
  );

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: "4px",
          background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px",
          borderRadius: "4px", fontSize: "12px", color: P.textMuted,
          maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        {currentAgent ? (
          <><span>{currentAgent.emoji}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{currentAgent.name}</span></>
        ) : (
          <span style={{ color: P.textMuted }}>{current || "Unassigned"}</span>
        )}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, zIndex: 50,
          marginTop: "4px", minWidth: "160px", maxHeight: "240px", overflowY: "auto",
          background: P.surfaceElevated, border: `1px solid ${P.cardBorder}`,
          borderRadius: radius.md, padding: "4px 0",
          boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
        }}>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(""); setOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: "8px", width: "100%",
              padding: "6px 12px", background: !current ? "rgba(255,255,255,0.05)" : "transparent",
              border: "none", cursor: "pointer", fontSize: "12px", color: P.textMuted,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = !current ? "rgba(255,255,255,0.05)" : "transparent"; }}
          >
            Unassigned
          </button>
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(a.name); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: "8px", width: "100%",
                padding: "6px 12px",
                background: (current ?? "").toLowerCase() === a.name.toLowerCase() ? "rgba(255,255,255,0.05)" : "transparent",
                border: "none", cursor: "pointer", fontSize: "12px", color: P.textSecondary,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = (current ?? "").toLowerCase() === a.name.toLowerCase() ? "rgba(255,255,255,0.05)" : "transparent"; }}
            >
              <span>{a.emoji}</span>
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
