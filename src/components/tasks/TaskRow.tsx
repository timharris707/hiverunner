"use client";

import { useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { InlineStatusPicker } from "./InlineStatusPicker";
import { type TaskRow as TaskRowT, type InlineEditCallbacks, getTaskIdentifier, formatShortDate, assigneeInitials } from "./types";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { resolveAvatar } from "./InlineAssigneePicker";
import { font, P } from "@/lib/ui/tokens";

interface Props {
  task: TaskRowT;
  href: string;
  agents: OrchestrationAgent[];
  agentMap: Map<string, OrchestrationAgent>;
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
  task, href, agents, agentMap, callbacks, isSelected, onContextMenu,
  onClick, depth = 0, childCount, expanded, onToggleExpand, hasActiveRun, activeAgentName,
}: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const agent = agentMap.get((task.assignee ?? "").toLowerCase());
  const assigneeName = agent?.name ?? task.assignee ?? "";
  const initials = assigneeName ? assigneeInitials(assigneeName) : "";

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
        borderBottom: `0.5px solid ${P.cardBorder}`,
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
          flex: 1, minWidth: 0, fontSize: "13px", color: P.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textDecoration: "none",
        }}
      >
        {task.title}
        {childCount !== undefined && childCount > 0 && (
          <span style={{ marginLeft: "6px", fontSize: "10px", color: P.textMuted, background: "rgba(255,255,255,0.05)", padding: "1px 4px", borderRadius: "4px" }}>
            {childCount}
          </span>
        )}
      </a>

      {/* Active run indicator */}
      {hasActiveRun && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
          <span style={{
            width: "5px", height: "5px", borderRadius: "50%", background: "#22c55e",
            animation: "pulse 1.5s ease-in-out infinite",
          }} />
          <span style={{ fontSize: "10px", color: P.textMuted }}>{activeAgentName ?? "running"}</span>
        </span>
      )}

      {/* Assignee avatar + name */}
      {assigneeName ? (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          {(() => {
            const avatarUrl = agent ? resolveAvatar(agent) : undefined;
            if (avatarUrl) {
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={assigneeName} style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              );
            }
            if (agent?.emoji) {
              return (
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(217,119,6,0.18)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <AvatarGlyph value={agent.emoji} size={12} />
                </span>
              );
            }
            return (
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${P.cardBorder}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: P.textSecondary, flexShrink: 0 }}>
                {initials}
              </span>
            );
          })()}
          <span style={{ fontSize: "12px", color: P.textSecondary, flexShrink: 0 }}>
            {assigneeName}
          </span>
        </div>
      ) : (
        <span style={{ flexShrink: 0, width: "80px" }} />
      )}

      {/* Date */}
      <span style={{ fontSize: "12px", color: P.textMuted, flexShrink: 0, width: "90px", textAlign: "right" }}>
        {formatShortDate(task.updated)}
      </span>
    </div>
  );
}
