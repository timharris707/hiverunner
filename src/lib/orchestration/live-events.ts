/**
 * HiveRunner — Canonical Live Event Schema
 *
 * Provider-agnostic event model for live agent observability.
 * All provider adapters produce MCLiveEvent objects; the rendering
 * pipeline consumes them without knowing the originating provider.
 *
 * Design doc: LIVE_OBSERVABILITY_DESIGN.md
 */

/* ── Event Kinds ── */

export type MCLiveEventKind =
  // Lifecycle
  | "run_start"
  | "run_end"
  | "run_error"
  | "run_progress"        // engine milestone: agent is processing (no text emitted yet)
  // Assistant output
  | "assistant_text_delta"
  | "assistant_text_final"
  // Reasoning (when available)
  | "thinking_delta"
  | "thinking_summary"
  // Tool execution
  | "tool_call_start"
  | "tool_call_end"
  | "tool_result"
  // Agent-level actions (detected or structured)
  | "action_detected"
  // Collaboration artifacts
  | "comment_written"
  | "task_updated"
  | "report_written"
  // System
  | "error"
  | "heartbeat";

/* ── Kind-Specific Payloads ── */

export interface AssistantTextDeltaPayload {
  delta: string;
  accumulatedText: string;
}

export interface AssistantTextFinalPayload {
  text: string;
  tokenCount?: number;
}

export interface ThinkingDeltaPayload {
  delta: string;
}

export interface ThinkingSummaryPayload {
  summary: string;
}

export interface ToolCallStartPayload {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
}

export interface ToolCallEndPayload {
  toolCallId: string;
  toolName: string;
  durationMs?: number;
  success: boolean;
}

export interface ToolResultPayload {
  toolCallId: string;
  toolName: string;
  output?: unknown;
  isError: boolean;
  errorMessage?: string;
}

export interface ActionDetectedPayload {
  actionType: string;
  actionDetail: Record<string, unknown>;
  source: "structured" | "text_detected";
}

export interface CommentWrittenPayload {
  taskKey?: string;
  body: string;
  commentType?: string;
}

export interface TaskUpdatedPayload {
  taskKey: string;
  field: string;
  oldValue?: string;
  newValue: string;
}

export interface ReportWrittenPayload {
  reportType?: string;
  summary: string;
}

export interface RunStartPayload {
  invocationSource?: string;
}

export interface RunEndPayload {
  durationMs?: number;
  tokenUsage?: { input: number; output: number };
  result?: "success" | "partial" | "error";
}

export interface RunErrorPayload {
  errorCode?: string;
  errorMessage: string;
  recoverable: boolean;
}

export interface ErrorPayload {
  errorCode?: string;
  errorMessage: string;
}

export interface HeartbeatPayload {
  connectedSince: number;
}

/* ── Payload Union ── */

export type MCLiveEventPayload =
  | AssistantTextDeltaPayload
  | AssistantTextFinalPayload
  | ThinkingDeltaPayload
  | ThinkingSummaryPayload
  | ToolCallStartPayload
  | ToolCallEndPayload
  | ToolResultPayload
  | ActionDetectedPayload
  | CommentWrittenPayload
  | TaskUpdatedPayload
  | ReportWrittenPayload
  | RunStartPayload
  | RunEndPayload
  | RunErrorPayload
  | ErrorPayload
  | HeartbeatPayload;

/* ── Core Event ── */

export interface MCLiveEvent {
  /** Globally unique event ID */
  id: string;
  /** MC agent UUID (resolved by adapter) */
  agentId: string;
  /** MC run/execution UUID (resolved by adapter) */
  runId: string;
  /** MC company UUID */
  companyId: string;
  /** Canonical event kind */
  kind: MCLiveEventKind;
  /** Human-readable summary (for transcript rendering) */
  summary: string;
  /** Event timestamp (ms since epoch) */
  ts: number;
  /** Monotonic sequence for ordering/dedup */
  seq?: number;
  /** Provider identifier */
  provider: string;
  /** Kind-specific payload */
  payload: MCLiveEventPayload;
  /** Provider-specific extension data (opaque to core renderer) */
  providerMeta?: Record<string, unknown>;
}

/* ── SSE Wire Format ──
 *
 * The SSE endpoint maps MCLiveEvent to a backward-compatible wire format
 * that the browser hook (useLiveRunStream) already understands.
 *
 * This mapping is intentionally kept in the SSE route, not here,
 * so the canonical model stays clean.
 */

/**
 * Maps MCLiveEventKind → the short kind strings the browser SSE hook expects.
 * Used by the live-stream SSE route to preserve backward compatibility.
 */
export const CANONICAL_TO_WIRE_KIND: Record<MCLiveEventKind, string> = {
  run_start: "lifecycle_start",
  run_end: "lifecycle_end",
  run_error: "lifecycle_error",
  run_progress: "lifecycle_start",     // degrade: show as lifecycle
  assistant_text_delta: "assistant_delta",
  assistant_text_final: "assistant_final",
  thinking_delta: "assistant_delta",     // degrade: render as text
  thinking_summary: "assistant_final",   // degrade: render as text
  tool_call_start: "tool_start",
  tool_call_end: "tool_end",
  tool_result: "tool_end",              // degrade: fold into tool_end
  action_detected: "tool_start",         // degrade: render as tool event
  comment_written: "lifecycle_end",      // degrade: show as lifecycle
  task_updated: "lifecycle_end",         // degrade: show as lifecycle
  report_written: "lifecycle_end",       // degrade: show as lifecycle
  error: "error",
  heartbeat: "lifecycle_start",          // degrade: show as lifecycle
};

/**
 * Extract fields from MCLiveEvent that map to the legacy SSE wire shape.
 * Returns a plain object matching the current StreamEvent interface in the browser.
 */
export function toLegacyWireEvent(event: MCLiveEvent): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    type: CANONICAL_TO_WIRE_KIND[event.kind],
    agentId: event.agentId,
    runId: event.runId,
    detail: event.summary,
    seq: event.seq,
    ts: event.ts,
  };

  // Attach kind-specific fields the browser hook reads
  const p = event.payload as Record<string, unknown>;
  if ("delta" in p) wire.delta = p.delta;
  if ("accumulatedText" in p) wire.text = p.accumulatedText;
  if ("text" in p && !("accumulatedText" in p)) wire.text = p.text;
  if ("toolName" in p) wire.toolName = p.toolName;

  return wire;
}
