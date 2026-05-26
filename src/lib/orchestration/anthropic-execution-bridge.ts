/**
 * HiveRunner — Anthropic Execution Bridge
 *
 * Bridges real Claude Code CLI execution into canonical live events for
 * the SSE adapter registry. Orchestration-task executions are recorded by
 * the task execution adapters; factory builds stay in build-queue storage.
 *
 * Design:
 *   - Fail-safe: public functions never throw.
 *   - Provider identity is recorded as "anthropic".
 *   - Live event emission comes from parsing Claude stream-json stdout.
 */

import { randomUUID } from "crypto";

import type { MCLiveEvent } from "./live-events";

const BRIDGE_TAG = "[anthropic-bridge]";
const PROVIDER_ID = "anthropic";

type UsageSnapshot = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

type AnthropicRunState = {
  buildId: string;
  runId: string;
  agentId: string;
  companyId: string;
  seq: number;
  lineBuffer: string;
  lastEventTs: number | null;
  sessionId: string | null;
  model: string | null;
  assistantText: string;
  thinkingText: string;
  usage: UsageSnapshot;
  totalCostUsd: number | null;
  resultText: string | null;
  resultSubtype: string | null;
  resultErrors: string[];
  toolCalls: Map<string, { name: string; startedAtMs: number }>;
  observedLiveText: boolean;
  observedThinking: boolean;
  observedStructuredTools: boolean;
  toolCallNames: string[];
};

type ParsedAnthropicStreamEvent =
  | { kind: "system_init"; sessionId: string | null; model: string | null }
  | { kind: "assistant_text"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool_use";
      toolUseId: string;
      name: string;
      input?: Record<string, unknown>;
    }
  | {
      kind: "tool_result";
      toolUseId: string;
      content: string;
      isError: boolean;
    }
  | {
      kind: "result";
      subtype: string;
      resultText: string;
      isError: boolean;
      errors: string[];
      usage: UsageSnapshot;
      totalCostUsd: number | null;
      sessionId: string | null;
      stopReason: string | null;
    };

export type AnthropicCliTelemetry = {
  source: "claude-code-cli";
  cli: string;
  structuredTelemetry: boolean;
  observedLiveText: boolean;
  observedThinking: boolean;
  observedStructuredTools: boolean;
  sessionId: string | null;
  cliModel: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number | null;
  totalCostCents: number;
  resultText: string | null;
  resultSubtype: string | null;
  resultIsError: boolean;
  resultErrors: string[];
  stopReason: string | null;
  toolCallNames: string[];
  assistantSummary: string;
  thinkingSummary: string;
  toolResultSummary: string;
  streamLineCount: number;
  parsedEventCount: number;
};

interface AnthropicBridgeStatus {
  activeRunCount: number;
  activeBuildIds: string[];
  lastEventTs: number | null;
  totalEmittedEvents: number;
}

type BridgeSubscriber = (event: MCLiveEvent) => void;

const activeRuns = new Map<string, AnthropicRunState>();
const subscribers = new Set<BridgeSubscriber>();

let totalEmittedEvents = 0;
let lastBridgeEventTs: number | null = null;

