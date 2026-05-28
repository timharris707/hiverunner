/**
 * Gateway Stream Bridge
 *
 * Maintains a persistent WebSocket connection to the OpenClaw gateway
 * and forwards relevant session events for active heartbeat runs.
 *
 * Architecture:
 *   Gateway (WS at ws://127.0.0.1:18789)
 *     → Bridge (filters by active heartbeat session keys)
 *       → SSE endpoint (delivers to browser)
 *
 * Event correlation:
 *   Gateway events carry `sessionKey` (e.g. "agent:main:heartbeat:abc123").
 *   The bridge periodically queries the DB for active heartbeat runs,
 *   resolves their session keys via openclaw_agent_id + task_key,
 *   and only forwards events whose sessionKey matches an active run.
 */

import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { getOrchestrationDb } from "./db";

/* ── Types ── */

export interface RunStreamEvent {
  /** MC agent UUID */
  agentId: string;
  /** MC heartbeat run UUID */
  runId: string;
  /** MC company UUID */
  companyId: string;
  /** Event category */
  kind: "assistant_delta" | "assistant_final" | "tool_start" | "tool_end" | "lifecycle_start" | "lifecycle_end" | "lifecycle_error" | "error";
  /** Human-readable detail */
  detail: string;
  /** For assistant events: accumulated text so far */
  text?: string;
  /** For assistant events: the new chunk */
  delta?: string;
  /** For tool events: tool name */
  toolName?: string;
  /** Gateway sequence number */
  seq?: number;
  /** Event timestamp (ms) */
  ts: number;
}

type Subscriber = (event: RunStreamEvent) => void;

interface ActiveRunMapping {
  agentId: string;
  runId: string;
  companyId: string;
}

/* ── Constants ── */

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789";
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const ACTIVE_RUN_REFRESH_MS = 5000;
const HEARTBEAT_SESSION_PATTERN = /^agent:([^:]+):heartbeat:(.+)$/;

/** Message sequence counter for the gateway JSON-RPC protocol */
const msgSeq = 0;

/** Read the gateway auth token from the OpenClaw config file */
function resolveGatewayToken(): string | null {
  // 1. Explicit env var
  const envToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (envToken) return envToken;

  // 2. Read from ~/.openclaw/openclaw.json
  try {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const configPath = path.join(homeDir, ".openclaw", "openclaw.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    const token = config?.gateway?.auth?.token;
    if (typeof token === "string" && token.length > 0) return token;
  } catch {
    // Config not found or unreadable
  }

  return null;
}

/* ── Singleton State ── */

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let activeRunRefreshTimer: ReturnType<typeof setInterval> | null = null;
let disposed = false;

/**
 * Map of gateway session key → MC run mapping.
 * Rebuilt every ACTIVE_RUN_REFRESH_MS from the orchestration DB.
 */
const activeSessionKeys = new Map<string, ActiveRunMapping>();

/**
 * Reverse map: openclawAgentId → MC agentId.
 * Populated alongside activeSessionKeys to avoid repeated DB lookups.
 */
const agentIdByOpenclawId = new Map<string, { agentId: string; companyId: string }>();

/** Connected subscribers (SSE endpoints). */
const subscribers = new Set<Subscriber>();

/** Per-session-key dedup: last seen seq to drop duplicates on reconnect. */
const lastSeqBySession = new Map<string, number>();

/** Debug counters */
let totalWsMessages = 0;
let totalMatchedEvents = 0;
let totalEmittedEvents = 0;
let lastEventSample = "";
let firstSessionKeySeen = "";
let agentEventCount = 0;
let noSessionKeyCount = 0;

/* ── Public API ── */

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

export function getActiveRunForSession(sessionKey: string): ActiveRunMapping | undefined {
  return activeSessionKeys.get(sessionKey);
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

/** Diagnostic: return bridge status for debugging */
export function getBridgeStatus() {
  return {
    wsState: ws ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][ws.readyState] ?? "UNKNOWN" : "NULL",
    activeSessionKeys: [...activeSessionKeys.keys()],
    agentIdByOpenclawId: [...agentIdByOpenclawId.entries()].map(([k, v]) => `${k} → ${v.agentId.slice(0, 8)}`),
    subscriberCount: subscribers.size,
    reconnectAttempt,
    disposed,
    totalWsMessages,
    totalMatchedEvents,
    totalEmittedEvents,
    lastEventSample,
    agentEventCount,
    noSessionKeyCount,
    firstSessionKeySeen,
  };
}

/**
 * Initialize the bridge. Call once from server.js on startup.
 * Idempotent — second call is a no-op.
 */
export function initGatewayStreamBridge(): void {
  if (ws || disposed) return;
  console.log("[gateway-bridge] initializing, target:", GATEWAY_URL);
  refreshActiveRuns();
  connectToGateway();
  activeRunRefreshTimer = setInterval(refreshActiveRuns, ACTIVE_RUN_REFRESH_MS);
}

/**
 * Tear down the bridge. Call from server.js on shutdown.
 */
export function destroyGatewayStreamBridge(): void {
  disposed = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (activeRunRefreshTimer) { clearInterval(activeRunRefreshTimer); activeRunRefreshTimer = null; }
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
  activeSessionKeys.clear();
  agentIdByOpenclawId.clear();
  subscribers.clear();
  lastSeqBySession.clear();
}

/* ── Gateway WebSocket Connection ── */

function connectToGateway() {
  if (disposed) return;

  try {
    ws = new WebSocket(GATEWAY_URL);
  } catch (err) {
    console.error("[gateway-bridge] WebSocket constructor failed:", err instanceof Error ? err.message : String(err));
    scheduleReconnect();
    return;
  }

  ws.on("open", () => {
    console.log("[gateway-bridge] WebSocket open, sending connect handshake");
    reconnectAttempt = 0;

    // Send the connect handshake (required by gateway protocol)
    const token = resolveGatewayToken();
    if (!token) {
      console.warn("[gateway-bridge] no gateway token found — connection will likely fail");
    }
    sendToGateway({
      type: "req",
      id: randomUUID(),
      method: "connect",
      params: {
        minProtocol: 1,
        maxProtocol: 10,
        role: "operator",
        scopes: ["operator.read"],
        client: {
          id: "gateway-client",
          displayName: "HiveRunner Stream Bridge",
          mode: "backend",
          platform: "node",
          version: "1.0.0",
        },
        auth: token ? { token } : undefined,
      },
    });
  });

  ws.on("message", (raw) => {
    totalWsMessages++;
    try {
      const data = JSON.parse(String(raw));
      handleGatewayMessage(data);
    } catch {
      // Ignore unparseable messages
    }
  });

  ws.on("close", () => {
    console.log("[gateway-bridge] disconnected from gateway");
    ws = null;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.warn("[gateway-bridge] WebSocket error:", err.message);
    // 'close' event will follow and trigger reconnect
  });
}

function sendToGateway(msg: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) {
    const payload = JSON.stringify(msg);
    ws.send(payload);
  }
}

