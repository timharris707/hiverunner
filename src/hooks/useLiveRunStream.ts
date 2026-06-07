"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Types ── */

interface StreamEvent {
  type:
    | "command_start"
    | "command_exit"
    | "stdout_chunk"
    | "stderr_chunk"
    | "process_spawned"
    | "process_exit"
    | "runtime_progress"
    | "provider_stream_event"
    | "assistant_delta"
    | "assistant_final"
    | "tool_start"
    | "tool_end"
    | "lifecycle_start"
    | "lifecycle_end"
    | "lifecycle_error"
    | "error"
    | "connected";
  agentId?: string;
  runId?: string;
  canonicalKind?: string;
  provider?: string;
  detail?: string;
  text?: string;
  delta?: string;
  toolName?: string;
  command?: string;
  cwd?: string;
  argv?: string[];
  shell?: string;
  exitCode?: number | null;
  signal?: string | null;
  durationMs?: number;
  chunk?: string;
  byteLength?: number;
  pid?: number;
  phase?: string;
  message?: string;
  progress?: number;
  providerEventType?: string;
  seq?: number;
  ts?: number;
}

export interface AgentStreamState {
  /** Accumulated assistant text from streaming deltas */
  streamingText: string;
  /** Active run ID for the current stream, when known */
  runId?: string;
  /** True while the provider is actively executing this agent's run */
  isActive: boolean;
  /** Whether the agent is actively generating text */
  isStreaming: boolean;
  /** Recent stream events (tool calls, lifecycle, etc.) — last 20 */
  events: StreamTranscriptEntry[];
  /** Last update timestamp */
  lastEventTs: number;
}

export interface StreamTranscriptEntry {
  id: string;
  runId?: string;
  kind:
    | "command_start"
    | "command_exit"
    | "stdout_chunk"
    | "stderr_chunk"
    | "process_spawned"
    | "process_exit"
    | "runtime_progress"
    | "provider_stream_event"
    | "assistant_delta"
    | "assistant_final"
    | "tool_start"
    | "tool_end"
    | "lifecycle_start"
    | "lifecycle_end"
    | "lifecycle_error"
    | "error"
    | "action_detected";
  message: string;
  ts: string;
  toolName?: string;
}

interface UseLiveRunStreamOptions {
  companySlug: string;
  enabled: boolean;
}

interface UseLiveRunStreamResult {
  /** Per-agent streaming state, keyed by agent ID */
  streamByAgentId: Map<string, AgentStreamState>;
  /** Whether the SSE connection is active */
  connected: boolean;
}

const MAX_EVENTS_PER_AGENT = 20;

/* ── mc-action detection ── */

const MC_ACTION_PATTERN = /```mc-action[^\n]*\n([\s\S]*?)```/g;

const ACTION_LABELS: Record<string, string> = {
  create_task: "Creating task",
  hire_agent: "Requesting hire",
  report: "Writing report",
  update_task: "Updating task",
  add_comment: "Adding comment",
};

/**
 * Detect completed mc-action blocks in streaming text.
 * Returns newly detected actions since lastDetectedCount.
 */
function detectMcActions(
  text: string,
  lastDetectedCount: number,
): { actions: Array<{ action: string; summary: string }>; totalCount: number } {
  const actions: Array<{ action: string; summary: string }> = [];
  let match: RegExpExecArray | null;
  let totalCount = 0;

  // Reset lastIndex for global regex
  MC_ACTION_PATTERN.lastIndex = 0;

  while ((match = MC_ACTION_PATTERN.exec(text)) !== null) {
    totalCount++;
    if (totalCount <= lastDetectedCount) continue;

    const jsonStr = match[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      const actionType = parsed.action ?? "unknown";
      const label = ACTION_LABELS[actionType] ?? actionType;

      let summary = label;
      if (actionType === "add_comment" && parsed.taskKey) {
        summary = `${label} on ${parsed.taskKey}`;
      } else if (actionType === "create_task" && parsed.title) {
        summary = `${label}: ${parsed.title.slice(0, 50)}`;
      } else if (actionType === "hire_agent" && parsed.name) {
        summary = `${label}: ${parsed.name}`;
      } else if (actionType === "update_task" && parsed.taskKey) {
        const status = typeof parsed.status === "string" && parsed.status.trim() ? ` → ${parsed.status}` : "";
        const assignee = typeof parsed.assignee === "string" && parsed.assignee.trim() ? ` → ${parsed.assignee}` : "";
        summary = `${label} ${parsed.taskKey}${status || assignee}`;
      } else if (actionType === "report" && parsed.summary) {
        summary = `${label}: ${parsed.summary.slice(0, 50)}`;
      }

      actions.push({ action: actionType, summary });
    } catch {
      actions.push({ action: "unknown", summary: "Action block detected" });
    }
  }

  return { actions, totalCount };
}

