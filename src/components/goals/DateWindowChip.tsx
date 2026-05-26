"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { CalendarDays } from "lucide-react";

import { goalDateWindowSummary } from "@/components/goals/GoalPrimitives";
import type { OrchestrationSprint } from "@/lib/orchestration/types";

export type EditableSprintDates = {
  id: string;
  name: string;
  status: OrchestrationSprint["status"];
  startDate?: string;
  endDate?: string | null;
};

const fieldStyle: CSSProperties = {
  borderRadius: "10px",
  border: "0.5px solid var(--border-strong)",
  background: "transparent",
  padding: "8px 12px",
  fontSize: "13px",
  color: "var(--text-primary)",
  outline: "none",
  width: "100%",
};

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function isoToDateInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function dateInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function DateWindowChip({
  sprint,
  onChange,
}: {
  sprint: EditableSprintDates;
  onChange: (startDate: string, endDate: string | null) => void;
}) {
  const summary = goalDateWindowSummary(sprint);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(() => isoToDateInput(sprint.startDate) || todayDateInput());
  const [draftEnd, setDraftEnd] = useState(() => isoToDateInput(sprint.endDate));

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!summary) return <span aria-hidden="true" />;

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex", justifyContent: "flex-end" }}>
      <button
        type="button"
        title={summary.title}
        aria-label={`Edit date window for ${sprint.name}`}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDraftStart(isoToDateInput(sprint.startDate) || todayDateInput());
          setDraftEnd(isoToDateInput(sprint.endDate));
          setOpen((current) => !current);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          border: "none",
          borderRadius: "999px",
          background: "transparent",
          color: summary.color,
          cursor: "pointer",
          fontSize: "11px",
          maxWidth: 124,
          overflow: "hidden",
          padding: "2px 6px",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <CalendarDays size={12} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{summary.label}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={`Date window for ${sprint.name}`}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            zIndex: 65,
            top: "calc(100% + 6px)",
            right: 0,
            width: 240,
            padding: 10,
            borderRadius: "10px",
            border: "0.5px solid var(--border)",
            background: "var(--modal-glass)",
            boxShadow: "var(--shadow-glass)",
          }}
        >
          <label style={{ display: "grid", gap: 4, marginBottom: 8, color: "var(--text-muted)", fontSize: "11px" }}>
            Start
            <input type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} style={fieldStyle} />
          </label>
          <label style={{ display: "grid", gap: 4, color: "var(--text-muted)", fontSize: "11px" }}>
            End
            <input type="date" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} style={fieldStyle} />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button type="button" onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: "12px" }}>
              Cancel
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const startIso = dateInputToIso(draftStart);
                if (!startIso) return;
                onChange(startIso, draftEnd ? dateInputToIso(draftEnd) ?? null : null);
                setOpen(false);
              }}
              style={{ border: "0.5px solid var(--border-strong)", borderRadius: "8px", background: "transparent", color: "var(--text-primary)", cursor: "pointer", fontSize: "12px", padding: "5px 9px" }}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
