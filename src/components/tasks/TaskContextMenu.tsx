"use client";

import { useEffect, useRef } from "react";
import { PRIORITY_META } from "@/components/orchestration/task-display";
import { PriorityBars } from "@/components/orchestration/PriorityBars";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { SURFACE, type TaskRow, type InlineEditCallbacks, STATUS_ORDER, STATUS_LABEL, getTaskIdentifier } from "./types";
import type { OrchestrationAgent, TaskPriority } from "@/lib/orchestration/types";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { resolveAvatar } from "./InlineAssigneePicker";
import { TASK_MODEL_LANES } from "@/lib/orchestration/task-model-routing";
import type { TaskExecutionEngine, TaskModelLane } from "@/lib/orchestration/types";

const PRIORITIES: TaskPriority[] = ["P0", "P1", "P2", "P3"];
const EXECUTION_ENGINES: Array<{ value: TaskExecutionEngine | null; label: string }> = [
  { value: null, label: "Inherit engine" },
  { value: "hiverunner", label: "HiveRunner" },
  { value: "symphony", label: "External runner" },
  { value: "manual", label: "Manual" },
];

interface Props {
  task: TaskRow;
  x: number;
  y: number;
  agents: OrchestrationAgent[];
  callbacks: InlineEditCallbacks;
  onArchive: (taskId: string) => void;
  onClose: () => void;
  href?: string;
}

function SubMenu({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      style={{ position: "relative" }}
      onMouseEnter={() => {
        const sub = ref.current?.querySelector("[data-submenu]") as HTMLElement;
        if (sub) sub.style.display = "block";
      }}
      onMouseLeave={() => {
        const sub = ref.current?.querySelector("[data-submenu]") as HTMLElement;
        if (sub) sub.style.display = "none";
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 12px", fontSize: "12px", color: SURFACE.textMuted, cursor: "default",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span>{label}</span>
        <span style={{ color: SURFACE.textGhost, fontSize: "10px" }}>▸</span>
      </div>
      <div
        data-submenu
        style={{
          display: "none", position: "absolute", left: "100%", top: "-4px",
          background: "#1c1917", border: `1px solid ${SURFACE.line}`,
          borderRadius: "6px", padding: "4px 0", minWidth: "140px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 200,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function TaskContextMenu({ task, x, y, agents, callbacks, onArchive, onClose, href }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "8px", width: "100%",
    padding: "6px 12px", background: "transparent",
    border: "none", cursor: "pointer", fontSize: "12px", color: SURFACE.textMuted,
    textAlign: "left"
  };

  const hoverIn = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; };
  const hoverOut = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = "transparent"; };

  const taskUrl = href ?? `#${getTaskIdentifier(task)}`;

  return (
    <div ref={ref} style={{
      position: "fixed", left: x, top: y, zIndex: 150,
      background: "#1c1917", border: `1px solid ${SURFACE.line}`,
      borderRadius: "6px", padding: "4px 0", minWidth: "180px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    }}>
      <SubMenu label="Change Status">
        {STATUS_ORDER.map((s) => (
          <button
            key={s} type="button" style={itemStyle}
            onClick={() => { callbacks.onStatusChange(task.id, s); onClose(); }}
            onMouseEnter={hoverIn} onMouseLeave={hoverOut}
          >
            <StatusCircle status={s} size={12} />
            {STATUS_LABEL[s]}
          </button>
        ))}
      </SubMenu>

      <SubMenu label="Change Priority">
        {PRIORITIES.map((p) => {
          const m = PRIORITY_META[p];
          return (
            <button
              key={p} type="button" style={{ ...itemStyle, color: m.color }}
              onClick={() => { callbacks.onPriorityChange(task.id, p); onClose(); }}
              onMouseEnter={hoverIn} onMouseLeave={hoverOut}
            >
              <PriorityBars priority={p} size={14} /> {m.label}
            </button>
          );
        })}
      </SubMenu>

      {callbacks.onExecutionEngineChange ? (
        <SubMenu label="Execution Engine">
          {EXECUTION_ENGINES.map((engine) => (
            <button
              key={engine.value ?? "inherit"}
              type="button"
              style={itemStyle}
              onClick={() => {
                callbacks.onExecutionEngineChange?.(task.id, engine.value);
                onClose();
              }}
              onMouseEnter={hoverIn}
              onMouseLeave={hoverOut}
            >
              {engine.label}
            </button>
          ))}
        </SubMenu>
      ) : null}

      {callbacks.onModelLaneChange ? (
        <SubMenu label="Model Lane">
          {TASK_MODEL_LANES.map((lane) => (
            <button
              key={lane.value}
              type="button"
              title={lane.description}
              style={itemStyle}
              onClick={() => {
                callbacks.onModelLaneChange?.(task.id, lane.value as TaskModelLane);
                onClose();
              }}
              onMouseEnter={hoverIn}
              onMouseLeave={hoverOut}
            >
              {lane.label}
            </button>
          ))}
        </SubMenu>
      ) : null}

      <SubMenu label="Assign to">
        <button
          type="button" style={itemStyle}
          onClick={() => { callbacks.onAssigneeChange(task.id, ""); onClose(); }}
          onMouseEnter={hoverIn} onMouseLeave={hoverOut}
        >
          Unassigned
        </button>
        {agents.map((a) => (
          <button
            key={a.id} type="button" style={itemStyle}
            onClick={() => { callbacks.onAssigneeChange(task.id, a.name); onClose(); }}
            onMouseEnter={hoverIn} onMouseLeave={hoverOut}
          >
            {(() => {
              const av = resolveAvatar(a);
              // eslint-disable-next-line @next/next/no-img-element
              return av ? <img src={av} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} /> : <AvatarGlyph value={a.emoji} size={14} />;
            })()}
            {a.name}
          </button>
        ))}
      </SubMenu>

      <div style={{ height: "1px", background: SURFACE.lineSoft, margin: "4px 0" }} />

      <a
        href={taskUrl} target="_blank" rel="noopener noreferrer"
        style={{ ...itemStyle, textDecoration: "none" }}
        onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={onClose}
      >
        Open in New Tab
      </a>

      <button
        type="button" style={itemStyle}
        onClick={() => { navigator.clipboard.writeText(getTaskIdentifier(task)); onClose(); }}
        onMouseEnter={hoverIn} onMouseLeave={hoverOut}
      >
        Copy ID
      </button>

      <button
        type="button" style={{ ...itemStyle, color: "#ef4444" }}
        onClick={() => { onArchive(task.id); onClose(); }}
        onMouseEnter={hoverIn} onMouseLeave={hoverOut}
      >
        Archive
      </button>
    </div>
  );
}
