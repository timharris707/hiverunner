"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PRIORITY_META } from "@/components/orchestration/task-display";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { SURFACE, type TaskRow, getTaskIdentifier, assigneeInitials } from "./types";
import type { OrchestrationAgent } from "@/lib/orchestration/types";

interface Props {
  task: TaskRow;
  href: string;
  agentMap: Map<string, OrchestrationAgent>;
  onContextMenu: (e: React.MouseEvent, task: TaskRow) => void;
  hasActiveRun?: boolean;
  activeAgentName?: string;
  childCount?: number;
}

export function TaskCard({
  task, href, agentMap, onContextMenu, hasActiveRun, activeAgentName, childCount
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    padding: "10px 12px",
    background: SURFACE.card,
    border: `1px solid ${SURFACE.line}`,
    borderRadius: "6px",
    marginBottom: "8px",
    cursor: "grab",
  };

  const agent = agentMap.get((task.assignee ?? "").toLowerCase());
  const meta = PRIORITY_META[task.priority];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onContextMenu={(e) => onContextMenu(e, task)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
        <StatusCircle status={task.status} size={12} />
        <span style={{
          fontSize: "10px", color: SURFACE.textFaint, fontFamily: "var(--font-mono, monospace)",
          fontWeight: 600, letterSpacing: "0.04em",
        }}>
          {getTaskIdentifier(task)}
        </span>
        {childCount && childCount > 0 ? (
          <span style={{ fontSize: "10px", color: SURFACE.textDim, marginLeft: "auto", background: "rgba(255,255,255,0.05)", padding: "1px 4px", borderRadius: "4px" }}>
            {childCount} sub
          </span>
        ) : null}
      </div>

      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "-webkit-box", fontSize: "12px", color: SURFACE.text, lineHeight: "1.4",
          marginBottom: "8px", textDecoration: "none",
          overflow: "hidden", textOverflow: "ellipsis",
          WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
        } as React.CSSProperties}
      >
        {task.title}
      </a>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "10px", color: meta.color, fontWeight: 600 }}>
          {meta.icon} {task.priority}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10px", color: SURFACE.textDim }}>
          {(agent?.name || task.assignee) ? (
            <>
              <span style={{
                width: "18px", height: "18px", borderRadius: "50%",
                background: "rgba(120,113,108,0.25)", border: "1px solid rgba(120,113,108,0.15)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: "8px", fontWeight: 700, color: SURFACE.textDim, flexShrink: 0,
              }}>
                {assigneeInitials(agent?.name ?? task.assignee ?? "")}
              </span>
              {agent?.name ?? task.assignee}
            </>
          ) : null}
        </span>
      </div>

      {hasActiveRun && activeAgentName && (
        <div style={{
          marginTop: "8px", paddingTop: "6px", borderTop: `1px solid ${SURFACE.lineSoft}`,
          fontSize: "10px", color: SURFACE.textFaint,
          display: "flex", alignItems: "center", gap: "4px",
        }}>
          <span style={{
            width: "5px", height: "5px", borderRadius: "50%", background: "#22c55e",
            animation: "pulse 1.5s ease-in-out infinite",
          }} />
          {activeAgentName}
        </div>
      )}
    </div>
  );
}
