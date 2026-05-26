"use client";

import { useEffect, useRef, useState } from "react";

import { AgentAvatarInline } from "@/components/tasks/InlineAssigneePicker";
import { findGoalOwnerAgent, firstGoalOwnerName, unresolvedGoalOwnerLabel } from "@/components/goals/GoalPrimitives";
import type { OrchestrationAgent, OrchestrationSprint } from "@/lib/orchestration/types";

export type EditableSprintOwner = {
  id: string;
  name: string;
  status: OrchestrationSprint["status"];
  owner?: string | null;
};

export function OwnerChip({
  sprint,
  agents,
  onChange,
}: {
  sprint: EditableSprintOwner;
  agents: OrchestrationAgent[];
  onChange: (owner: string | null) => void;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const ownerAgent = findGoalOwnerAgent(sprint.owner ?? undefined, agents);
  const missingOwner = Boolean(sprint.owner && !ownerAgent);
  const shouldRender = Boolean(sprint.owner) || sprint.status !== "done";

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

  if (!shouldRender) return <span aria-hidden="true" />;

  const label = sprint.owner && !ownerAgent ? unresolvedGoalOwnerLabel(sprint.owner, agents) : "Unassigned";
  const title = ownerAgent ? `${ownerAgent.name} - ${ownerAgent.role}` : sprint.owner ?? "Unassigned";
  const editable = !missingOwner;

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex", justifyContent: "flex-end" }}>
      <button
        type="button"
        title={title}
        aria-label={`Change owner for ${sprint.name}`}
        aria-expanded={open}
        disabled={!editable}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (editable) setOpen((current) => !current);
        }}
        style={{
          border: "0.5px solid var(--border)",
          borderRadius: "999px",
          background: sprint.owner ? "var(--surface-hover)" : "transparent",
          color: sprint.owner ? "var(--text-secondary)" : "color-mix(in srgb, var(--text-muted) 65%, transparent)",
          cursor: editable ? "pointer" : "default",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: "11px",
          maxWidth: 112,
          overflow: "hidden",
          padding: "2px 8px",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {ownerAgent ? <AgentAvatarInline agent={ownerAgent} size={14} /> : null}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {ownerAgent ? firstGoalOwnerName(ownerAgent.name) : label}
        </span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={`Owner options for ${sprint.name}`}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            zIndex: 65,
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 220,
            maxHeight: 280,
            overflowY: "auto",
            padding: 6,
            borderRadius: "10px",
            border: "0.5px solid var(--border)",
            background: "var(--modal-glass)",
            boxShadow: "var(--shadow-glass)",
          }}
        >
          <button
            type="button"
            role="option"
            aria-selected={!sprint.owner}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              onChange(null);
            }}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "none",
              borderRadius: "8px",
              background: !sprint.owner ? "var(--surface-hover)" : "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "12px",
              textAlign: "left",
            }}
          >
            Unassigned
          </button>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              role="option"
              aria-selected={ownerAgent?.id === agent.id}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                onChange(agent.name);
              }}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "24px minmax(0, 1fr)",
                alignItems: "center",
                gap: "8px",
                padding: "8px 10px",
                border: "none",
                borderRadius: "8px",
                background: ownerAgent?.id === agent.id ? "var(--surface-hover)" : "transparent",
                color: "var(--text-primary)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <AgentAvatarInline agent={agent} size={22} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", fontWeight: 600 }}>
                  {agent.name}
                </span>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", color: "var(--text-muted)" }}>
                  {agent.role}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