function getDb() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getOrchestrationDb } = require("@/lib/orchestration/db");
    return getOrchestrationDb();
  } catch (err) {
    console.warn(
      `${BRIDGE_TAG} orchestration DB not available:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function appendBlock(existing: string, text: string): string {
  if (!text) return existing;
  return existing ? `${existing}\n\n${text}` : text;
}

function trimForStorage(text: string, maxChars = 4000): string {
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function extractErrorText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  const message =
    asString(record.message).trim() ||
    asString(record.error).trim() ||
    asString(record.code).trim();
  if (message) return message;
  try {
    return JSON.stringify(record);
  } catch {
    return "";
  }
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  const parts: string[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.join("\n");
}

function parseAnthropicStreamLine(rawLine: string): ParsedAnthropicStreamEvent[] {
  const parsed = asRecord(safeJsonParse(rawLine));
  if (!parsed) return [];

  const type = asString(parsed.type);
  if (type === "system" && asString(parsed.subtype) === "init") {
    return [{
      kind: "system_init",
      sessionId: asString(parsed.session_id) || null,
      model: asString(parsed.model) || null,
    }];
  }

  if (type === "assistant") {
    const message = asRecord(parsed.message) ?? {};
    const content = Array.isArray(message.content) ? message.content : [];
    const events: ParsedAnthropicStreamEvent[] = [];
    for (const rawBlock of content) {
      const block = asRecord(rawBlock);
      if (!block) continue;
      const blockType = asString(block.type);
      if (blockType === "text") {
        const text = asString(block.text).trim();
        if (text) events.push({ kind: "assistant_text", text });
      } else if (blockType === "thinking") {
        const text = asString(block.thinking).trim();
        if (text) events.push({ kind: "thinking", text });
      } else if (blockType === "tool_use") {
        const toolUseId =
          asString(block.id) ||
          asString(block.tool_use_id) ||
          randomUUID();
        events.push({
          kind: "tool_use",
          toolUseId,
          name: asString(block.name, "unknown"),
          input: asRecord(block.input) ?? undefined,
        });
      }
    }
    return events;
  }

  if (type === "user") {
    const message = asRecord(parsed.message) ?? {};
    const content = Array.isArray(message.content) ? message.content : [];
    const events: ParsedAnthropicStreamEvent[] = [];
    for (const rawBlock of content) {
      const block = asRecord(rawBlock);
      if (!block || asString(block.type) !== "tool_result") continue;
      events.push({
        kind: "tool_result",
        toolUseId: asString(block.tool_use_id),
        content: extractTextContent(block.content).trim(),
        isError: block.is_error === true,
      });
    }
    return events;
  }

  if (type === "result") {
    const usage = asRecord(parsed.usage) ?? {};
    return [{
      kind: "result",
      subtype: asString(parsed.subtype),
      resultText: asString(parsed.result).trim(),
      isError: parsed.is_error === true,
      errors: Array.isArray(parsed.errors)
        ? parsed.errors.map(extractErrorText).filter(Boolean)
        : [],
      usage: {
        inputTokens: asNumber(usage.input_tokens, 0),
        outputTokens: asNumber(usage.output_tokens, 0),
        cacheReadInputTokens: asNumber(usage.cache_read_input_tokens, 0),
        cacheCreationInputTokens: asNumber(usage.cache_creation_input_tokens, 0),
      },
      totalCostUsd:
        typeof parsed.total_cost_usd === "number" && Number.isFinite(parsed.total_cost_usd)
          ? parsed.total_cost_usd
          : null,
      sessionId: asString(parsed.session_id) || null,
      stopReason: asString(parsed.stop_reason) || null,
    }];
  }

  return [];
}

function buildUsageJson(state: AnthropicRunState, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    source: "claude-code-cli",
    cli: "claude --print --output-format stream-json --permission-mode bypassPermissions",
    structuredTelemetry: true,
    observedLiveText: state.observedLiveText,
    observedThinking: state.observedThinking,
    observedStructuredTools: state.observedStructuredTools,
    sessionId: state.sessionId,
    cliModel: state.model,
    inputTokens: state.usage.inputTokens,
    outputTokens: state.usage.outputTokens,
    cacheReadInputTokens: state.usage.cacheReadInputTokens,
    cacheCreationInputTokens: state.usage.cacheCreationInputTokens,
    totalCostUsd: state.totalCostUsd,
    resultText: state.resultText,
    resultSubtype: state.resultSubtype,
    resultErrors: state.resultErrors,
    toolCallNames: state.toolCallNames,
    assistantSummary: trimForStorage(state.assistantText, 5000),
    thinkingSummary: trimForStorage(state.thinkingText, 5000),
    ...extra,
  };
}

function emit(event: MCLiveEvent): void {
  totalEmittedEvents += 1;
  lastBridgeEventTs = event.ts;
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      // Subscriber failures never break the bridge.
    }
  }
}

function emitCanonicalEvent(
  state: AnthropicRunState,
  kind: MCLiveEvent["kind"],
  summary: string,
  payload: MCLiveEvent["payload"],
  providerMeta?: Record<string, unknown>,
): void {
  const ts = Date.now();
  state.seq += 1;
  state.lastEventTs = ts;
  emit({
    id: randomUUID(),
    agentId: state.agentId,
    runId: state.runId,
    companyId: state.companyId,
    kind,
    summary,
    ts,
    seq: state.seq,
    provider: PROVIDER_ID,
    payload,
    providerMeta,
  });
}

function resolveAgentIdentity(
  db: ReturnType<typeof getDb>,
  agentName: string | null | undefined,
): { agentId: string | null; companyId: string | null } {
  if (!db || !agentName) return { agentId: null, companyId: null };
  try {
    const row = db
      .prepare(
        `SELECT id, company_id
         FROM agents
         WHERE lower(name) = lower(?) OR lower(slug) = lower(?)
         LIMIT 1`,
      )
      .get(agentName, agentName) as { id: string; company_id: string } | undefined;
    return {
      agentId: row?.id ?? null,
      companyId: row?.company_id ?? null,
    };
  } catch {
    return { agentId: null, companyId: null };
  }
}

function getRunTokenUsage(
  db: ReturnType<typeof getDb>,
  buildId: string,
): { runId: string; tokenUsage: Record<string, unknown> } | null {
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `SELECT id, token_usage_json
         FROM execution_runs
         WHERE idempotency_key = ? AND provider = 'anthropic'
         LIMIT 1`,
      )
      .get(buildId) as { id: string; token_usage_json: string | null } | undefined;
    if (!row) return null;
    const tokenUsage = asRecord(safeJsonParse(row.token_usage_json ?? "{}")) ?? {};
    return { runId: row.id, tokenUsage };
  } catch {
    return null;
  }
}

function updateRunUsage(
  db: ReturnType<typeof getDb>,
  buildId: string,
  patch: Record<string, unknown>,
  sessionId?: string | null,
): void {
  const existing = getRunTokenUsage(db, buildId);
  if (!existing || !db) return;
  const merged = { ...existing.tokenUsage, ...patch };
  db.prepare(
    `UPDATE execution_runs
     SET token_usage_json = ?,
         session_id = COALESCE(?, session_id),
         updated_at = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify(merged),
    sessionId ?? null,
    new Date().toISOString(),
    existing.runId,
  );
}

