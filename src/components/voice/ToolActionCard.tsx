"use client";

/**
 * ToolActionCard — renders a single VoiceActionIntent as a structured card.
 *
 * Phase 10: product-surface for tool/action visibility during voice conversations.
 * Future: richer multimodal cards (images, charts, confirmations) can extend this layout.
 */

import { useEffect, useState } from "react";
import { Check, X, Wrench, Flag, Sparkles, Clock } from "lucide-react";
import type { VoiceActionIntent } from "@/lib/voice-action-intent";

const INTENT_META: Record<
  VoiceActionIntent["name"],
  { icon: typeof Wrench; label: string; accent: string; bg: string; border: string }
> = {
  "tool.request": {
    icon: Wrench,
    label: "Tool Request",
    accent: "text-purple-300",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
  },
  "session.marker": {
    icon: Flag,
    label: "Session Marker",
    accent: "text-blue-300",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  "ui.signal": {
    icon: Sparkles,
    label: "UI Signal",
    accent: "text-amber-300",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
};

const STATUS_BADGE: Record<
  VoiceActionIntent["status"],
  { label: string; className: string }
> = {
  proposed: { label: "Proposed", className: "text-amber-300 bg-amber-500/15 border-amber-500/30" },
  acknowledged: { label: "Accepted", className: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30" },
  rejected: { label: "Dismissed", className: "text-zinc-400 bg-zinc-700/40 border-zinc-600/40" },
};

export function formatIntentAgeLabel(ageMs: number): string {
  const clampedAgeMs = Math.max(0, ageMs);

  if (clampedAgeMs < 60_000) {
    return `${Math.round(clampedAgeMs / 1000)}s ago`;
  }

  return `${Math.round(clampedAgeMs / 60_000)}m ago`;
}

export function ToolActionCard({
  intent,
  onAcknowledge,
}: {
  intent: VoiceActionIntent;
  onAcknowledge?: (id: string, accepted: boolean) => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 5_000);

    return () => window.clearInterval(interval);
  }, []);

  const meta = INTENT_META[intent.name];
  const Icon = meta.icon;
  const badge = STATUS_BADGE[intent.status];
  const ageLabel = formatIntentAgeLabel(now - intent.createdAt);

  // Extract display-friendly payload summary
  const payloadEntries = Object.entries(intent.payload).slice(0, 4);

  return (
    <div
      className={`rounded-lg border ${meta.border} ${meta.bg} p-3 transition-all duration-200 ${
        intent.status === "rejected" ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-md ${meta.bg} ${meta.accent}`}>
            <Icon size={14} />
          </div>
          <div>
            <div className={`text-xs font-semibold ${meta.accent}`}>{meta.label}</div>
            <div className="text-[10px] text-zinc-500 flex items-center gap-1 mt-0.5">
              <Clock size={9} />
              {ageLabel} · {Math.round(intent.confidence * 100)}% confidence
            </div>
          </div>
        </div>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      {/* Payload key-value pairs */}
      {payloadEntries.length > 0 && (
        <div className="mt-2 space-y-1">
          {payloadEntries.map(([key, value]) => (
            <div key={key} className="flex items-baseline gap-2 text-[11px]">
              <span className="text-zinc-500 font-mono shrink-0">{key}</span>
              <span className="text-zinc-300 truncate">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Accept/dismiss actions for proposed intents */}
      {intent.status === "proposed" && onAcknowledge && (
        <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-zinc-700/40">
          <button
            onClick={() => onAcknowledge(intent.id, true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
          >
            <Check size={10} /> Accept
          </button>
          <button
            onClick={() => onAcknowledge(intent.id, false)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-zinc-700/30 text-zinc-400 border border-zinc-600/40 hover:bg-zinc-700/50 transition-colors"
          >
            <X size={10} /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
