"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { getAgentByAnyId } from "@/config/agents";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";

export type ReportsToAgentOption = {
  id: string;
  name: string;
  avatar?: string;
  emoji?: string;
  openclawAgentId?: string;
};

const controlStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "42px",
  borderRadius: "10px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  padding: "9px 12px",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  color: "var(--text-primary)",
  fontSize: "13px",
  textAlign: "left",
  cursor: "pointer",
  outline: "none",
};

function AgentMark({ agent }: { agent: ReportsToAgentOption }) {
  const configAgent = getAgentByAnyId(agent.id) ?? getAgentByAnyId(agent.name);
  const avatar = agent.avatar || configAgent?.avatar;
  const border = configAgent?.divisionColor ?? "#78716c";

  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt=""
        aria-hidden="true"
        width={24}
        height={24}
        style={{
          width: "24px",
          height: "24px",
          borderRadius: "999px",
          objectFit: "cover",
          border: `1px solid ${border}`,
          boxShadow: `0 0 0 1px ${border}30`,
          flex: "0 0 24px",
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        width: "24px",
        height: "24px",
        borderRadius: "999px",
        border: `1px solid ${border}`,
        background: `${border}20`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 24px",
      }}
    >
      <AvatarGlyph value={agent.emoji ?? configAgent?.emoji} size={13} />
    </span>
  );
}

export function ReportsToPicker({
  value,
  onChange,
  agents,
}: {
  value: string;
  onChange: (value: string) => void;
  agents: ReportsToAgentOption[];
}) {
  const [open, setOpen] = useState(false);
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === value) ?? null,
    [agents, value],
  );

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        data-testid="reports-to-picker"
        onClick={() => setOpen((current) => !current)}
        style={controlStyle}
      >
        {selectedAgent ? <AgentMark agent={selectedAgent} /> : null}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedAgent?.name ?? "Unassigned"}
        </span>
        <ChevronDown
          size={17}
          color="#a8a29e"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transformOrigin: "center",
            transition: "transform 120ms ease",
          }}
        />
      </button>

      {open ? (
        <div
          data-testid="reports-to-menu"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 50,
            borderRadius: "12px",
            border: "1px solid var(--border)",
            background: "var(--surface-elevated)",
            boxShadow: "var(--shadow-glass)",
            padding: "6px",
            maxHeight: "286px",
            overflowY: "auto",
          }}
        >
          <button
            type="button"
            data-testid="reports-to-option"
            onClick={() => choose("")}
            style={{
              width: "100%",
              minHeight: "40px",
              border: 0,
              borderTop: "none",
              borderBottom: "none",
              borderRadius: "8px",
              boxShadow: "none",
              background: value ? "transparent" : "var(--surface-hover)",
              color: "var(--text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 9px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ flex: 1, fontSize: "13px", fontWeight: 600 }}>Unassigned</span>
            {!value ? <Check size={16} color="var(--text-primary)" strokeWidth={2.4} /> : null}
          </button>
          {agents.map((agent) => {
            const selected = agent.id === value;
            return (
              <button
                key={agent.id}
                type="button"
                data-testid="reports-to-option"
                onClick={() => choose(agent.id)}
                style={{
                  width: "100%",
                  minHeight: "42px",
                  border: 0,
                  borderTop: "none",
                  borderBottom: "none",
                  borderRadius: "8px",
                  boxShadow: "none",
                  background: selected ? "var(--surface-hover)" : "transparent",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 9px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <AgentMark agent={agent} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px", fontWeight: 600 }}>
                  {agent.name}
                </span>
                {selected ? <Check size={16} color="var(--text-primary)" strokeWidth={2.4} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
