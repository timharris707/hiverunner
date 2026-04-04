"use client";

/**
 * TurnTimeline — waterfall view of conversation turns with phase timing.
 *
 * Phase 10: shows the flow of a voice conversation as a series of turn cards
 * with timing breakdowns. Future: click-to-replay, tool result inline expansion.
 */

import { useMemo } from "react";
import {
  Mic,
  Brain,
  Wrench,
  Volume2,
  AlertTriangle,
  Zap,
  Clock,
} from "lucide-react";
import type { TurnTelemetry } from "@/lib/voice-runtime";

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Tiny phase bar segment for the waterfall. */
function PhaseSegment({
  label,
  durationMs,
  totalMs,
  color,
}: {
  label: string;
  durationMs: number | undefined;
  totalMs: number;
  color: string;
}) {
  if (!durationMs || !totalMs) return null;
  const pct = Math.max(2, Math.min(100, (durationMs / totalMs) * 100));

  return (
    <div
      className="h-2 rounded-sm relative group cursor-default"
      style={{ width: `${pct}%`, backgroundColor: color, minWidth: 4 }}
      title={`${label}: ${formatDuration(durationMs)}`}
    >
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[9px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
        {label}: {formatDuration(durationMs)}
      </div>
    </div>
  );
}

function TurnCard({ turn, index }: { turn: TurnTelemetry; index: number }) {
  const total = turn.durationsMs.total || 1;
  const statusIcon =
    turn.status === "interrupted" ? (
      <AlertTriangle size={11} className="text-rose-400" />
    ) : turn.status === "error" ? (
      <Zap size={11} className="text-red-400" />
    ) : (
      <Clock size={11} className="text-emerald-400" />
    );

  const hasTooling = turn.actionIntentIds.length > 0;
  const toolingDuration = turn.toolingAt && turn.speakingAt
    ? Math.max(0, turn.speakingAt - turn.toolingAt)
    : undefined;

  return (
    <div className="flex gap-3 items-start">
      {/* Timeline gutter */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${
            turn.status === "interrupted"
              ? "border-rose-500/50 bg-rose-500/15 text-rose-300"
              : turn.status === "error"
              ? "border-red-500/50 bg-red-500/15 text-red-300"
              : hasTooling
              ? "border-purple-500/40 bg-purple-500/10 text-purple-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {index + 1}
        </div>
        {/* connector line */}
        <div className="w-px flex-1 bg-zinc-700/50 min-h-[12px]" />
      </div>

      {/* Turn content */}
      <div className={`flex-1 rounded-lg border p-2.5 mb-2 ${
        hasTooling
          ? "border-purple-500/20 bg-purple-500/5"
          : "border-zinc-700/50 bg-zinc-900/40"
      }`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            {statusIcon}
            <span className="text-zinc-300 font-mono text-[10px]">{turn.turnId.split(":").pop()}</span>
            <span className="text-zinc-500">{formatDuration(turn.durationsMs.total)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {hasTooling && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
                <Wrench size={9} className="inline mr-0.5" />
                {turn.actionIntentIds.length} tool{turn.actionIntentIds.length !== 1 ? "s" : ""}
              </span>
            )}
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium capitalize ${
                turn.status === "completed"
                  ? "bg-emerald-500/10 text-emerald-300"
                  : turn.status === "interrupted"
                  ? "bg-rose-500/10 text-rose-300"
                  : "bg-zinc-700/30 text-zinc-400"
              }`}
            >
              {turn.status}
            </span>
          </div>
        </div>

        {/* Phase waterfall bar — now includes tooling segment */}
        <div className="flex items-center gap-0.5 mt-2 rounded-sm overflow-hidden bg-zinc-800/60 h-2">
          <PhaseSegment label="Listen→Think" durationMs={turn.durationsMs.listenToThink} totalMs={total} color="#38bdf8" />
          {hasTooling && toolingDuration ? (
            <PhaseSegment label="Tooling" durationMs={toolingDuration} totalMs={total} color="#a78bfa" />
          ) : (
            <PhaseSegment label="Think→Speak" durationMs={turn.durationsMs.thinkToSpeak} totalMs={total} color="#a78bfa" />
          )}
          <PhaseSegment label="Speaking" durationMs={turn.durationsMs.speakToComplete} totalMs={total} color="#d97706" />
        </div>

        {/* Phase timing details */}
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <Mic size={9} className="text-sky-400" />
            {formatDuration(turn.durationsMs.listenToThink)}
          </span>
          {hasTooling && toolingDuration ? (
            <span className="flex items-center gap-1">
              <Wrench size={9} className="text-purple-400" />
              {formatDuration(toolingDuration)}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Brain size={9} className="text-purple-400" />
              {formatDuration(turn.durationsMs.thinkToSpeak)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Volume2 size={9} className="text-amber-400" />
            {formatDuration(turn.durationsMs.speakToComplete)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function TurnTimeline({ turns }: { turns: TurnTelemetry[] }) {
  // Show most recent first, but cap at 10 for UI sanity
  const visibleTurns = useMemo(() => turns.slice(0, 10), [turns]);

  if (visibleTurns.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-zinc-500">
        Turn timeline appears here as the conversation flows.
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {visibleTurns.map((turn, i) => (
        <TurnCard key={turn.turnId} turn={turn} index={turns.length - 1 - i} />
      ))}
    </div>
  );
}
