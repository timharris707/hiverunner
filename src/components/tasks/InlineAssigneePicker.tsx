"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { P, radius, type as tokenType } from "@/lib/ui/tokens";

interface Props {
  current: string | undefined;
  agents?: OrchestrationAgent[];
  onChange: (assignee: string) => void;
}

/** Resolve only the company-scoped DB avatar; static-name fallbacks can cross company boundaries. */
function resolveAvatar(agent: OrchestrationAgent): string | undefined {
  if (agent.avatar) return agent.avatar;
  return undefined;
}

export function AgentAvatarInline({ agent, size = 20 }: { agent: OrchestrationAgent; size?: number }) {
  const avatar = resolveAvatar(agent);
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatar} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    );
  }
  return (
    <span style={{
      width: size,
      height: size,
      borderRadius: radius.full,
      background: P.surfaceElevated,
      border: `1px solid ${P.cardBorder}`,
      color: P.textSecondary,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}>
      <AvatarGlyph value={agent.emoji} size={Math.max(11, Math.round(size * 0.58))} color={P.textSecondary} />
    </span>
  );
}

export function InlineAssigneePicker({ current, agents, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const roster = agents ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = 220;
      const menuHeight = Math.min(360, 40 + roster.length * 36);
      const left = Math.min(rect.left, window.innerWidth - menuWidth - 8);
      const belowTop = rect.bottom + 6;
      const top = belowTop + menuHeight > window.innerHeight - 8
        ? Math.max(8, rect.top - menuHeight - 6)
        : belowTop;
      setMenuPos({ left: Math.max(8, left), top });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, roster.length]);

  const currentAgent = roster.find(
    (a) => a.name.toLowerCase() === (current ?? "").toLowerCase() || a.id.toLowerCase() === (current ?? "").toLowerCase()
  );

  const menu = open && menuPos ? (
    <div style={{
      position: "fixed",
      top: menuPos.top,
      left: menuPos.left,
      zIndex: 1000,
      marginTop: 0,
      minWidth: "220px",
      maxHeight: "360px",
      overflowY: "auto",
      background: P.surfaceElevated,
      border: `1px solid ${P.cardBorder}`,
      borderRadius: radius.md,
      padding: "4px 0",
      boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
    }} ref={menuRef}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(""); setOpen(false); }}
        style={{
          display: "flex", alignItems: "center", gap: "8px", width: "100%",
          padding: "6px 12px", background: !current ? "rgba(255,255,255,0.05)" : "transparent",
          border: "none", cursor: "pointer", fontSize: tokenType.body.size, color: P.textMuted,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = !current ? "rgba(255,255,255,0.05)" : "transparent"; }}
      >
        Unassigned
      </button>
      {roster.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(a.name); setOpen(false); }}
          style={{
            display: "flex", alignItems: "center", gap: "8px", width: "100%",
            padding: "6px 12px",
            background: (current ?? "").toLowerCase() === a.name.toLowerCase() ? "rgba(255,255,255,0.05)" : "transparent",
            border: "none", cursor: "pointer", fontSize: tokenType.body.size, color: P.textSecondary,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = (current ?? "").toLowerCase() === a.name.toLowerCase() ? "rgba(255,255,255,0.05)" : "transparent"; }}
        >
          <AgentAvatarInline agent={a} />
          <span>{a.name}</span>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px",
          borderRadius: "4px", fontSize: tokenType.body.size, color: P.textSecondary,
          maxWidth: "132px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        {currentAgent ? (
          <>
            <AgentAvatarInline agent={currentAgent} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{currentAgent.name}</span>
          </>
        ) : (
          <span style={{ color: P.textMuted }}>{current || "Unassigned"}</span>
        )}
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

/** Re-export for use by other task-page surfaces. */
export { resolveAvatar };
