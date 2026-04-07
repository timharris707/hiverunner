"use client";

import { useEffect, useRef, useState } from "react";
import { STATUS_META } from "@/components/orchestration/task-display";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import type { TaskStatus } from "@/lib/orchestration/types";
import { STATUS_ORDER, STATUS_LABEL } from "./types";
import { P, radius } from "@/lib/ui/tokens";

interface Props {
  current: TaskStatus;
  onChange: (status: TaskStatus) => void;
}

export function InlineStatusPicker({ current, onChange }: Props) {
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

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: "4px",
          background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px",
          borderRadius: "4px",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <StatusCircle status={current} size={14} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 50,
          marginTop: "4px", minWidth: "140px",
          background: P.surfaceElevated, border: `1px solid ${P.cardBorder}`,
          borderRadius: radius.md, padding: "4px 0",
          boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
        }}>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(s); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: "8px", width: "100%",
                padding: "6px 12px", background: s === current ? "rgba(255,255,255,0.05)" : "transparent",
                border: "none", cursor: "pointer", fontSize: "12px", color: P.textSecondary,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = s === current ? "rgba(255,255,255,0.05)" : "transparent"; }}
            >
              <StatusCircle status={s} size={12} />
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
