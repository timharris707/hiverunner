"use client";

import { useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { InlineStatusPicker } from "./InlineStatusPicker";
import { type TaskRow as TaskRowT, type InlineEditCallbacks, getTaskIdentifier, formatShortDate, getWaitingOnLabel } from "./types";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { InlineAssigneePicker } from "./InlineAssigneePicker";
import { font, P, radius, type as tokenType } from "@/lib/ui/tokens";

interface Props {
  task: TaskRowT;
  href: string;
  agents: OrchestrationAgent[];
  callbacks: InlineEditCallbacks;
  isSelected: boolean;
  onContextMenu: (e: React.MouseEvent, task: TaskRowT) => void;
  onClick: () => void;
  depth?: number;
  childCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  hasActiveRun?: boolean;
  activeAgentName?: string;
}

export function TaskRow({
  task, href, agents, callbacks, isSelected, onContextMenu,
  onClick, depth = 0, childCount, expanded, onToggleExpand, hasActiveRun, activeAgentName,
}: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const waitingOn = getWaitingOnLabel(task);

  return (
    <div
      ref={rowRef}
      role="row"
      tabIndex={0}
      data-task-id={task.id}
      onClick={onClick}
      onContextMenu={(e) => onContextMenu(e, task)}
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        height: "38px", padding: `0 16px 0 ${16 + depth * 20}px`,
        borderBottom: "none",
        background: isSelected ? "rgba(255,255,255,0.03)" : "transparent",
        cursor: "pointer", userSelect: "none",
        transition: "background 60ms ease",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      {/* Expand toggle for parent tasks */}
      {childCount !== undefined && childCount > 0 ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
          style={{
            display: "inline-flex", alignItems: "center", background: "transparent",
            border: "none", cursor: "pointer", padding: 0, width: "14px", flexShrink: 0,
          }}
        >
          {expanded
            ? <ChevronDown size={12} color={P.textMuted} />
            : <ChevronRight size={12} color={P.textMuted} />
          }
        </button>
      ) : depth > 0 ? (
        <span style={{ width: "14px", flexShrink: 0 }} />
      ) : null}

      {/* Status circle */}
      <InlineStatusPicker
        current={task.status}
        onChange={(s) => callbacks.onStatusChange(task.id, s)}
      />

      {/* Task identifier (NEV-25) */}
      <span style={{
        minWidth: "62px", fontSize: "12px", color: P.textMuted, fontWeight: 500,
        letterSpacing: "0.02em", flexShrink: 0, fontFamily: font.mono,
      }}>
        {getTaskIdentifier(task)}
      </span>

      {/* Title */}
      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1, minWidth: 0, fontSize: tokenType.body.size, color: P.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textDecoration: "none",
        }}
      >
        {task.title}
        {childCount !== undefined && childCount > 0 && (
          <span style={{ marginLeft: "6px", fontSize: tokenType.caption.size, color: P.textMuted, background: P.surfaceHover, padding: "1px 4px", borderRadius: radius.sm }}>
            {childCount}
          </span>
        )}
        {waitingOn && (
          <span style={{
            marginLeft: "8px",
            fontSize: tokenType.caption.size,
            color: waitingOn.tone === "blocked" ? "#ef4444" : P.textMuted,
            fontWeight: 500,
          }}>
            {waitingOn.label}
          </span>
        )}
      </a>

      {/* Active run indicator */}
      {hasActiveRun && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", minWidth: 0, maxWidth: 160, flexShrink: 0 }}>
          <span style={{
            width: "5px", height: "5px", borderRadius: "50%", background: "#22c55e",
            animation: "pulse 1.5s ease-in-out infinite",
          }} />
          <span style={{
            fontSize: tokenType.bodySmall.size,
            color: P.textSecondary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>{activeAgentName ?? "running"}</span>
        </span>
      )}

      <span style={{ display: "inline-flex", alignItems: "center", width: 152, flexShrink: 0 }}>
        <InlineAssigneePicker
          current={task.assignee}
          agents={agents}
          onChange={(assignee) => callbacks.onAssigneeChange(task.id, assignee)}
        />
      </span>

      {/* Date */}
      <span style={{ fontSize: "12px", color: P.textMuted, flexShrink: 0, width: "90px", textAlign: "right" }}>
        {formatShortDate(task.updated)}
      </span>
    </div>
  );
}
