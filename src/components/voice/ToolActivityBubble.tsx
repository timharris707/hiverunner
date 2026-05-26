"use client";

/**
 * ToolActivityBubble — inline conversation bubble for tool activity.
 *
 * Phase 11: renders tool dispatching/completed/error states as compact,
 * product-grade bubbles that sit in the conversation flow alongside
 * user and assistant transcript entries.
 *
 * Design intent: the user should feel that the assistant checked something
 * rather than seeing a debug panel flicker. Think iMessage typing indicator
 * meets a status card.
 *
 * Future: richer multimodal result cards (charts, images, structured data)
 * can replace the summary text area without changing the bubble shell.
 */

import {
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldOff,
  Cloud,
  Clock,
  Server,
  FolderKanban,
  Search,
  Wrench,
} from "lucide-react";
import type { ToolDispatchEvent } from "@/lib/voice-tool-dispatch";

// ─── Tool display metadata ───────────────────────────────────────────────────

const TOOL_DISPLAY: Record<string, { icon: typeof Wrench; label: string; verb: string }> = {
  get_weather: { icon: Cloud, label: "Weather", verb: "Checking weather" },
  get_current_time: { icon: Clock, label: "Time", verb: "Checking the time" },
  get_system_status: { icon: Server, label: "System", verb: "Checking system status" },
  get_project_summary: { icon: FolderKanban, label: "Projects", verb: "Reviewing projects" },
  search_tasks: { icon: Search, label: "Tasks", verb: "Searching tasks" },
  search_workspace_memory: { icon: Search, label: "Memory", verb: "Searching memory" },
  search_voice_memory: { icon: Search, label: "Voice memory", verb: "Searching voice memory" },
  get_current_context: { icon: FolderKanban, label: "Context", verb: "Refreshing current context" },
  add_task_comment: { icon: Wrench, label: "Task comment", verb: "Posting a task comment" },
  start_task_work: { icon: Wrench, label: "Start work", verb: "Starting task work" },
  move_task_status: { icon: Wrench, label: "Task status", verb: "Updating task status" },
};

function getToolDisplay(tool: string) {
  return TOOL_DISPLAY[tool] ?? { icon: Wrench, label: tool, verb: `Running ${tool}` };
}

// ─── Result summary formatter ────────────────────────────────────────────────

