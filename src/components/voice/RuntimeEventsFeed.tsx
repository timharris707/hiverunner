"use client";

/**
 * RuntimeEventsFeed — live scrolling feed of voice runtime state transitions.
 *
 * Phase 10: makes runtime mode changes visible in a digestible feed.
 * Future: real tool-dispatch events (from Forge), WebRTC ICE events,
 * and multimodal payload arrivals slot into the same feed shape.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Mic,
  Brain,
  Wrench,
  Volume2,
  AlertTriangle,
  Zap,
  Radio,
  ArrowRight,
  Pause,
  Power,
} from "lucide-react";
import type { VoiceRuntimeMode, VoiceRuntimeSnapshot } from "@/lib/voice-runtime";

export interface RuntimeEvent {
  id: string;
  timestamp: number;
  fromMode: VoiceRuntimeMode;
  toMode: VoiceRuntimeMode;
  reason?: string;
}

const MODE_META: Record<VoiceRuntimeMode, { icon: typeof Mic; color: string; label: string }> = {
  idle: { icon: Power, color: "text-zinc-500", label: "Idle" },
  listening: { icon: Mic, color: "text-sky-400", label: "Listening" },
  thinking: { icon: Brain, color: "text-blue-400", label: "Thinking" },
  tooling: { icon: Wrench, color: "text-purple-400", label: "Tooling" },
  speaking: { icon: Volume2, color: "text-amber-400", label: "Speaking" },
  interrupted: { icon: AlertTriangle, color: "text-rose-400", label: "Interrupted" },
  releasing: { icon: Pause, color: "text-yellow-400", label: "Releasing" },
  disconnected: { icon: Power, color: "text-zinc-400", label: "Disconnected" },
  error: { icon: Zap, color: "text-red-400", label: "Error" },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EventRow({ event }: { event: RuntimeEvent }) {
  const from = MODE_META[event.fromMode];
  const to = MODE_META[event.toMode];
  const ToIcon = to.icon;

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-zinc-800/40 transition-colors group">
      <span className="text-[10px] text-zinc-600 font-mono shrink-0 w-16">
        {formatTime(event.timestamp)}
      </span>
      <span className={`text-[10px] ${from.color} shrink-0 w-16 truncate`}>{from.label}</span>
      <ArrowRight size={10} className="text-zinc-600 shrink-0" />
      <ToIcon size={12} className={`${to.color} shrink-0`} />
      <span className={`text-xs font-medium ${to.color} shrink-0`}>{to.label}</span>
      {event.reason && (
        <span className="text-[10px] text-zinc-500 truncate ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {event.reason}
        </span>
      )}
    </div>
  );
}

/**
 * Hook to accumulate runtime events from snapshot changes.
 * Call this in the parent and pass events into RuntimeEventsFeed.
 */
export function useRuntimeEvents(runtime: VoiceRuntimeSnapshot, maxEvents = 50) {
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const prevModeRef = useRef<VoiceRuntimeMode>(runtime.mode);
  const counterRef = useRef(0);

  useEffect(() => {
    if (runtime.mode !== prevModeRef.current) {
      const event: RuntimeEvent = {
        id: `re_${++counterRef.current}`,
        timestamp: runtime.changedAt,
        fromMode: prevModeRef.current,
        toMode: runtime.mode,
        reason: runtime.reason,
      };
      prevModeRef.current = runtime.mode;
      setEvents((prev) => [event, ...prev].slice(0, maxEvents));
    }
  }, [runtime.mode, runtime.changedAt, runtime.reason, maxEvents]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, clearEvents };
}

export function RuntimeEventsFeed({
  events,
  onClear,
}: {
  events: RuntimeEvent[];
  onClear?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Show most recent 20 events
  const visible = useMemo(() => events.slice(0, 20), [events]);

  return (
    <div className="rounded-lg border border-zinc-700/50 bg-zinc-950/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/40">
        <div className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
          <Radio size={12} className="text-emerald-400" />
          Runtime Events
          {events.length > 0 && (
            <span className="text-[10px] text-zinc-500">({events.length})</span>
          )}
        </div>
        {onClear && events.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <div ref={scrollRef} className="max-h-[200px] overflow-y-auto">
        {visible.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-zinc-600">
            {/* Future: Forge tool-dispatch events and WebRTC ICE transitions appear here */}
            Runtime transitions appear here when the session is active.
          </div>
        ) : (
          <div className="py-1">
            {visible.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
