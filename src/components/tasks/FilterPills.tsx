"use client";

import { X } from "lucide-react";
import { PRIORITY_META, STATUS_META } from "@/components/orchestration/task-display";
import type { TaskFilters } from "./types";
import { TYPE_LABEL } from "./types";

interface Props {
  filters: TaskFilters;
  onClear: (key: keyof TaskFilters) => void;
}

export function FilterPills({ filters, onClear }: Props) {
  const pills: { key: keyof TaskFilters; label: string }[] = [];
  if (filters.status !== "all") pills.push({ key: "status", label: `Status: ${STATUS_META[filters.status].label}` });
  if (filters.priority !== "all") pills.push({ key: "priority", label: `Priority: ${PRIORITY_META[filters.priority].label}` });
  if (filters.assignee !== "all") pills.push({ key: "assignee", label: `Assignee: ${filters.assignee || "Unassigned"}` });
  if (filters.type !== "all") pills.push({ key: "type", label: `Type: ${TYPE_LABEL[filters.type]}` });
  if (filters.query) pills.push({ key: "query", label: `Search: "${filters.query}"` });

  if (pills.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 16px 4px", flexWrap: "wrap" }}>
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onClear(p.key)}
          style={{
            display: "inline-flex", alignItems: "center", gap: "4px",
            padding: "2px 8px", borderRadius: "12px",
            background: "rgba(120,113,108,0.15)", border: "1px solid rgba(120,113,108,0.2)",
            fontSize: "11px", color: "#a8a29e", cursor: "pointer",
          }}
        >
          {p.label}
          <X size={10} />
        </button>
      ))}
    </div>
  );
}
