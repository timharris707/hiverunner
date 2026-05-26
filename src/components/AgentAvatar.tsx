"use client";

import { getAgentByAnyId } from "@/config/agents";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";

interface AgentAvatarProps {
  /** Agent ID — any variant: "t1", "backend-eng", etc. */
  agentId: string;
  /** Diameter in px (default 40) */
  size?: number;
  /** Optional border color override. Defaults to agent's division color. */
  borderColor?: string;
  /** Border width in px (default 2) */
  borderWidth?: number;
  /** Additional className */
  className?: string;
  /** Show emoji fallback circle if no avatar found (default: true) */
  showFallback?: boolean;
  /** Title tooltip */
  title?: string;
}

/**
 * AgentAvatar — renders a round avatar image with division-color border.
 * Falls back to an emoji circle if the image is unavailable or agent is unknown.
 * Uses a plain <img> tag (not next/image) because avatars are served from /public
 * and next/image requires extra config for local static assets at runtime.
 */
export function AgentAvatar({
  agentId,
  size = 40,
  borderColor,
  borderWidth = 2,
  className = "",
  showFallback = true,
  title,
}: AgentAvatarProps) {
  const agent = getAgentByAnyId(agentId);
  const border = borderColor ?? agent?.divisionColor ?? "#6b7280";
  const label = title ?? (agent ? `${agent.emoji} ${agent.name}` : agentId);

  if (agent?.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={agent.avatar}
        alt={label}
        title={label}
        width={size}
        height={size}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
        style={{
          width: size,
          height: size,
          minWidth: size,
          border: `${borderWidth}px solid ${border}`,
          boxShadow: `0 0 0 1px ${border}30`,
        }}
        onError={(e) => {
          // Fallback: hide broken image, show emoji placeholder via sibling
          const el = e.currentTarget as HTMLImageElement;
          el.style.display = "none";
          const fallback = el.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "flex";
        }}
      />
    );
  }

  if (!showFallback) return null;

  // Emoji fallback circle
  return (
    <div
      title={label}
      className={`rounded-full flex items-center justify-center flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        border: `${borderWidth}px solid ${border}`,
        backgroundColor: `${border}20`,
        fontSize: Math.max(size * 0.45, 12),
        lineHeight: 1,
      }}
    >
      <AvatarGlyph value={agent?.emoji} size={Math.max(size * 0.45, 12)} />
    </div>
  );
}

/**
 * AgentAvatarWithFallback — renders img with a fallback emoji div.
 * Handles the case where the image might load but then error.
 */
export function AgentAvatarWithFallback({
  agentId,
  size = 40,
  borderColor,
  borderWidth = 2,
  className = "",
}: AgentAvatarProps) {
  const agent = getAgentByAnyId(agentId);
  const border = borderColor ?? agent?.divisionColor ?? "#6b7280";
  const label = agent ? `${agent.emoji} ${agent.name}` : agentId;

  const sharedStyle: React.CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    border: `${borderWidth}px solid ${border}`,
  };

  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {agent?.avatar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={agent.avatar}
          alt={label}
          title={label}
          width={size}
          height={size}
          className={`rounded-full object-cover flex-shrink-0 ${className}`}
          style={{ ...sharedStyle, boxShadow: `0 0 0 1px ${border}30` }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
            const fb = document.getElementById(`avatar-fb-${agentId}-${size}`);
            if (fb) fb.style.display = "flex";
          }}
        />
      )}
      <span
        id={`avatar-fb-${agentId}-${size}`}
        title={label}
        className={`rounded-full items-center justify-center flex-shrink-0 ${className}`}
        style={{
          ...sharedStyle,
          display: agent?.avatar ? "none" : "flex",
          backgroundColor: `${border}20`,
          fontSize: Math.max(size * 0.45, 12),
        }}
      >
        <AvatarGlyph value={agent?.emoji} size={Math.max(size * 0.45, 12)} />
      </span>
    </span>
  );
}

/**
 * AvatarStack — shows a row of overlapping agent avatars (max 4 + overflow badge).
 */
export function AvatarStack({
  agentIds,
  size = 28,
  max = 4,
}: {
  agentIds: string[];
  size?: number;
  max?: number;
}) {
  const visible = agentIds.slice(0, max);
  const overflow = agentIds.length - max;

  return (
    <div className="flex items-center" style={{ gap: `-${size * 0.3}px` }}>
      {visible.map((id, i) => (
        <div
          key={id}
          style={{
            marginLeft: i === 0 ? 0 : -(size * 0.3),
            zIndex: visible.length - i,
            position: "relative",
          }}
        >
          <AgentAvatar agentId={id} size={size} borderWidth={2} />
        </div>
      ))}
      {overflow > 0 && (
        <div
          className="rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{
            width: size,
            height: size,
            minWidth: size,
            marginLeft: -(size * 0.3),
            backgroundColor: "var(--surface-elevated)",
            border: "2px solid var(--border)",
            color: "var(--text-muted)",
            fontSize: Math.max(size * 0.3, 9),
            zIndex: 0,
            position: "relative",
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