/** Extract a human-readable one-liner from tool output. */
function summarizeResult(tool: string, output: unknown): string {
  if (!output || typeof output !== "object") return "Done";
  const o = output as Record<string, unknown>;

  const formatTaskStatus = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    switch (value) {
      case "to-do":
        return "To-Do";
      case "in-progress":
      case "in_progress":
        return "In Progress";
      default:
        return value.replaceAll("_", "-");
    }
  };

  switch (tool) {
    case "get_weather": {
      if (o.error) return `Could not fetch weather: ${o.error}`;
      const parts = [];
      if (o.tempF) parts.push(`${o.tempF}°F`);
      if (o.description) parts.push(String(o.description).toLowerCase());
      if (o.humidity) parts.push(`${o.humidity}% humidity`);
      if (o.location) parts.push(`in ${o.location}`);
      return parts.length > 0 ? parts.join(", ") : "Weather data received";
    }
    case "get_current_time": {
      if (o.local) return `${o.local} (${o.dayOfWeek || ""})`;
      return o.iso ? String(o.iso) : "Time retrieved";
    }
    case "get_system_status": {
      const parts = [];
      if (o.nodeUptime) parts.push(`uptime ${o.nodeUptime}`);
      if (o.heapUsedMb) parts.push(`${o.heapUsedMb}MB heap`);
      if (o.env) parts.push(String(o.env));
      return parts.length > 0 ? parts.join(" · ") : "System OK";
    }
    case "get_project_summary": {
      const projects = o.activeProjects;
      if (Array.isArray(projects)) {
        return `${projects.length} active projects · ${o.agentCount ?? "?"} agents`;
      }
      return "Project summary retrieved";
    }
    case "search_tasks": {
      const count = typeof o.count === "number" ? o.count : 0;
      const q = o.query ? ` for "${o.query}"` : "";
      return `${count} task${count !== 1 ? "s" : ""} found${q}`;
    }
    case "search_workspace_memory":
    case "search_voice_memory": {
      const count = typeof o.count === "number" ? o.count : 0;
      const q = o.query ? ` for "${o.query}"` : "";
      return `${count} memory match${count !== 1 ? "es" : ""}${q}`;
    }
    case "get_current_context": {
      const context = typeof o.context === "string" ? o.context : "";
      return context ? `Fresh context loaded (${Math.min(context.length, 9999)} chars)` : "Fresh context loaded";
    }
    case "add_task_comment": {
      const deduped = o.deduped === true;
      const taskKey = typeof o.taskKey === "string" ? o.taskKey : undefined;
      return deduped
        ? `Comment already existed${taskKey ? ` on ${taskKey}` : ""}`
        : `Comment posted${taskKey ? ` on ${taskKey}` : ""}`;
    }
    case "start_task_work": {
      const taskKey = typeof o.taskKey === "string" ? o.taskKey : undefined;
      const execution = o.execution && typeof o.execution === "object"
        ? o.execution as Record<string, unknown>
        : {};
      if (execution.status === "queued" || execution.status === "running") {
        return `Work started${taskKey ? ` on ${taskKey}` : ""}`;
      }
      if (typeof execution.reason === "string") {
        return `Start requested; ${execution.reason.replaceAll("_", " ")}`;
      }
      return `Start requested${taskKey ? ` for ${taskKey}` : ""}`;
    }
    case "move_task_status": {
      const from = formatTaskStatus(o.fromStatus);
      const to = formatTaskStatus(typeof o.toStatus === "string" ? o.toStatus : o.status);
      if (o.changed === false) {
        return typeof o.reason === "string" ? o.reason.replaceAll("_", " ") : "Task already in requested state";
      }
      if (from && to) {
        return `Status ${from} → ${to}`;
      }
      return to ? `Status updated to ${to}` : "Task status updated";
    }
    default:
      return "Result received";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ToolActivityBubble({ event }: { event: ToolDispatchEvent }) {
  const display = getToolDisplay(event.tool);
  const Icon = display.icon;

  // --- Dispatching (in-flight) ---
  if (event.type === "dispatching") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 bg-purple-500/8 border border-purple-500/20 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-purple-500/15">
              <Icon size={13} className="text-purple-300" />
            </div>
            <span className="text-xs font-medium text-purple-200">
              {display.verb}…
            </span>
            <Loader2 size={12} className="text-purple-400 animate-spin ml-auto" />
          </div>
          {/* Phase 12+: streaming partial results could render here */}
        </div>
      </div>
    );
  }

  // --- Completed (success) ---
  if (event.type === "completed" && event.result) {
    const summary = summarizeResult(event.tool, event.result.output);
    const durationLabel =
      event.result.durationMs < 1000
        ? `${event.result.durationMs}ms`
        : `${(event.result.durationMs / 1000).toFixed(1)}s`;

    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 bg-emerald-500/8 border border-emerald-500/20 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-emerald-500/15">
              <Icon size={13} className="text-emerald-300" />
            </div>
            <span className="text-xs font-medium text-emerald-200">
              {display.label}
            </span>
            <CheckCircle2 size={12} className="text-emerald-400" />
            <span className="text-[10px] text-emerald-400/60 ml-auto font-mono">
              {durationLabel}
            </span>
          </div>
          <p className="text-[11px] text-zinc-300 mt-1.5 leading-relaxed">
            {summary}
          </p>
          {/* Phase 12+: structured result cards (tables, charts) plug in here */}
        </div>
      </div>
    );
  }

  // --- Error ---
  if (event.type === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 bg-red-500/8 border border-red-500/20 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-red-500/15">
              <Icon size={13} className="text-red-300" />
            </div>
            <span className="text-xs font-medium text-red-200">
              {display.label} failed
            </span>
            <XCircle size={12} className="text-red-400" />
          </div>
          {event.error && (
            <p className="text-[10px] text-red-300/70 mt-1">
              {event.error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // --- Rejected ---
  if (event.type === "rejected") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 bg-zinc-700/30 border border-zinc-600/30 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <ShieldOff size={13} className="text-zinc-400" />
            <span className="text-xs text-zinc-400">
              {display.label} — not available
            </span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