function flushBufferedLines(
  state: AnthropicRunState,
  chunk: string,
  flushRemainder = false,
): void {
  state.lineBuffer += chunk;

  while (true) {
    const newlineIndex = state.lineBuffer.indexOf("\n");
    if (newlineIndex === -1) break;
    const line = state.lineBuffer.slice(0, newlineIndex).trim();
    state.lineBuffer = state.lineBuffer.slice(newlineIndex + 1);
    if (line) processStreamLine(state, line);
  }

  if (flushRemainder) {
    const remainder = state.lineBuffer.trim();
    state.lineBuffer = "";
    if (remainder) processStreamLine(state, remainder);
  }
}

function processStreamLine(state: AnthropicRunState, line: string): void {
  const db = getDb();
  for (const event of parseAnthropicStreamLine(line)) {
    if (event.kind === "system_init") {
      state.sessionId = event.sessionId;
      state.model = event.model ?? state.model;
      updateRunUsage(
        db,
        state.buildId,
        buildUsageJson(state),
        state.sessionId,
      );
      continue;
    }

    if (event.kind === "assistant_text") {
      state.observedLiveText = true;
      state.assistantText = appendBlock(state.assistantText, event.text);
      emitCanonicalEvent(
        state,
        "assistant_text_delta",
        event.text,
        {
          delta: event.text,
          accumulatedText: state.assistantText,
        },
      );
      continue;
    }

    if (event.kind === "thinking") {
      state.observedThinking = true;
      state.thinkingText = appendBlock(state.thinkingText, event.text);
      emitCanonicalEvent(
        state,
        "thinking_delta",
        event.text,
        { delta: event.text },
      );
      continue;
    }

    if (event.kind === "tool_use") {
      state.observedStructuredTools = true;
      state.toolCalls.set(event.toolUseId, {
        name: event.name,
        startedAtMs: Date.now(),
      });
      if (!state.toolCallNames.includes(event.name)) {
        state.toolCallNames.push(event.name);
      }
      emitCanonicalEvent(
        state,
        "tool_call_start",
        `Tool call: ${event.name}`,
        {
          toolCallId: event.toolUseId,
          toolName: event.name,
          input: event.input,
        },
      );
      continue;
    }

    if (event.kind === "tool_result") {
      state.observedStructuredTools = true;
      const toolCall = state.toolCalls.get(event.toolUseId);
      const toolName = toolCall?.name ?? "unknown";
      emitCanonicalEvent(
        state,
        "tool_result",
        `${toolName} result`,
        {
          toolCallId: event.toolUseId,
          toolName,
          output: event.content || undefined,
          isError: event.isError,
          errorMessage: event.isError ? event.content || "Claude tool returned an error" : undefined,
        },
      );
      emitCanonicalEvent(
        state,
        "tool_call_end",
        `Tool finished: ${toolName}`,
        {
          toolCallId: event.toolUseId,
          toolName,
          durationMs: toolCall ? Date.now() - toolCall.startedAtMs : undefined,
          success: !event.isError,
        },
      );
      state.toolCalls.delete(event.toolUseId);
      continue;
    }

    if (event.kind === "result") {
      state.sessionId = event.sessionId ?? state.sessionId;
      state.usage = event.usage;
      state.totalCostUsd = event.totalCostUsd;
      state.resultText = event.resultText || state.resultText;
      state.resultSubtype = event.subtype || state.resultSubtype;
      state.resultErrors = event.errors;
      updateRunUsage(
        db,
        state.buildId,
        buildUsageJson(state, {
          stopReason: event.stopReason,
        }),
        state.sessionId,
      );
    }
  }
}