function scheduleReconnect() {
  if (disposed || reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(1.5, reconnectAttempt), RECONNECT_MAX_MS);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToGateway();
  }, delay);
}

/* ── Message Handling ── */

function handleGatewayMessage(data: Record<string, unknown>) {
  const type = data.type as string | undefined;

  // Response to our requests (connect, etc.)
  if (type === "res") {
    const ok = data.ok as boolean | undefined;
    if (ok) {
      console.log("[gateway-bridge] connected to gateway successfully");
    } else {
      console.warn("[gateway-bridge] request failed:", (data.error as Record<string, unknown>)?.message ?? data.error);
    }
    return;
  }

  // Gateway event format: { type: "event", event: "agent"|"chat"|"tick"|"health", payload: {...} }
  // The actual event data is nested under the `payload` field.
  if (type === "event") {
    const event = data.event as string | undefined;
    const payload = (data.payload ?? data) as Record<string, unknown>;

    if (event === "agent") {
      handleAgentEvent(payload);
    } else if (event === "chat") {
      handleChatEvent(payload);
    } else if (event === "session.tool") {
      handleToolEvent(payload);
    } else if (event === "sessions.changed") {
      handleSessionsChanged(payload);
    }
    // Ignore: health, tick, connect.challenge
    return;
  }

  // Push format (alternative): { type: "push", channel: "agent"|"chat", data: {...} }
  if (type === "push") {
    const channel = data.channel as string | undefined;
    const payload = (data.data ?? {}) as Record<string, unknown>;

    if (channel === "agent") handleAgentEvent(payload);
    else if (channel === "chat") handleChatEvent(payload);
    else if (channel === "session.tool") handleToolEvent(payload);
    else if (channel === "sessions.changed") handleSessionsChanged(payload);
    return;
  }
}

