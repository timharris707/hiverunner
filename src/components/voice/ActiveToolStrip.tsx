"use client";

/**
 * ActiveToolStrip — compact inline indicator of active/recent tool use.
 *
 * Phase 11: sits beneath the voice tile or controls to give an
 * at-a-glance sense of what the assistant is doing without requiring the user to
 * look at the transcript panel. Think of it like a status bar in an IDE.
 *
 * Shows: current in-flight tool (if any) + last completed result summary.
 * Collapses to nothing when idle.
 *
 * Future: click-to-expand for full result detail, cancel button for
 * long-running tools, multi-tool parallel strip.
 */

import {
  Loader2,
  CheckCircle2,
  XCircle,
  Cloud,
  Clock,
  Server,
  FolderKanban,
  Search,
  Wrench,
} from "lucide-react";
import type { ToolDispatchEvent } from "@/lib/voice-tool-dispatch";

const TOOL_ICONS: Record<string, typeof Wrench> = {
  get_weather: Cloud,
  get_current_time: Clock,
  get_system_status: Server,
  get_project_summary: FolderKanban,
  search_tasks: Search,
  search_workspace_memory: Search,
  search_voice_memory: Search,
  get_current_context: FolderKanban,
};

const TOOL_LABELS: Record<string, string> = {
  get_weather: "Weather",
  get_current_time: "Time",
  get_system_status: "System",
  get_project_summary: "Projects",
  search_tasks: "Tasks",
  search_workspace_memory: "Memory",
  search_voice_memory: "Voice memory",
  get_current_context: "Context",
};

export function ActiveToolStrip({ toolEvents }: { toolEvents: ToolDispatchEvent[] }) {
  // Find the most recent dispatching event that hasn't been resolved
  const resolvedIntents = new Set<string>();
  const latestByIntent = new Map<string, ToolDispatchEvent>();

  for (const evt of toolEvents) {
    if (!latestByIntent.has(evt.intentId)) {
      latestByIntent.set(evt.intentId, evt);
    }
    if (evt.type !== "dispatching") {
      resolvedIntents.add(evt.intentId);
    }
  }

  const inflight = toolEvents.find(
    (e) => e.type === "dispatching" && !resolvedIntents.has(e.intentId)
  );

  const lastCompleted = toolEvents.find(
    (e) => e.type === "completed" || e.type === "error"
  );

  if (!inflight && !lastCompleted) return null;

  const InflightIcon = inflight ? (TOOL_ICONS[inflight.tool] ?? Wrench) : null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-700/40 text-[11px]">
      {inflight && InflightIcon && (
        <div className="flex items-center gap-1.5 text-purple-300">
          <InflightIcon size={12} />
          <span className="font-medium">
            {TOOL_LABELS[inflight.tool] ?? inflight.tool}
          </span>
          <Loader2 size={10} className="animate-spin text-purple-400/70" />
        </div>
      )}

      {inflight && lastCompleted && (
        <span className="text-zinc-600">·</span>
      )}

      {lastCompleted && (
        <div className={`flex items-center gap-1.5 ${
          lastCompleted.type === "completed" ? "text-emerald-400/80" : "text-red-400/80"
        }`}>
          {lastCompleted.type === "completed" ? (
            <CheckCircle2 size={10} />
          ) : (
            <XCircle size={10} />
          )}
          <span>
            {TOOL_LABELS[lastCompleted.tool] ?? lastCompleted.tool}
            {lastCompleted.type === "completed" && lastCompleted.result?.durationMs != null && (
              <span className="text-zinc-500 ml-1">
                {lastCompleted.result.durationMs < 1000
                  ? `${lastCompleted.result.durationMs}ms`
                  : `${(lastCompleted.result.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
