"use client";

import { type CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { LUCIDE_ICON_MAP } from "./lucide-icons";

export const AVATAR_ICON_PREFIX = "icon:";

export function avatarIconToken(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith(AVATAR_ICON_PREFIX)) return null;

  const iconKey = trimmed.slice(AVATAR_ICON_PREFIX.length);
  return LUCIDE_ICON_MAP.has(iconKey) ? iconKey : null;
}

export function toAvatarIconToken(iconKey: string): string {
  return `${AVATAR_ICON_PREFIX}${iconKey}`;
}

const DEFAULT_AVATAR_ICON = toAvatarIconToken("bot");

export function AvatarGlyph({
  value,
  size = 14,
  fallback = DEFAULT_AVATAR_ICON,
  color,
  className,
  style,
}: {
  value?: string | null;
  size?: number;
  fallback?: string;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const displayValue = value && value.trim() ? value : fallback;
  const iconKey = avatarIconToken(displayValue) ?? (
    displayValue.trim().startsWith(AVATAR_ICON_PREFIX) ? avatarIconToken(fallback) : null
  );

  if (!iconKey) {
    return (
      <span
        className={className}
        style={{
          fontSize: size,
          lineHeight: 1,
          color,
          ...style,
        }}
      >
        {displayValue}
      </span>
    );
  }

  const Icon = LUCIDE_ICON_MAP.get(iconKey)?.icon as LucideIcon | undefined;
  if (!Icon) {
    return (
      <span
        className={className}
        style={{
          fontSize: size,
          lineHeight: 1,
          color,
          ...style,
        }}
      >
        {displayValue}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
        color,
        ...style,
      }}
    >
      <Icon size={size} color={color} />
    </span>
  );
}
