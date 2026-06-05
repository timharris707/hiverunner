"use client";

import { getAgentByAnyId } from "@/config/agents";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { agentDisplayLabel } from "@/lib/orchestration/avatar-icons";

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
  const label = title ?? (agent ? agentDisplayLabel(agent.emoji, agent.name) : agentId);

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