function handleAgentEvent(evt: Record<string, unknown>) {
  agentEventCount++;
  const sessionKey = evt.sessionKey as string | undefined;

  if (!sessionKey) {
    noSessionKeyCount++;
    return;
  }

  if (!firstSessionKeySeen) {
    firstSessionKeySeen = sessionKey;
  }

  const mapping = resolveMapping(sessionKey);
  if (!mapping) return;

  totalMatchedEvents++;

  const stream = evt.stream as string | undefined;
  const evtData = (evt.data ?? {}) as Record<string, unknown>;
  const seq = evt.seq as number | undefined;
  const ts = (evt.ts as number) ?? Date.now();

  // Dedup by seq
  if (seq != null) {
    const lastSeq = lastSeqBySession.get(sessionKey) ?? -1;
    if (seq <= lastSeq) return;
    lastSeqBySession.set(sessionKey, seq);
  }

  if (stream === "assistant" && typeof evtData.text === "string") {
    emit({
      agentId: mapping.agentId,
      runId: mapping.runId,
      companyId: mapping.companyId,
      kind: "assistant_delta",
      detail: typeof evtData.delta === "string" ? evtData.delta : "",
      text: evtData.text as string,
      delta: typeof evtData.delta === "string" ? evtData.delta as string : undefined,
      seq,
      ts,
    });
  } else if (stream === "lifecycle") {
    const phase = evtData.phase as string | undefined;
    if (phase === "start") {
      emit({
        agentId: mapping.agentId,
        runId: mapping.runId,
        companyId: mapping.companyId,
        kind: "lifecycle_start",
        detail: "Agent session started",
        ts,
      });
    } else if (phase === "end") {
      emit({
        agentId: mapping.agentId,
        runId: mapping.runId,
        companyId: mapping.companyId,
        kind: "lifecycle_end",
        detail: evtData.stopReason ? `Session ended: ${evtData.stopReason}` : "Agent session ended",
        ts,
      });
    } else if (phase === "error") {
      emit({
        agentId: mapping.agentId,
        runId: mapping.runId,
        companyId: mapping.companyId,
        kind: "lifecycle_error",
        detail: typeof evtData.error === "string" ? evtData.error : "Session error",
        ts,
      });
    }
  } else if (stream === "error") {
    emit({
      agentId: mapping.agentId,
      runId: mapping.runId,
      companyId: mapping.companyId,
      kind: "error",
      detail: typeof evtData.reason === "string" ? evtData.reason : "Stream error",
      ts,
    });
  }
}

function handleToolEvent(data: Record<string, unknown>) {
  const sessionKey = data.sessionKey as string | undefined;
  if (!sessionKey) return;

  const mapping = resolveMapping(sessionKey);
  if (!mapping) return;

  const evtData = (data.data ?? {}) as Record<string, unknown>;
  const phase = evtData.phase as string | undefined;
  const toolName = evtData.name as string ?? evtData.toolName as string ?? "unknown";
  const ts = (data.ts as number) ?? Date.now();

  if (phase === "start") {
    emit({
      agentId: mapping.agentId,
      runId: mapping.runId,
      companyId: mapping.companyId,
      kind: "tool_start",
      detail: `Tool: ${toolName}`,
      toolName,
      ts,
    });
  } else if (phase === "end" || phase === "result") {
    emit({
      agentId: mapping.agentId,
      runId: mapping.runId,
      companyId: mapping.companyId,
      kind: "tool_end",
      detail: `Tool complete: ${toolName}`,
      toolName,
      ts,
    });
  }
}

function handleSessionsChanged(data: Record<string, unknown>) {
  const sessionKey = data.sessionKey as string | undefined;
  if (!sessionKey) return;

  const mapping = resolveMapping(sessionKey);
  if (!mapping) return;

  const phase = data.phase as string | undefined;
  const ts = (data.ts as number) ?? Date.now();

  if (phase === "start") {
    emit({
      agentId: mapping.agentId,
      runId: mapping.runId,
      companyId: mapping.companyId,
      kind: "lifecycle_start",
      detail: "Agent session started",
      ts,
    });
  } else if (phase === "end") {
    emit({
      agentId: mapping.agentId,
      runId: mapping.runId,
      companyId: mapping.companyId,
      kind: "lifecycle_end",
      detail: "Agent session ended",
      ts,
    });
  } else if (phase === "error") {
    emit({
      agentId: mapping.agentId,
      runId: mapping.runId,
      companyId: mapping.companyId,
      kind: "lifecycle_error",
      detail: "Agent session error",
      ts,
    });
  }
}