function createInitialState(params: {
  buildId: string;
  runId: string;
  agentId: string | null;
  companyId: string | null;
}): AnthropicRunState {
  return {
    buildId: params.buildId,
    runId: params.runId,
    agentId: params.agentId ?? "",
    companyId: params.companyId ?? "",
    seq: 0,
    lineBuffer: "",
    lastEventTs: null,
    sessionId: null,
    model: null,
    assistantText: "",
    thinkingText: "",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    totalCostUsd: null,
    resultText: null,
    resultSubtype: null,
    resultErrors: [],
    toolCalls: new Map(),
    observedLiveText: false,
    observedThinking: false,
    observedStructuredTools: false,
    toolCallNames: [],
  };
}

export function subscribeAnthropicBridgeEvents(fn: BridgeSubscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function getAnthropicBridgeStatus(): AnthropicBridgeStatus {
  return {
    activeRunCount: activeRuns.size,
    activeBuildIds: Array.from(activeRuns.keys()),
    lastEventTs: lastBridgeEventTs,
    totalEmittedEvents,
  };
}

export function isAnthropicStreamJsonOutput(stdout: string): boolean {
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = asRecord(safeJsonParse(line));
    if (!parsed) return false;
    const type = asString(parsed.type);
    return type === "system" || type === "assistant" || type === "user" || type === "result";
  }
  return false;
}

export function summarizeAnthropicCliOutput(
  stdout: string,
  stderr: string,
  fallback?: string,
): string | null {
  if (!isAnthropicStreamJsonOutput(stdout)) {
    return null;
  }

  const assistantParts: string[] = [];
  let resultText = "";
  let subtype = "";
  let errors: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const event of parseAnthropicStreamLine(line)) {
      if (event.kind === "assistant_text") {
        assistantParts.push(event.text);
      } else if (event.kind === "result") {
        resultText = event.resultText || resultText;
        subtype = event.subtype || subtype;
        errors = event.errors.length > 0 ? event.errors : errors;
      }
    }
  }

  const sections: string[] = [];
  if (resultText) sections.push(resultText);
  if (!resultText && assistantParts.length > 0) sections.push(assistantParts.join("\n\n"));
  if (errors.length > 0) sections.push(`Errors: ${errors.join(" | ")}`);
  if (subtype && subtype !== "success") sections.push(`Result subtype: ${subtype}`);
  if (!resultText && !assistantParts.length && stderr.trim()) sections.push(stderr.trim());
  if (sections.length === 0 && fallback) sections.push(fallback);

  return sections.length > 0 ? sections.join("\n\n").trim() : null;
}