type StreamEntryIdFactory = (prefix: string, ts: number) => string;

interface NormalizeLiveRunStreamEventOptions {
  event: StreamEvent;
  current?: AgentStreamState;
  detectedActionCount?: number;
  now?: number;
  idFactory?: StreamEntryIdFactory;
}

interface NormalizedLiveRunStreamEvent {
  agentId: string;
  state: AgentStreamState;
  detectedActionCount: number;
}

function defaultStreamEntryId(prefix: string, ts: number): string {
  return `${prefix}-${ts}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyAgentStreamState(): AgentStreamState {
  return {
    streamingText: "",
    runId: undefined,
    isActive: false,
    isStreaming: false,
    events: [],
    lastEventTs: 0,
  };
}

function compactChunk(value: string | undefined): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function formatExitStatus(exitCode?: number | null, signal?: string | null): string {
  if (typeof exitCode === "number") return `exit ${exitCode}`;
  if (signal) return `signal ${signal}`;
  return "completed";
}

function commandLabel(event: StreamEvent): string {
  return event.command || event.argv?.join(" ") || "command";
}

type RuntimeMessageBuilder = (event: StreamEvent) => string;

const RUNTIME_MESSAGE_BUILDERS: Partial<Record<StreamEvent["type"], RuntimeMessageBuilder>> = {
  command_start: (event) => event.detail ?? `Command started: ${commandLabel(event)}`,
  command_exit: (event) => event.detail ?? `Command ${formatExitStatus(event.exitCode, event.signal)}: ${commandLabel(event)}`,
  stdout_chunk: (event) => {
    const preview = compactChunk(event.chunk ?? event.delta ?? event.text);
    return event.detail ?? (preview ? `stdout: ${preview}` : `stdout: ${event.byteLength ?? 0} bytes`);
  },
  stderr_chunk: (event) => {
    const preview = compactChunk(event.chunk ?? event.delta ?? event.text);
    return event.detail ?? (preview ? `stderr: ${preview}` : `stderr: ${event.byteLength ?? 0} bytes`);
  },
  process_spawned: (event) => {
    const pid = typeof event.pid === "number" ? `pid ${event.pid}` : "process";
    return event.detail ?? `Process spawned: ${pid}`;
  },
  process_exit: (event) => {
    const pid = typeof event.pid === "number" ? `pid ${event.pid} ` : "";
    return event.detail ?? `Process exited: ${pid}${formatExitStatus(event.exitCode, event.signal)}`.trim();
  },
  runtime_progress: (event) => event.detail ?? event.message ?? event.phase ?? "Runtime progress",
  provider_stream_event: (event) => event.detail ?? `Provider event: ${event.providerEventType ?? event.provider ?? "stream"}`,
};

function runtimeEntryMessage(event: StreamEvent): string {
  return RUNTIME_MESSAGE_BUILDERS[event.type]?.(event) ?? event.detail ?? "Runtime event";
}

interface StreamEventApplyContext {
  next: AgentStreamState;
  event: StreamEvent;
  entry: StreamTranscriptEntry;
  ts: number;
}

interface StreamEventApplyResult {
  detectedActionCount?: number;
}

type StreamEventApplier = (context: StreamEventApplyContext) => StreamEventApplyResult | void;

function markActive(next: AgentStreamState, event: StreamEvent, ts: number): void {
  next.runId = event.runId ?? next.runId;
  next.isActive = true;
  next.isStreaming = false;
  next.lastEventTs = ts;
}

function markInactive(next: AgentStreamState, event: StreamEvent, ts: number): void {
  next.runId = event.runId ?? next.runId;
  next.isActive = false;
  next.isStreaming = false;
  next.lastEventTs = ts;
}

function applyAssistantDelta(
  context: Omit<StreamEventApplyContext, "entry">,
  detectedActionCount: number,
  idFactory: StreamEntryIdFactory,
): NormalizedLiveRunStreamEvent {
  const { next, event, ts } = context;
  const agentId = event.agentId ?? "";
  next.streamingText = event.text ?? next.streamingText + (event.delta ?? "");
  next.runId = event.runId ?? next.runId;
  next.isActive = true;
  next.isStreaming = true;
  next.lastEventTs = ts;

  const { actions: newActions, totalCount } = detectMcActions(next.streamingText, detectedActionCount);
  if (newActions.length > 0) {
    next.events = [
      ...next.events,
      ...newActions.map((action) => ({
        id: idFactory("action", ts),
        runId: event.runId,
        kind: "action_detected" as const,
        message: action.summary,
        ts: new Date(ts).toISOString(),
      })),
    ].slice(-MAX_EVENTS_PER_AGENT);
    return { agentId, state: next, detectedActionCount: totalCount };
  }

  return { agentId, state: next, detectedActionCount };
}

const STREAM_EVENT_APPLIERS: Partial<Record<StreamEvent["type"], StreamEventApplier>> = {
  assistant_final: ({ next, event, entry, ts }) => {
    next.streamingText = event.text ?? next.streamingText;
    markActive(next, event, ts);
    entry.message = event.detail ?? "Response complete";
  },
  tool_start: ({ next, event, entry, ts }) => {
    markActive(next, event, ts);
    entry.message = event.detail ?? `Tool: ${event.toolName ?? "unknown"}`;
  },
  tool_end: ({ next, event, entry, ts }) => {
    markActive(next, event, ts);
    entry.message = event.detail ?? `Tool complete: ${event.toolName ?? "unknown"}`;
  },
  lifecycle_start: ({ next, event, entry, ts }) => {
    next.streamingText = "";
    next.runId = event.runId;
    next.isActive = true;
    next.isStreaming = false;
    next.lastEventTs = ts;
    entry.message = event.detail ?? "Session started";
    return { detectedActionCount: 0 };
  },
  lifecycle_end: ({ next, event, entry, ts }) => {
    markInactive(next, event, ts);
    entry.message = event.detail ?? "Session ended";
  },
  lifecycle_error: ({ next, event, entry, ts }) => {
    markInactive(next, event, ts);
    entry.message = event.detail ?? "Session error";
  },
  error: ({ next, event, entry, ts }) => {
    markInactive(next, event, ts);
    entry.message = event.detail ?? "Stream error";
  },
  command_start: ({ next, event, entry, ts }) => {
    markActive(next, event, ts);
    entry.message = runtimeEntryMessage(event);
  },
  command_exit: ({ next, event, entry, ts }) => {
    markActive(next, event, ts);
    entry.message = runtimeEntryMessage(event);
  },
  stdout_chunk: ({ next, event, entry, ts }) => {
    markActive(next, event, ts);
    entry.message = runtimeEntryMessage(event);
  },
  stderr_chunk: ({ next, event, entry, ts }) => {
    markActive(next, event, ts);
    entry.message = runtimeEntryMessage(event);
  },
  process_spawned: ({ next, event, entry, ts }) => {
    markActive(next, event, ts);
    entry.message = runtimeEntryMessage(event);
  },
  process_exit: ({ next, event, entry, ts }) => {
    markInactive(next, event, ts);
    entry.message = runtimeEntryMessage(event);
  },
  runtime_progress: ({ next, event, entry, ts }) => {
    markActive(next, event, ts);
    entry.message = runtimeEntryMessage(event);
  },
  provider_stream_event: ({ next, event, entry, ts }) => {
    markActive(next, event, ts);
    entry.message = runtimeEntryMessage(event);
  },
};

export function normalizeLiveRunStreamEvent({
  event,
  current,
  detectedActionCount = 0,
  now = Date.now(),
  idFactory = defaultStreamEntryId,
}: NormalizeLiveRunStreamEventOptions): NormalizedLiveRunStreamEvent | null {
  if (event.type === "connected") return null;

  const agentId = event.agentId;
  if (!agentId) return null;

  const ts = event.ts ?? now;
  const next: AgentStreamState = {
    ...(current ?? emptyAgentStreamState()),
    events: [...(current?.events ?? [])],
  };

  const entry: StreamTranscriptEntry = {
    id: idFactory("stream", ts),
    runId: event.runId,
    kind: event.type,
    message: "",
    ts: new Date(ts).toISOString(),
    toolName: event.toolName,
  };

  if (event.type === "assistant_delta") {
    return applyAssistantDelta({ next, event, ts }, detectedActionCount, idFactory);
  }

  const applyEvent = STREAM_EVENT_APPLIERS[event.type];
  if (!applyEvent) return null;

  const result = applyEvent({ next, event, entry, ts });

  next.events = [...next.events, entry].slice(-MAX_EVENTS_PER_AGENT);
  return {
    agentId,
    state: next,
    detectedActionCount: result?.detectedActionCount ?? detectedActionCount,
  };
}

/* ── Hook ── */

export function useLiveRunStream({ companySlug, enabled }: UseLiveRunStreamOptions): UseLiveRunStreamResult {
  const [streamByAgentId, setStreamByAgentId] = useState<Map<string, AgentStreamState>>(new Map());
  const [connected, setConnected] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const stateRef = useRef<Map<string, AgentStreamState>>(new Map());
  /** Track how many mc-action blocks we've already detected per agent */
  const detectedActionCountRef = useRef<Map<string, number>>(new Map());

  // Batch updates: collect events and flush at animation frame rate
  const pendingUpdateRef = useRef(false);

  const flushState = useCallback(() => {
    pendingUpdateRef.current = false;
    setStreamByAgentId(new Map(stateRef.current));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!pendingUpdateRef.current) {
      pendingUpdateRef.current = true;
      requestAnimationFrame(flushState);
    }
  }, [flushState]);

  const handleEvent = useCallback((event: StreamEvent) => {
    if (event.type === "connected") {
      setConnected(true);
      return;
    }

    const agentId = event.agentId;
    if (!agentId) return;

    const normalized = normalizeLiveRunStreamEvent({
      event,
      current: stateRef.current.get(agentId),
      detectedActionCount: detectedActionCountRef.current.get(agentId) ?? 0,
    });
    if (!normalized) return;

    stateRef.current.set(normalized.agentId, normalized.state);
    detectedActionCountRef.current.set(normalized.agentId, normalized.detectedActionCount);
    scheduleFlush();
  }, [scheduleFlush]);

  // Clean up stale agent state (no events for 3 minutes → clear)
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [agentId, state] of stateRef.current) {
        if (now - state.lastEventTs > 3 * 60 * 1000) {
          stateRef.current.delete(agentId);
          changed = true;
        }
      }
      if (changed) {
        setStreamByAgentId(new Map(stateRef.current));
      }
    }, 30_000);
    return () => clearInterval(cleanup);
  }, []);

  // SSE connection
  useEffect(() => {
    if (!companySlug || !enabled) {
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;

      const url = `/api/orchestration/engine/live-stream?company=${encodeURIComponent(companySlug)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        if (!disposed) setConnected(true);
      };

      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as StreamEvent;
          handleEvent(event);
        } catch {
          // Ignore malformed
        }
      };

      es.onerror = () => {
        if (disposed) return;
        setConnected(false);
        es.close();
        // Reconnect after 5s
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [companySlug, enabled, handleEvent]);

  return { streamByAgentId, connected: enabled && connected };
}
