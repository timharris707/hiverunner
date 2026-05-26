"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { Mic } from "lucide-react";

import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";
import type { VoiceBindingSource, VoiceSessionMode } from "@/lib/voice-binding";

type LaunchVoiceLinkProps = {
  label: string;
  companySlug?: string;
  projectId?: string;
  projectSlug?: string;
  taskId?: string;
  taskKey?: string;
  agentId?: string;
  agentName?: string;
  mode?: VoiceSessionMode;
  source?: VoiceBindingSource;
  style?: CSSProperties;
};

function buildVoiceHref({
  companySlug,
  projectId,
  projectSlug,
  taskId,
  taskKey,
  agentId,
  agentName,
  mode = "discuss",
  source,
}: Omit<LaunchVoiceLinkProps, "label" | "style">): string {
  const params = new URLSearchParams();

  if (companySlug) params.set("companySlug", companySlug);
  if (projectId) params.set("projectId", projectId);
  if (projectSlug) params.set("projectSlug", projectSlug);
  if (taskId) params.set("taskId", taskId);
  if (taskKey) params.set("taskKey", taskKey);
  if (agentId) params.set("agentId", agentId);
  if (agentName) params.set("agentName", agentName);
  if (mode) params.set("mode", mode);
  if (source) params.set("source", source);

  const query = params.toString();
  return query ? `/voice?${query}` : "/voice";
}

export function LaunchVoiceLink({
  label,
  companySlug,
  projectId,
  projectSlug,
  taskId,
  taskKey,
  agentId,
  agentName,
  mode = "discuss",
  source,
  style,
}: LaunchVoiceLinkProps) {
  const href = buildVoiceHref({
    companySlug,
    projectId,
    projectSlug,
    taskId,
    taskKey,
    agentId,
    agentName,
    mode,
    source,
  });

  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: space.xs,
        padding: `${space.sm}px ${space.md}px`,
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: "transparent",
        color: color.textSecondary,
        fontSize: typeScale.bodySmall.size,
        fontWeight: 500,
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
        ...style,
      }}
      aria-label={label}
      title={`${label} in Voice Chat`}
    >
      <Mic size={14} />
      {label}
    </Link>
  );
}
