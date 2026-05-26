"use client";

import { X } from "lucide-react";
import { PRIORITY_META, STATUS_META } from "@/components/orchestration/task-display";
import type { TaskFilters } from "./types";
import { TYPE_LABEL } from "./types";
import { P } from "@/lib/ui/tokens";

interface Props {
  filters: TaskFilters;
  onClear: (key: keyof TaskFilters) => void;
}

export function FilterPills({ filters, onClear }: Props) {
  const pills: { key: keyof TaskFilters; label: string }[] = [];
  if (filters.status.length > 0) {
    pills.push({ key: "status", label: `Status: ${filters.status.map((status) => STATUS_META[status].label).join(", ")}` });
  }
  if (filters.priority.length > 0) {
    pills.push({ key: "priority", label: `Priority: ${filters.priority.map((priority) => PRIORITY_META[priority].label).join(", ")}` });
  }
  if (filters.assignee.length > 0) {
    pills.push({
      key: "assignee",
      label: `Assignee: ${filters.assignee.map((assignee) => assignee || "Unassigned").join(", ")}`,
    });
  }
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
            background: `rgba(222,220,209,0.08)`, border: `0.5px solid ${P.cardBorder}`,
            fontSize: "11px", color: P.textSecondary, cursor: "pointer",
          }}
        >
          {p.label}
          <X size={10} />
        </button>
      ))}
    </div>
  );
}
