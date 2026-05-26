"use client";

import { useEffect, useRef, useState } from "react";
import { PRIORITY_META } from "@/components/orchestration/task-display";
import { PriorityBars } from "@/components/orchestration/PriorityBars";
import type { TaskPriority } from "@/lib/orchestration/types";
import { P, radius } from "@/lib/ui/tokens";

const PRIORITIES: TaskPriority[] = ["P0", "P1", "P2", "P3"];

interface Props {
  current: TaskPriority;
  onChange: (priority: TaskPriority) => void;
}

export function InlinePriorityPicker({ current, onChange }: Props) {
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

  const meta = PRIORITY_META[current];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px",
          borderRadius: "4px", fontSize: "12px", color: meta.color,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <PriorityBars priority={current} size={16} />
        <span>{meta.label}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 50,
          marginTop: "4px", minWidth: "130px",
          background: P.surfaceElevated, border: `1px solid ${P.cardBorder}`,
          borderRadius: radius.md, padding: "4px 0",
          boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
        }}>
          {PRIORITIES.map((p) => {
            const m = PRIORITY_META[p];
            return (
              <button
                key={p}
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(p); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: "8px", width: "100%",
                  padding: "6px 12px", background: p === current ? "rgba(255,255,255,0.05)" : "transparent",
                  border: "none", cursor: "pointer", fontSize: "12px", color: m.color,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = p === current ? "rgba(255,255,255,0.05)" : "transparent"; }}
              >
                <PriorityBars priority={p} size={16} />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