export function collectAnthropicCliTelemetry(
  stdout: string,
  stderr: string,
  options: { cli?: string } = {},
): AnthropicCliTelemetry {
  let sessionId: string | null = null;
  let cliModel: string | null = null;
  let assistantText = "";
  let thinkingText = "";
  let toolResultText = "";
  let usage: UsageSnapshot = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
  let totalCostUsd: number | null = null;
  let resultText: string | null = null;
  let resultSubtype: string | null = null;
  let resultIsError = false;
  let resultErrors: string[] = [];
  let stopReason: string | null = null;
  let observedLiveText = false;
  let observedThinking = false;
  let observedStructuredTools = false;
  const toolCallNames: string[] = [];
  let streamLineCount = 0;
  let parsedEventCount = 0;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    streamLineCount += 1;
    const events = parseAnthropicStreamLine(line);
    parsedEventCount += events.length;

    for (const event of events) {
      if (event.kind === "system_init") {
        sessionId = event.sessionId ?? sessionId;
        cliModel = event.model ?? cliModel;
      } else if (event.kind === "assistant_text") {
        observedLiveText = true;
        assistantText = appendBlock(assistantText, event.text);
      } else if (event.kind === "thinking") {
        observedThinking = true;
        thinkingText = appendBlock(thinkingText, event.text);
      } else if (event.kind === "tool_use") {
        observedStructuredTools = true;
        if (!toolCallNames.includes(event.name)) {
          toolCallNames.push(event.name);
        }
      } else if (event.kind === "tool_result") {
        observedStructuredTools = true;
        if (event.content) {
          toolResultText = appendBlock(toolResultText, event.content);
        }
      } else if (event.kind === "result") {
        sessionId = event.sessionId ?? sessionId;
        usage = event.usage;
        totalCostUsd = event.totalCostUsd;
        resultText = event.resultText || resultText;
        resultSubtype = event.subtype || resultSubtype;
        resultIsError = event.isError;
        resultErrors = event.errors.length > 0 ? event.errors : resultErrors;
        stopReason = event.stopReason;
      }
    }
  }

  const totalInputTokens =
    usage.inputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens;
  const totalCostCents =
    typeof totalCostUsd === "number" && Number.isFinite(totalCostUsd)
      ? Math.round(totalCostUsd * 100)
      : 0;

  return {
    source: "claude-code-cli",
    cli: options.cli ?? "claude --print --output-format stream-json --permission-mode bypassPermissions",
    structuredTelemetry: parsedEventCount > 0,
    observedLiveText,
    observedThinking,
    observedStructuredTools,
    sessionId,
    cliModel,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    totalInputTokens,
    totalOutputTokens: usage.outputTokens,
    totalCostUsd,
    totalCostCents,
    resultText,
    resultSubtype,
    resultIsError,
    resultErrors,
    stopReason,
    toolCallNames,
    assistantSummary: trimForStorage(assistantText, 5000),
    thinkingSummary: trimForStorage(thinkingText, 5000),
    toolResultSummary: trimForStorage(toolResultText || stderr.trim(), 3000),
    streamLineCount,
    parsedEventCount,
  };
}

