/**
 * voice-tool-dispatch.ts — Client-side tool dispatch for the voice runtime.
 *
 * Phase 10: The structured action-intent seam (Phase 9) parsed `tool.request`
 * intents from Gemini's output. This module provides the dispatch path:
 *   1. Validate the tool name against a client-known allowlist
 *   2. POST to /api/voice/tool-dispatch with the request
 *   3. Return structured results for the runtime to consume
 *
 * Security model: model suggests, runtime decides.
 * The server re-validates the allowlist independently — client validation
 * is only for fast-fail UX, not trust boundary.
 */

import type { ResolvedVoiceBinding } from "@/lib/voice-binding";
import {
  VOICE_TOOL_NAMES,
  type VoiceToolName,
} from "@/lib/voice-tool-manifest";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToolName = VoiceToolName;

export interface ToolRequest {
  /** Tool name from the action intent payload */
  tool: ToolName;
  /** Arbitrary params the model suggested */
  params?: Record<string, unknown>;
  /** Bound HiveRunner context from the active voice session */
  binding?: ResolvedVoiceBinding;
  /** Voice session id for dedupe / provenance */
  sessionId?: string;
  /** Intent id for dedupe / provenance */
  intentId?: string;
}

export interface ToolResult {
  tool: ToolName;
  status: "success" | "error" | "rejected";
  output: unknown;
  durationMs: number;
  executedAt: number;
}

export interface ToolDispatchEvent {
  type: "dispatching" | "completed" | "error" | "rejected";
  intentId: string;
  tool: ToolName;
  result?: ToolResult;
  error?: string;
}

// ─── Allowlist (client-side, for fast-fail only) ─────────────────────────────

const CLIENT_ALLOWED_TOOLS: ReadonlySet<string> = new Set<ToolName>(VOICE_TOOL_NAMES);

export function isAllowedTool(name: string): name is ToolName {
  return CLIENT_ALLOWED_TOOLS.has(name);
}

export function getAllowedTools(): ToolName[] {
  return [...CLIENT_ALLOWED_TOOLS] as ToolName[];
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Dispatch a tool request to the server.
 * Returns a ToolResult on success, throws on network/server error.
 */
export async function dispatchTool(
  request: ToolRequest,
  signal?: AbortSignal
): Promise<ToolResult> {
  const res = await fetch("/api/voice/tool-dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  const body = await res.json().catch(() => ({ error: "Unknown server error" }));
  if (!res.ok) {
    if (
      body &&
      typeof body === "object" &&
      typeof body.tool === "string" &&
      typeof body.status === "string" &&
      typeof body.durationMs === "number" &&
      typeof body.executedAt === "number"
    ) {
      return body as ToolResult;
    }
    throw new Error((body as { error?: string }).error || `Tool dispatch failed: ${res.status}`);
  }

  return body as ToolResult;
}

/**
 * Extract a ToolRequest from an action intent payload, if valid.
 * Returns null if the intent doesn't contain a valid tool request.
 */
export function extractToolRequest(
  payload: Record<string, unknown>
): ToolRequest | null {
  const tool = payload.tool ?? payload.name ?? payload.action;
  if (typeof tool !== "string") return null;
  if (!isAllowedTool(tool)) return null;

  const params =
    typeof payload.params === "object" && payload.params
      ? (payload.params as Record<string, unknown>)
      : typeof payload.args === "object" && payload.args
        ? (payload.args as Record<string, unknown>)
        : undefined;

  return { tool, params };
}
