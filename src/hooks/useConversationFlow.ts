"use client";

/**
 * useConversationFlow — merges transcript entries and tool dispatch events
 * into a single chronological conversation flow.
 *
 * Phase 11: the user should see one continuous stream where the voice assistant's words,
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

function getTranscriptFallbackTimestamp(transcript: TranscriptEntry[]): number {
  const lastTranscriptTimestamp = transcript.at(-1)?.timestamp ?? 0;
  const lastAssistantTimestamp = [...transcript].reverse().find((entry) => entry.role === "assistant")?.timestamp;

  if (typeof lastAssistantTimestamp === "number") {
    return lastAssistantTimestamp + 1;
  }

  return transcript.length > 0 ? lastTranscriptTimestamp + 1 : 0;
}

export function buildConversationFlowEntries(
  transcript: TranscriptEntry[],
  toolEvents: ToolDispatchEvent[]
): ConversationFlowEntry[] {
  const entries: ConversationFlowEntry[] = [];

  transcript.forEach((entry, i) => {
    entries.push({
      kind: "transcript",
      id: `t_${i}_${entry.timestamp}`,
      entry,
      timestamp: entry.timestamp,
    });
  });

  const intentMap = new Map<
    string,
    {
      dispatching?: ToolDispatchEvent;
      terminal?: ToolDispatchEvent;
    }
  >();

  for (const evt of toolEvents) {
    const existing = intentMap.get(evt.intentId) ?? {};
    if (evt.type === "dispatching") {
      existing.dispatching = evt;
    } else {
      existing.terminal = evt;
    }
    intentMap.set(evt.intentId, existing);
  }

  const transcriptFallbackTimestamp = getTranscriptFallbackTimestamp(transcript);

  for (const [intentId, group] of intentMap) {
    const event = group.terminal ?? group.dispatching;
    if (!event) continue;

    const inflight = !group.terminal && !!group.dispatching;
    const timestamp = group.terminal?.result?.executedAt ?? transcriptFallbackTimestamp;

    entries.push({
      kind: "tool",
      id: `tool_${intentId}`,
      event,
      inflight,
      timestamp,
    });
  }

  entries.sort((a, b) => a.timestamp - b.timestamp);

  return entries;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useConversationFlow(
  transcript: TranscriptEntry[],
  toolEvents: ToolDispatchEvent[]
): ConversationFlowEntry[] {
  return useMemo(() => buildConversationFlowEntries(transcript, toolEvents), [transcript, toolEvents]);
}
