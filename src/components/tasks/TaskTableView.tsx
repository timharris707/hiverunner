"use client";

import { formatAge } from "@/components/orchestration/ui";
import { InlineStatusPicker } from "./InlineStatusPicker";
import { InlinePriorityPicker } from "./InlinePriorityPicker";
import { InlineAssigneePicker } from "./InlineAssigneePicker";
import { type TaskRow, type InlineEditCallbacks, type SortField, type SortDir, getTaskIdentifier, getActiveRunLabel, getWaitingOnLabel } from "./types";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { font, P, type as tokenType } from "@/lib/ui/tokens";

interface Props {
  tasks: TaskRow[];
  agents: OrchestrationAgent[];
  agentMap: Map<string, OrchestrationAgent>;
  companyCode: string;
  selectedIndex: number;
  sortField: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField) => void;
  onContextMenu: (e: React.MouseEvent, task: TaskRow) => void;
  callbacks: InlineEditCallbacks;
}

const COLUMNS: { field: SortField; label: string; width: string; align?: "right" }[] = [
  { field: "id", label: "ID", width: "70px" },
  { field: "status", label: "Status", width: "60px" },
  { field: "title", label: "Title", width: "" },
  { field: "priority", label: "Priority", width: "80px" },
  { field: "assignee", label: "Assignee", width: "116px" },
  { field: "project", label: "Project", width: "90px" },
  { field: "updated", label: "Updated", width: "70px", align: "right" },
];

export function TaskTableView({
  tasks, agents, agentMap, companyCode, selectedIndex,
  sortField, sortDir, onSortChange, onContextMenu, callbacks,
}: Props) {
  const buildHref = (task: TaskRow) =>
    `/${encodeURIComponent(companyCode.toUpperCase())}/tasks/${encodeURIComponent(getTaskIdentifier(task))}`;

  const arrow = (field: SortField) => sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const headerStyle = (col: typeof COLUMNS[number]): React.CSSProperties => ({
    padding: "6px 8px", fontSize: "11px", color: P.textMuted, fontWeight: 600,
    textAlign: col.align === "right" ? "right" : "left",
    width: col.width || undefined, flex: col.width ? undefined : 1,
    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
    borderBottom: `0.5px solid ${P.cardBorder}`,
    background: P.surface,
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "0 16px", position: "sticky", top: 0, zIndex: 10, minWidth: "800px" }}>
        {COLUMNS.map((col) => (
          <div key={col.field} onClick={() => onSortChange(col.field)} style={headerStyle(col)}>
            {col.label}{arrow(col.field)}
          </div>
        ))}
      </div>

      <div style={{ minWidth: "800px" }}>
        {tasks.map((task, i) => {
          const activeLabel = getActiveRunLabel(task, agentMap);
          const waitingOn = getWaitingOnLabel(task);
          return (
            <div
              key={task.id}
              onContextMenu={(e) => onContextMenu(e, task)}
              style={{
                display: "flex", alignItems: "center", height: "36px", padding: "0 16px",
                borderBottom: `0.5px solid ${P.cardBorder}`,
                background: selectedIndex === i ? "rgba(255,255,255,0.03)" : "transparent",
                cursor: "pointer", transition: "background 60ms ease",
              }}
              onMouseEnter={(e) => { if (selectedIndex !== i) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
              onMouseLeave={(e) => { if (selectedIndex !== i) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                width: "70px", flexShrink: 0, fontSize: "11px", color: P.textSecondary, fontWeight: 600,
                letterSpacing: "0.04em", fontFamily: font.mono, padding: "0 8px",
              }}>
                {getTaskIdentifier(task)}
              </span>

              <div style={{ width: "60px", padding: "0 8px" }}>
                <InlineStatusPicker current={task.status} onChange={(s) => callbacks.onStatusChange(task.id, s)} />
              </div>

              <div style={{ flex: 1, padding: "0 8px", minWidth: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                <a href={buildHref(task)} onClick={(e) => e.stopPropagation()} style={{
                  fontSize: tokenType.body.size, color: P.text, textDecoration: "none",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {task.title}
                </a>
                {activeLabel && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: tokenType.bodySmall.size, color: P.textSecondary, minWidth: 0, maxWidth: 150, flexShrink: 0 }}>
                    <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#22c55e", animation: "pulse 1.5s ease-in-out infinite" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeLabel}</span>
                  </span>
                )}
                {waitingOn && (
                  <span style={{
                    fontSize: tokenType.bodySmall.size,
                    color: waitingOn.tone === "blocked" ? "#ef4444" : P.textMuted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    maxWidth: 190,
                    flexShrink: 1,
                  }}>
                    {waitingOn.label}
                  </span>
                )}
              </div>

              <div style={{ width: "80px", padding: "0 8px" }}>
                <InlinePriorityPicker current={task.priority} onChange={(p) => callbacks.onPriorityChange(task.id, p)} />
              </div>

              <div style={{ width: "116px", padding: "0 8px" }}>
                <InlineAssigneePicker current={task.assignee} agents={agents} onChange={(a) => callbacks.onAssigneeChange(task.id, a)} />
              </div>

              <span style={{
                width: "90px", padding: "0 8px", fontSize: "11px", color: P.textMuted,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {task.projectName}
              </span>

              <span style={{ width: "70px", padding: "0 8px", fontSize: "11px", color: P.textMuted, textAlign: "right" }}>
                {formatAge(task.updated)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
