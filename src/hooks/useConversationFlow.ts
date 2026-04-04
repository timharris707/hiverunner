"use client";

/**
 * useConversationFlow — merges transcript entries and tool dispatch events
 * into a single chronological conversation flow.
 *
 * Phase 11: the user should see one continuous stream where Henry's words,
 * tool checks, and results all appear inline — not in separate tabs.
 *
 * The flow is sorted by timestamp so tool events appear right where they
 * happened in the conversation. A dispatching event without a matching
 * completed/error event is shown as in-flight.
 *
 * Future: add more entry types (ui.signal cards, session markers, image
 * results, streamed partial tool output) without changing the consumer API.
 */

import { useMemo } from "react";
import type { TranscriptEntry } from "@/hooks/useVoiceSession";
import type { ToolDispatchEvent } from "@/lib/voice-tool-dispatch";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FlowTranscriptEntry {
  kind: "transcript";
  id: string;
  entry: TranscriptEntry;
  timestamp: number;
}

export interface FlowToolEntry {
  kind: "tool";
  id: string;
  /** The most recent event for this intent (dispatching → completed/error). */
  event: ToolDispatchEvent;
  /** Whether this tool is still in-flight. */
  inflight: boolean;
  timestamp: number;
}

export type ConversationFlowEntry = FlowTranscriptEntry | FlowToolEntry;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useConversationFlow(
  transcript: TranscriptEntry[],
  toolEvents: ToolDispatchEvent[]
): ConversationFlowEntry[] {
  return useMemo(() => {
    const entries: ConversationFlowEntry[] = [];

    // 1. Add transcript entries
    transcript.forEach((entry, i) => {
      entries.push({
        kind: "transcript",
        id: `t_${i}_${entry.timestamp}`,
        entry,
        timestamp: entry.timestamp,
      });
    });

    // 2. Merge tool events — group by intentId, pick the latest/most informative event
    const intentMap = new Map<string, {
      dispatching?: ToolDispatchEvent;
      terminal?: ToolDispatchEvent; // completed | error | rejected
    }>();

    for (const evt of toolEvents) {
      const existing = intentMap.get(evt.intentId) ?? {};
      if (evt.type === "dispatching") {
        existing.dispatching = evt;
      } else {
        // completed, error, rejected are all terminal
        existing.terminal = evt;
      }
      intentMap.set(evt.intentId, existing);
    }

    for (const [intentId, group] of intentMap) {
      // If we have a terminal event, show that; otherwise show dispatching
      const event = group.terminal ?? group.dispatching;
      if (!event) continue;

      const inflight = !group.terminal && !!group.dispatching;

      // Timestamp: use the result's executedAt if available, otherwise estimate
      let ts: number;
      if (group.terminal?.result?.executedAt) {
        ts = group.terminal.result.executedAt;
      } else if (group.dispatching) {
        // Place dispatching events near the transcript entries they relate to
        // Use a simple heuristic: find the closest henry transcript entry before this event
        ts = Date.now(); // fallback; will sort to end
        for (let i = transcript.length - 1; i >= 0; i--) {
          if (transcript[i].role === "henry" && transcript[i].timestamp <= Date.now()) {
            ts = transcript[i].timestamp + 1; // just after Henry's message
            break;
          }
        }
      } else {
        ts = Date.now();
      }

      entries.push({
        kind: "tool",
        id: `tool_${intentId}`,
        event,
        inflight,
        timestamp: ts,
      });
    }

    // 3. Sort by timestamp (stable: transcript order preserved for same-ts)
    entries.sort((a, b) => a.timestamp - b.timestamp);

    return entries;
  }, [transcript, toolEvents]);
}
