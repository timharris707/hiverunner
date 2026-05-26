"use client";

/**
 * ToolOutcomePanel — displays tool/action intent results in a structured panel.
 *
 * Phase 10: shows acknowledged/rejected/proposed tool intents grouped by recency.
 * Future: Forge will push real tool dispatch results (search results, code output,
 * API responses) that render as richer cards within this same panel container.
 */

import { useMemo } from "react";
import { Wrench, CheckCircle2, XCircle, Clock, ChevronDown } from "lucide-react";
import type { VoiceActionIntent } from "@/lib/voice-action-intent";
import { ToolActionCard } from "./ToolActionCard";

export function ToolOutcomePanel({
  intents,
  onAcknowledge,
}: {
  intents: VoiceActionIntent[];
  onAcknowledge?: (id: string, accepted: boolean) => void;
}) {
  const { proposed, resolved } = useMemo(() => {
    const proposed = intents.filter((i) => i.status === "proposed");
    const resolved = intents.filter((i) => i.status !== "proposed").slice(0, 8);
    return { proposed, resolved };
  }, [intents]);

  const stats = useMemo(() => {
    const accepted = intents.filter((i) => i.status === "acknowledged").length;
    const dismissed = intents.filter((i) => i.status === "rejected").length;
    return { total: intents.length, accepted, dismissed, pending: proposed.length };
  }, [intents, proposed]);

  if (intents.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-950/60 p-4">
        <div className="text-xs font-medium text-zinc-300 flex items-center gap-1.5 mb-3">
          <Wrench size={13} className="text-zinc-400" />
          Tool Actions
        </div>
        <div className="text-center py-4 text-[11px] text-zinc-600">
          {/* Phase 10 hook: tool dispatch results from Forge runtime appear here */}
          No tool actions in this session yet. The assistant will surface actions as the conversation flows.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700/50 bg-zinc-950/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
          <Wrench size={13} className="text-purple-400" />
          Tool Actions
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          {stats.pending > 0 && (
            <span className="flex items-center gap-1 text-amber-300">
              <Clock size={9} /> {stats.pending} pending
            </span>
          )}
          {stats.accepted > 0 && (
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 size={9} /> {stats.accepted}
            </span>
          )}
          {stats.dismissed > 0 && (
            <span className="flex items-center gap-1 text-zinc-400">
              <XCircle size={9} /> {stats.dismissed}
            </span>
          )}
        </div>
      </div>

      {/* Proposed intents get prominence */}
      {proposed.length > 0 && (
        <div className="space-y-2">
          {proposed.map((intent) => (
            <ToolActionCard key={intent.id} intent={intent} onAcknowledge={onAcknowledge} />
          ))}
        </div>
      )}

      {/* Resolved intents in a compact list */}
      {resolved.length > 0 && (
        <details className="group">
          <summary className="flex items-center gap-1.5 text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors">
            <ChevronDown size={10} className="group-open:rotate-180 transition-transform" />
            {resolved.length} resolved action{resolved.length !== 1 ? "s" : ""}
          </summary>
          <div className="mt-2 space-y-1.5">
            {resolved.map((intent) => (
              <ToolActionCard key={intent.id} intent={intent} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