function handleChatEvent(data: Record<string, unknown>) {
  const sessionKey = data.sessionKey as string | undefined;
  if (!sessionKey) return;

  const mapping = resolveMapping(sessionKey);
  if (!mapping) return;

  const state = data.state as string | undefined;
  const message = data.message as Record<string, unknown> | undefined;
  const ts = (message?.timestamp as number) ?? Date.now();

  if (state === "delta" && message) {
    const content = message.content as Array<Record<string, unknown>> | undefined;
    const text = content?.[0]?.text as string | undefined;
    if (text) {
      emit({
        agentId: mapping.agentId,
        runId: mapping.runId,
        companyId: mapping.companyId,
        kind: "assistant_delta",
        detail: "",
        text,
        ts,
      });
    }
  } else if (state === "final" && message) {
    const content = message.content as Array<Record<string, unknown>> | undefined;
    const text = content?.[0]?.text as string | undefined;
    emit({
      agentId: mapping.agentId,
      runId: mapping.runId,
      companyId: mapping.companyId,
      kind: "assistant_final",
      detail: text?.slice(0, 200) ?? "Response complete",
      text,
      ts,
    });
  }
}

/* ── Mapping & Filtering ── */

function resolveMapping(sessionKey: string): ActiveRunMapping | undefined {
  // Fast path: check active session key set
  const direct = activeSessionKeys.get(sessionKey);
  if (direct) return direct;

  // If not in active set, check if it's even a heartbeat session
  if (!HEARTBEAT_SESSION_PATTERN.test(sessionKey)) return undefined;

  // Try resolving from agentIdByOpenclawId (may be an active session
  // whose task_key changed or wasn't picked up on last refresh)
  const match = sessionKey.match(HEARTBEAT_SESSION_PATTERN);
  if (!match) return undefined;
  const openclawAgentId = match[1];
  const agentInfo = agentIdByOpenclawId.get(openclawAgentId);
  if (!agentInfo) return undefined;

  // Check if this agent has an active run
  try {
    const db = getOrchestrationDb();
    const run = db.prepare(
      `SELECT id FROM heartbeat_runs WHERE agent_id = ? AND status IN ('running', 'queued') ORDER BY created_at DESC LIMIT 1`
    ).get(agentInfo.agentId) as { id: string } | undefined;
    if (!run) return undefined;

    const mapping: ActiveRunMapping = {
      agentId: agentInfo.agentId,
      runId: run.id,
      companyId: agentInfo.companyId,
    };

    // Cache for this session key
    activeSessionKeys.set(sessionKey, mapping);
    return mapping;
  } catch {
    return undefined;
  }
}

/* ── Active Run Refresh ── */

function refreshActiveRuns() {
  try {
    const db = getOrchestrationDb();

    // Get all active heartbeat runs with their agent's openclaw mapping and task session
    const rows = db.prepare(
      `SELECT
         hr.id AS run_id,
         hr.agent_id,
         a.openclaw_agent_id,
         a.company_id,
         ats.task_key
       FROM heartbeat_runs hr
       JOIN agents a ON a.id = hr.agent_id
       LEFT JOIN agent_task_sessions ats ON ats.agent_id = a.id AND ats.last_run_id = hr.id
       WHERE hr.status IN ('running', 'queued')
         AND a.openclaw_agent_id IS NOT NULL`
    ).all() as Array<{
      run_id: string;
      agent_id: string;
      openclaw_agent_id: string;
      company_id: string;
      task_key: string | null;
    }>;

    // Rebuild maps
    const newKeys = new Map<string, ActiveRunMapping>();
    const newAgentMap = new Map<string, { agentId: string; companyId: string }>();

    for (const row of rows) {
      newAgentMap.set(row.openclaw_agent_id, {
        agentId: row.agent_id,
        companyId: row.company_id,
      });

      if (row.task_key) {
        const sessionKey = `agent:${row.openclaw_agent_id}:heartbeat:${row.task_key}`;
        newKeys.set(sessionKey, {
          agentId: row.agent_id,
          runId: row.run_id,
          companyId: row.company_id,
        });
      }
    }

    // Swap atomically
    activeSessionKeys.clear();
    for (const [k, v] of newKeys) activeSessionKeys.set(k, v);

    agentIdByOpenclawId.clear();
    for (const [k, v] of newAgentMap) agentIdByOpenclawId.set(k, v);

    // Clean up stale dedup entries
    for (const key of lastSeqBySession.keys()) {
      if (!newKeys.has(key)) lastSeqBySession.delete(key);
    }
  } catch (err) {
    // Non-fatal — keep using stale mapping until next refresh
    console.warn("[gateway-bridge] active run refresh failed:", err instanceof Error ? err.message : String(err));
  }
}

/* ── Emit to Subscribers ── */

function emit(event: RunStreamEvent) {
  totalEmittedEvents++;
  lastEventSample = `${event.kind}:${event.detail?.slice(0, 60) ?? ""}`;
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      // Subscriber error should never break the bridge
    }
  }
}