export function bridgeAnthropicRunStarted(params: {
  buildId: string;
  factoryTaskId: string;
  factoryTaskTitle?: string;
  assignedAgent: string | null;
  startedAt: string;
  modelId?: string;
  modelName?: string;
}): void {
  try {
    const db = getDb();
    if (!db) return;

    const identity = resolveAgentIdentity(db, params.assignedAgent);
    const runId = randomUUID();
    const state = createInitialState({
      buildId: params.buildId,
      runId,
      agentId: identity.agentId,
      companyId: identity.companyId,
    });

    activeRuns.set(params.buildId, state);
    emitCanonicalEvent(
      state,
      "run_start",
      `Claude Code run started${params.modelName ? ` (${params.modelName})` : ""}`,
      { invocationSource: "anthropic-cli" },
    );

    console.log(
      `${BRIDGE_TAG} factory build started outside orchestration task scope: run=${runId}, build=${params.buildId}, factoryTask=${params.factoryTaskId}, agent=${params.assignedAgent ?? "unassigned"}`,
    );
  } catch (err) {
    console.error(
      `${BRIDGE_TAG} failed to bridge started build ${params.buildId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function bridgeAnthropicStdoutChunk(params: {
  buildId: string;
  chunk: string;
}): void {
  try {
    const state = activeRuns.get(params.buildId);
    if (!state || !params.chunk) return;
    flushBufferedLines(state, params.chunk, false);
  } catch (err) {
    console.error(
      `${BRIDGE_TAG} failed to process stdout chunk for build ${params.buildId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function bridgeAnthropicRunCompleted(params: {
  buildId: string;
  completedAt: string;
  durationMs: number;
}): void {
  try {
    const db = getDb();
    if (!db) return;

    const state = activeRuns.get(params.buildId);
    if (state) {
      flushBufferedLines(state, "", true);
    }

    const result = db
      .prepare(
        `UPDATE execution_runs
         SET status = 'completed',
             completed_at = ?,
             duration_ms = ?,
             token_usage_json = ?,
             session_id = COALESCE(?, session_id),
             updated_at = ?
         WHERE idempotency_key = ? AND provider = 'anthropic'`,
      )
      .run(
        params.completedAt,
        Math.trunc(params.durationMs),
        JSON.stringify(
          state
            ? buildUsageJson(state)
            : {
                source: "claude-code-cli",
                cli: "claude --print --output-format stream-json --permission-mode bypassPermissions",
                structuredTelemetry: false,
              },
        ),
        state?.sessionId ?? null,
        new Date().toISOString(),
        params.buildId,
      );

    if (result.changes > 0 && state) {
      emitCanonicalEvent(
        state,
        "run_end",
        state.resultText || "Claude Code run completed",
        {
          durationMs: Math.trunc(params.durationMs),
          tokenUsage: {
            input: state.usage.inputTokens + state.usage.cacheReadInputTokens + state.usage.cacheCreationInputTokens,
            output: state.usage.outputTokens,
          },
          result: state.resultErrors.length > 0 ? "partial" : "success",
        },
        {
          totalCostUsd: state.totalCostUsd,
          resultSubtype: state.resultSubtype,
        },
      );
    }

    activeRuns.delete(params.buildId);

    if (result.changes > 0) {
      console.log(
        `${BRIDGE_TAG} run completed: build=${params.buildId} (${Math.round(params.durationMs / 1000)}s)`,
      );
    } else {
      console.warn(`${BRIDGE_TAG} no run found to complete for build=${params.buildId}`);
    }
  } catch (err) {
    console.error(
      `${BRIDGE_TAG} failed to complete run for build ${params.buildId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function bridgeAnthropicRunFailed(params: {
  buildId: string;
  factoryTaskId: string;
  assignedAgent: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error: string;
}): void {
  try {
    const db = getDb();
    if (!db) return;

    const state = activeRuns.get(params.buildId);
    if (state) {
      flushBufferedLines(state, "", true);
    }

    const tokenUsageJson = JSON.stringify(
      state
        ? buildUsageJson(state, {
            failure: params.error.slice(0, 2000),
          })
        : {
            source: "claude-code-cli",
            cli: "claude --print --output-format stream-json --permission-mode bypassPermissions",
            structuredTelemetry: false,
            failure: params.error.slice(0, 2000),
          },
    );

    const result = db
      .prepare(
        `UPDATE execution_runs
         SET status = 'failed',
             completed_at = ?,
             duration_ms = ?,
             error_message = ?,
             token_usage_json = ?,
             session_id = COALESCE(?, session_id),
             updated_at = ?
         WHERE idempotency_key = ? AND provider = 'anthropic'`,
      )
      .run(
        params.completedAt,
        Math.trunc(params.durationMs),
        params.error.slice(0, 2000),
        tokenUsageJson,
        state?.sessionId ?? null,
        new Date().toISOString(),
        params.buildId,
      );

    if (state) {
      emitCanonicalEvent(
        state,
        "run_error",
        params.error.slice(0, 300),
        {
          errorMessage: params.error.slice(0, 2000),
          recoverable: false,
        },
      );
      activeRuns.delete(params.buildId);
    }

    console.log(
      `${BRIDGE_TAG} factory build failed outside orchestration task scope: build=${params.buildId}, factoryTask=${params.factoryTaskId}, executionRunUpdated=${result.changes > 0}`,
    );
  } catch (err) {
    console.error(
      `${BRIDGE_TAG} failed to record failure for build ${params.buildId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
