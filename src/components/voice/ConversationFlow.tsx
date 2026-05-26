"use client";

/**
 * ConversationFlow — unified conversation view for /voice.
 *
 * Phase 11: replaces the old TranscriptPanel with an interleaved view
 * of user messages, assistant responses, and inline tool activity bubbles.
 * The user experiences one coherent conversation where the assistant naturally
 * "checks something" mid-flow rather than seeing a separate panel.
 *
 * Design principles:
 *   - The voice tile is the centerpiece; this panel is the supporting narrative
 *   - Tool bubbles are compact, not attention-stealing
 *   - Clear visual hierarchy: user (right), assistant (left), tools (left, muted)
 *   - Timestamps are subtle, on hover
 *
 * Future: streaming partial results, multimodal cards, reaction affordances
 */

import { useRef, useEffect } from "react";
import { Zap } from "lucide-react";
import { ToolActivityBubble } from "./ToolActivityBubble";
import type { ConversationFlowEntry } from "@/hooks/useConversationFlow";
import type { VoiceRuntimeMode } from "@/lib/voice-runtime";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Tiny thinking / using tools indicator between messages. */
function ThinkingIndicator({ mode }: { mode: VoiceRuntimeMode }) {
  if (mode !== "thinking" && mode !== "tooling") return null;

  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-800/60 border border-zinc-700/30">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-amber-400/70 animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <span className="text-[10px] text-zinc-400">
          {mode === "tooling" ? "Assistant is checking something…" : "Assistant is thinking…"}
        </span>
      </div>
    </div>
  );
}

export function ConversationFlow({
  entries,
  runtimeMode,
}: {
  entries: ConversationFlowEntry[];
  runtimeMode: VoiceRuntimeMode;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, runtimeMode]);

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-sm gap-3">
        <div className="w-12 h-12 rounded-full border border-zinc-700 bg-zinc-800/50 flex items-center justify-center">
          <Zap size={20} className="text-zinc-600" />
        </div>
        <div className="text-center">
          <p className="font-medium text-zinc-400">Start a conversation</p>
          <p className="text-xs text-zinc-600 mt-1">
            Transcript and tool activity will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
      {entries.map((entry) => {
        if (entry.kind === "tool") {
          return (
            <ToolActivityBubble key={entry.id} event={entry.event} />
          );
        }

        // Transcript entry
        const { role, text, timestamp } = entry.entry;
        const isUser = role === "user";

        return (
          <div key={entry.id} className={`flex ${isUser ? "justify-end" : "justify-start"} group`}>
            <div
              className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm transition-colors ${
                isUser
                  ? "bg-zinc-700/40 text-zinc-100 border border-zinc-600/30"
                  : "bg-amber-500/8 text-amber-50 border border-amber-500/15"
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-0.5">
                <span className={`text-[10px] font-medium ${isUser ? "text-zinc-400" : "text-amber-400/70"}`}>
                  {isUser ? "You" : "Assistant"}
                </span>
                <span className="text-[9px] text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity font-mono">
                  {formatTime(timestamp)}
                </span>
              </div>
              <p className="leading-relaxed">{text}</p>
            </div>
          </div>
        );
      })}

      {/* Live thinking/tooling indicator at the bottom of the flow */}
      <ThinkingIndicator mode={runtimeMode} />

      <div ref={bottomRef} />
    </div>
  );
}
