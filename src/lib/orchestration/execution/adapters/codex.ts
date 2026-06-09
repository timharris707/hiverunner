/**
 * HiveRunner - Codex Execution Adapter
 *
 * Runs Codex as a local CLI provider for heartbeat Tasks.
 * This path uses `codex exec --json` when available, records normalized
 * transcript evidence, and emits provider activity into the live run timeline.
 */

import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type Database from "better-sqlite3";

import {
  ensureAgentSourceWorkspaceLink,
  ensureCompanySourceWorkspaceLink,
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { sanitizeAgentCommentLinks } from "@/lib/orchestration/comment-link-verification";
import { listRuntimeAgentSkills } from "@/lib/orchestration/company-skills";
import { readProjectSourceWorkspaceRoot } from "@/lib/orchestration/service/shared";

import { cleanupRunArtifacts } from "../cleanup";
import { DEFAULT_CODEX_TIMEOUT_MS } from "@/lib/orchestration/execution-timeouts";

import type {
  CancelAdapterResult,
  ExecutionAdapter,
  ExecutionInput,
  ExecutionLiveEventEmitter,
  ExecutionLiveEventInput,
  ExecutionResult,
  ExecutionSelfHealInput,
} from "./types";
import {
  buildWorkspaceRunVisibility,
  captureWorkspaceGitSnapshots,
  detectReadOnlyIntent,
} from "../workspace-run-visibility";
import { createAdapterLiveChunkEmitter } from "./live-event-utils";
import { buildExternalRunnerEnv } from "./child-env";

type CodexRuntimeRow = {
  command: string | null;
  display_name: string;
  runtime_slug: string;
  scope: string;
  workspace_root: string | null;
  metadata_json: string;
};

type AgentModelRow = {
  model: string | null;
};

type CodexRuntimeControls = {
  model: string;
  reasoningEffort: string;
  speedPreference: string | null;
  fastMode: boolean | null;
  serviceTier: string | null;
  serviceTierApplied: boolean;
};

type WorkspaceRow = {
  company_id: string;
  company_code: string | null;
  company_workspace_slug: string | null;
  company_workspace_root: string | null;
  company_workspace_source: string | null;
  project_settings_json: string | null;
};

type CodexExecResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  errorMessage: string | null;
  durationMs: number;
  jsonTelemetry: CodexJsonTelemetry;
  diagnostics: CodexRunDiagnostics;
};

type CodexRunDiagnostics = {
  promptChars: number;
  timeoutMs: number;
  maxBufferBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  outputLastMessageBytes: number;
  stdinClosedAtMs: number | null;
  firstStdoutAtMs: number | null;
  lastStdoutAtMs: number | null;
  firstStderrAtMs: number | null;
  lastStderrAtMs: number | null;
  timedOut: boolean;
  killedForBuffer: boolean;
  spawnError: string | null;
};

type WorkspaceResolution = {
  cwd: string;
  companyWorkspaceRoot: string;
  sourceWorkspaceRoot: string | null;
  additionalWritableDirs: string[];
};

type TranscriptEventInput = {
  kind: string;
  role?: string | null;
  title?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string | null;
};

type CodexJsonTelemetry = {
  source: "codex-cli";
  cli: string;
  structuredTelemetry: boolean;
  observedLiveText: boolean;
  observedThinking: boolean;
  observedStructuredTools: boolean;
  jsonEventCount: number;
  parsedEventCount: number;
  rawJsonLineCount: number;
  toolCallNames: string[];
  assistantSummary: string;
  thinkingSummary: string;
  toolResultSummary: string;
  resultText: string | null;
  resultErrors: string[];
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  totalCostCents?: number;
  transcriptEvents: TranscriptEventInput[];
};

const DEFAULT_CODEX_MAX_BUFFER = 10 * 1024 * 1024;
const TIMEOUT_SIGKILL_GRACE_MS = parseInt(process.env.MC_TIMEOUT_SIGKILL_GRACE_MS ?? "8000", 10);
const CANCEL_SIGKILL_GRACE_MS = parseInt(process.env.MC_CANCEL_SIGKILL_GRACE_MS ?? "5000", 10);

function getDb(): Database.Database {
  // Lazy require keeps adapter registry tests from opening a live DB at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getOrchestrationDb } = require("@/lib/orchestration/db") as {
    getOrchestrationDb: () => Database.Database;
  };
  return getOrchestrationDb();
}

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringFrom(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeJsonRecord(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function normalizeCodexModel(value: string): string {
  const model = value.trim()
    .replace(/^openai-codex\//i, "")
    .replace(/^openai\//i, "")
    .replace(/^codex\//i, "")
    .trim();
  const normalized = model.toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "default" ||
    normalized === "codex" ||
    normalized === "codex-default" ||
    normalized === "openai-codex" ||
    normalized === "openai-codex-default" ||
    normalized === "chatgpt" ||
    normalized === "chatgpt-default"
  ) {
    return "";
  }
  return model;
}

function normalizeReasoningEffort(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "balanced" || normalized === "standard") return "medium";
  if (normalized === "deep") return "high";
  if (normalized === "extra" || normalized === "extra-high" || normalized === "extra_high") return "xhigh";
  if (["minimal", "low", "medium", "high", "xhigh"].includes(normalized)) return normalized;
  return "";
}

function boolFrom(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on", "fast"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "normal"].includes(normalized)) return false;
  return null;
}

function normalizeSpeedPreference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["fast", "faster", "fast_1_5x", "fast-1.5x", "1.5x", "low_latency", "low-latency"].includes(normalized)) {
    return "fast_1_5x";
  }
  if (["normal", "standard", "balanced"].includes(normalized)) return "normal";
  return normalized;
}

function normalizeServiceTier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "default" || normalized === "auto" || normalized === "normal") return null;
  return normalized === "fast" ? "fast" : normalized;
}

function routeAttemptModel(input: ExecutionInput): unknown {
  const source = input.executionRouteAttempt?.target.source as Record<string, unknown> | undefined;
  if (source?.modelSourceId === "agent_profile") return null;
  return input.executionRouteAttempt?.target.model;
}

function explicitTaskReasoning(input: ExecutionInput): unknown {
  return input.taskModelRouting?.lane && input.taskModelRouting.lane !== "default"
    ? input.taskModelRouting.reasoningEffort
    : null;
}

function explicitTaskSpeed(input: ExecutionInput): unknown {
  return input.taskModelRouting?.lane && input.taskModelRouting.lane !== "default"
    ? input.taskModelRouting.speedPreference
    : null;
}

function supportsCodexFastTier(model: string | null | undefined): boolean {
  return model === "gpt-5.5" || model === "gpt-5.4";
}

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberFromUnknown(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNumberFromRecord(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numberFromUnknown(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

type CodexUsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  totalCostCents?: number;
};

function mergeUsageValue(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current;
  if (current === undefined) return next;
  return Math.max(current, next);
}

function mergeUsageSnapshot(base: CodexUsageSnapshot, next: CodexUsageSnapshot): CodexUsageSnapshot {
  return {
    inputTokens: mergeUsageValue(base.inputTokens, next.inputTokens),
    outputTokens: mergeUsageValue(base.outputTokens, next.outputTokens),
    cacheReadInputTokens: mergeUsageValue(base.cacheReadInputTokens, next.cacheReadInputTokens),
    cacheCreationInputTokens: mergeUsageValue(base.cacheCreationInputTokens, next.cacheCreationInputTokens),
    totalTokens: mergeUsageValue(base.totalTokens, next.totalTokens),
    totalCostUsd: mergeUsageValue(base.totalCostUsd, next.totalCostUsd),
    totalCostCents: mergeUsageValue(base.totalCostCents, next.totalCostCents),
  };
}

function usageSnapshotFromRecord(record: Record<string, unknown>): CodexUsageSnapshot {
  return {
    inputTokens: firstNumberFromRecord(record, [
      "inputTokens",
      "input_tokens",
      "promptTokens",
      "prompt_tokens",
      "totalInputTokens",
      "total_input_tokens",
    ]),
    outputTokens: firstNumberFromRecord(record, [
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens",
      "totalOutputTokens",
      "total_output_tokens",
    ]),
    cacheReadInputTokens: firstNumberFromRecord(record, [
      "cacheReadInputTokens",
      "cache_read_input_tokens",
      "cacheReadTokens",
      "cache_read_tokens",
      "cachedReadTokens",
      "cached_read_tokens",
      "cachedInputTokens",
      "cached_input_tokens",
    ]),
    cacheCreationInputTokens: firstNumberFromRecord(record, [
      "cacheCreationInputTokens",
      "cache_creation_input_tokens",
      "cacheWriteTokens",
      "cache_write_tokens",
      "cachedWriteTokens",
      "cached_write_tokens",
    ]),
    totalTokens: firstNumberFromRecord(record, ["totalTokens", "total_tokens"]),
    totalCostUsd: firstNumberFromRecord(record, ["totalCostUsd", "total_cost_usd", "costUsd", "cost_usd"]),
    totalCostCents: firstNumberFromRecord(record, ["totalCostCents", "total_cost_cents", "costCents", "cost_cents"]),
  };
}

function extractCodexUsage(value: unknown, depth = 0): CodexUsageSnapshot {
  if (depth > 4) return {};
  if (Array.isArray(value)) {
    return value.reduce<CodexUsageSnapshot>(
      (acc, item) => mergeUsageSnapshot(acc, extractCodexUsage(item, depth + 1)),
      {},
    );
  }
  const record = asRecord(value);
  if (!record) return {};

  let usage = usageSnapshotFromRecord(record);
  for (const key of ["usage", "token_usage", "tokenUsage", "metrics", "data", "event", "message", "result"] as const) {
    usage = mergeUsageSnapshot(usage, extractCodexUsage(record[key], depth + 1));
  }
  if (usage.totalTokens === undefined && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) {
    usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  return usage;
}

function trimForStorage(value: string, maxChars = 4000): string {
  if (value.length <= maxChars) return value;
  return value.slice(-maxChars);
}

const BENIGN_CODEX_STDERR_PATTERNS = [
  /WARN codex_rollout::list: state db discrepancy during find_thread_path_by_id_str_in_subdir/,
  /WARN codex_core_plugins::manifest: ignoring interface\.defaultPrompt\[/,
  /WARN codex_core_skills::loader: ignoring interface\.icon_(small|large):/,
];

function filterCodexStderr(stderr: string): { stderr: string; filteredLineCount: number } {
  let filteredLineCount = 0;
  const kept = stderr.split(/\r?\n/).filter((line) => {
    if (!line.trim()) return true;
    if (!BENIGN_CODEX_STDERR_PATTERNS.some((pattern) => pattern.test(line))) return true;
    filteredLineCount += 1;
    return false;
  });
  return {
    stderr: kept.join("\n").trim(),
    filteredLineCount,
  };
}

function realDirectoryPath(candidate: string | null | undefined): string | null {
  if (!candidate?.trim()) return null;
  try {
    const resolved = fs.realpathSync(path.resolve(candidate));
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function uniqueWritableDirs(cwd: string, candidates: Array<string | null | undefined>): string[] {
  const cwdReal = realDirectoryPath(cwd) ?? path.resolve(cwd);
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const resolved = realDirectoryPath(candidate);
    if (!resolved || resolved === cwdReal) continue;
    unique.add(resolved);
  }
  return Array.from(unique);
}

function transcriptText(value: string, maxChars = 12000): { body: string; truncated: boolean } {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return { body: trimmed, truncated: false };
  return { body: trimmed.slice(-maxChars), truncated: true };
}

function appendParagraph(existing: string, value: string): string {
  const text = value.trim();
  if (!text) return existing;
  return existing ? `${existing}\n\n${text}` : text;
}

function truncateMiddle(value: string, maxChars = 900): string {
  if (value.length <= maxChars) return value;
  const half = Math.floor((maxChars - 3) / 2);
  return `${value.slice(0, half)}...${value.slice(-half)}`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function recordString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nestedRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return null;
}

function extractTextDeep(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((entry) => extractTextDeep(entry, depth + 1)).filter(Boolean).join("\n").trim();
  }
  const record = asRecord(value);
  if (!record) return "";
  const direct = recordString(record, [
    "text",
    "message",
    "summary",
    "delta",
    "content",
    "result",
    "output",
    "stdout",
    "stderr",
    "final_message",
    "finalMessage",
    "assistant_message",
    "assistantMessage",
  ]);
  if (direct) return direct;

  const nested = nestedRecord(record, ["message", "item", "event", "delta", "content", "output"]);
  if (nested) return extractTextDeep(nested, depth + 1);
  const content = record.content;
  if (Array.isArray(content)) return extractTextDeep(content, depth + 1);
  return "";
}

function codexEventType(record: Record<string, unknown>): string {
  const direct = recordString(record, ["type", "event", "kind", "name", "subtype"]);
  if (direct) return direct;
  const nested = nestedRecord(record, ["msg", "message", "item", "delta", "event"]);
  return nested ? codexEventType(nested) : "codex_event";
}

function codexToolName(record: Record<string, unknown>): string {
  const direct = recordString(record, ["tool_name", "toolName", "tool", "name", "command", "cmd"]);
  if (direct) return direct;
  const type = codexEventType(record).toLowerCase();
  const name = recordString(record, ["name", "title"]);
  if (name && /(tool|exec|command|shell|terminal|function)/i.test(type)) return name;
  const nested = nestedRecord(record, ["tool_call", "toolCall", "function", "item", "message"]);
  return nested ? codexToolName(nested) : "";
}

function codexEventToTranscript(
  record: Record<string, unknown>,
  occurredAt: string,
  index: number,
): TranscriptEventInput | null {
  const type = codexEventType(record);
  const lowerType = type.toLowerCase();
  const text = extractTextDeep(record);
  const toolName = codexToolName(record);
  const metadata = {
    codexEventType: type,
    raw: JSON.stringify(record).slice(0, 3000),
  };

  if (/(error|failed|failure)/i.test(lowerType)) {
    return {
      kind: "error",
      role: "error",
      title: type,
      body: text || truncateMiddle(JSON.stringify(record)),
      metadata,
      occurredAt,
    };
  }

  if (/(reason|thinking|thought)/i.test(lowerType)) {
    return {
      kind: "thinking_summary",
      role: "assistant",
      title: "thinking",
      body: text || type,
      metadata,
      occurredAt,
    };
  }

  if (toolName || /(tool|exec|command|shell|terminal|function)/i.test(lowerType)) {
    const resultLike = /(result|output|completed|complete|end|finished|finish|stderr|stdout)/i.test(lowerType);
    return {
      kind: resultLike ? "tool_result" : "tool_call_start",
      role: "tool",
      title: toolName || type,
      body: text || (toolName ? `Codex reported tool activity: ${toolName}` : truncateMiddle(JSON.stringify(record))),
      metadata,
      occurredAt,
    };
  }

  if (/(assistant|message|response|output|delta|final|answer)/i.test(lowerType) && text) {
    const finalLike = /(final|complete|completed|result)/i.test(lowerType);
    return {
      kind: finalLike ? "assistant_text_final" : "assistant_text_delta",
      role: "assistant",
      title: finalLike ? "assistant final" : "assistant text",
      body: text,
      metadata,
      occurredAt,
    };
  }

  if (/(start|begin|created|queued|running|turn)/i.test(lowerType)) {
    return {
      kind: "provider_event",
      role: "system",
      title: type,
      body: text || type,
      metadata,
      occurredAt,
    };
  }

  if (!text) return null;
  return {
    kind: "provider_event",
    role: "system",
    title: type || `Codex event ${index + 1}`,
    body: text,
    metadata,
    occurredAt,
  };
}

function createCodexJsonCollector(onLiveEvent?: (event: TranscriptEventInput) => void) {
  let lineBuffer = "";
  const transcriptEvents: TranscriptEventInput[] = [];
  const toolCallNames = new Set<string>();
  let rawJsonLineCount = 0;
  let parsedEventCount = 0;
  let assistantSummary = "";
  let thinkingSummary = "";
  let toolResultSummary = "";
  const resultErrors: string[] = [];
  let usage: CodexUsageSnapshot = {};

  const ingestLine = (rawLine: string, occurredAt: string) => {
    const line = rawLine.trim();
    if (!line) return;
    const record = safeJsonRecord(line);
    if (!record) return;
    rawJsonLineCount += 1;
    usage = mergeUsageSnapshot(usage, extractCodexUsage(record));
    const event = codexEventToTranscript(record, occurredAt, transcriptEvents.length);
    if (!event) return;
    parsedEventCount += 1;
    transcriptEvents.push(event);
    if (event.kind === "assistant_text_delta" || event.kind === "assistant_text_final") {
      assistantSummary = appendParagraph(assistantSummary, event.body ?? "");
    }
    if (event.kind === "thinking_summary") {
      thinkingSummary = appendParagraph(thinkingSummary, event.body ?? "");
    }
    if (event.kind === "tool_call_start" && event.title) {
      toolCallNames.add(event.title);
    }
    if (event.kind === "tool_result") {
      if (event.title) toolCallNames.add(event.title);
      toolResultSummary = appendParagraph(toolResultSummary, event.body ?? "");
    }
    if (event.kind === "error") {
      resultErrors.push(event.body ?? event.title ?? "Codex event error");
    }
    onLiveEvent?.(event);
  };

  return {
    push(chunk: string, occurredAt = new Date().toISOString()) {
      lineBuffer += chunk;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) ingestLine(line, occurredAt);
    },
    finish(occurredAt = new Date().toISOString()): CodexJsonTelemetry {
      if (lineBuffer.trim()) {
        ingestLine(lineBuffer, occurredAt);
        lineBuffer = "";
      }
      const observedLiveText = transcriptEvents.some((event) =>
        event.kind === "assistant_text_delta" || event.kind === "assistant_text_final",
      );
      const observedStructuredTools = transcriptEvents.some((event) =>
        event.kind === "tool_call_start" || event.kind === "tool_result" || event.kind === "tool_call_end",
      );
      const observedThinking = transcriptEvents.some((event) => event.kind === "thinking_summary");
      return {
        source: "codex-cli",
        cli: "codex exec --json",
        structuredTelemetry: rawJsonLineCount > 0,
        observedLiveText,
        observedThinking,
        observedStructuredTools,
        jsonEventCount: transcriptEvents.length,
        parsedEventCount,
        rawJsonLineCount,
        toolCallNames: Array.from(toolCallNames),
        assistantSummary,
        thinkingSummary,
        toolResultSummary,
        resultText: assistantSummary || null,
        resultErrors,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        totalTokens: usage.totalTokens,
        totalCostUsd: usage.totalCostUsd,
        totalCostCents: usage.totalCostCents,
        transcriptEvents,
      };
    },
  };
}

function liveEventTypeForTranscript(event: TranscriptEventInput): string {
  if (event.kind === "assistant_text_delta" || event.kind === "assistant_text_final") return "assistant_text";
  if (event.kind === "thinking_summary") return "thinking";
  if (event.kind === "tool_call_start") return "tool_call";
  if (event.kind === "tool_result") return "tool_result";
  if (event.kind === "error") return "error";
  return "provider_event";
}

function liveDetailForTranscript(event: TranscriptEventInput): string {
  const body = (event.body ?? "").replace(/\s+/g, " ").trim();
  const title = event.title?.trim();
  if (title && body) return `${title}: ${body.slice(0, 220)}`;
  return (body || title || event.kind).slice(0, 240);
}

function toolCallIdForTranscript(event: TranscriptEventInput): string {
  const metadata = asRecord(event.metadata);
  const explicit =
    stringFrom(metadata?.toolCallId) ||
    stringFrom(metadata?.toolUseId) ||
    stringFrom(metadata?.id);
  if (explicit) return explicit;
  return `codex:${event.title ?? event.kind}:${event.occurredAt ?? ""}`;
}

function liveEventForTranscript(event: TranscriptEventInput): ExecutionLiveEventInput {
  const text = event.body ?? event.title ?? event.kind;
  const providerMeta = {
    transcriptKind: event.kind,
    role: event.role ?? null,
    title: event.title ?? null,
    ...(event.metadata ? { transcriptMetadata: event.metadata } : {}),
  };

  if (event.kind === "assistant_text_delta") {
    return {
      kind: "assistant_text_delta",
      summary: liveDetailForTranscript(event),
      provider: "codex",
      payload: { delta: text, accumulatedText: text },
      providerMeta,
    };
  }
  if (event.kind === "assistant_text_final") {
    return {
      kind: "assistant_text_final",
      summary: liveDetailForTranscript(event),
      provider: "codex",
      payload: { text },
      providerMeta,
    };
  }
  if (event.kind === "thinking_summary") {
    return {
      kind: "thinking_summary",
      summary: liveDetailForTranscript(event),
      provider: "codex",
      payload: { summary: text },
      providerMeta,
    };
  }
  if (event.kind === "tool_call_start") {
    const toolName = event.title ?? "tool";
    return {
      kind: "tool_call_start",
      summary: liveDetailForTranscript(event),
      provider: "codex",
      payload: {
        toolCallId: toolCallIdForTranscript(event),
        toolName,
      },
      providerMeta,
    };
  }
  if (event.kind === "tool_result") {
    const toolName = event.title ?? "tool";
    return {
      kind: "tool_result",
      summary: liveDetailForTranscript(event),
      provider: "codex",
      payload: {
        toolCallId: toolCallIdForTranscript(event),
        toolName,
        output: text,
        isError: false,
      },
      providerMeta,
    };
  }
  if (event.kind === "run_start") {
    return {
      kind: "run_start",
      summary: liveDetailForTranscript(event),
      provider: "codex",
      payload: { invocationSource: "codex-cli" },
      providerMeta,
    };
  }
  if (event.kind === "run_end") {
    return {
      kind: "run_end",
      summary: liveDetailForTranscript(event),
      provider: "codex",
      payload: { result: "success" },
      providerMeta,
    };
  }
  if (event.kind === "run_error") {
    return {
      kind: "run_error",
      summary: liveDetailForTranscript(event),
      provider: "codex",
      payload: { errorMessage: text, recoverable: false },
      providerMeta,
    };
  }
  if (event.kind === "error") {
    return {
      kind: "error",
      summary: liveDetailForTranscript(event),
      provider: "codex",
      payload: { errorMessage: text },
      providerMeta,
    };
  }
  return {
    kind: "provider_stream_event",
    summary: liveDetailForTranscript(event),
    provider: "codex",
    payload: {
      providerEventType: event.title ?? event.kind,
      event: {
        kind: event.kind,
        role: event.role ?? null,
        title: event.title ?? null,
        body: event.body ?? null,
        metadata: event.metadata ?? null,
      },
    },
    providerMeta,
  };
}

function resolveCodexRuntime(db: Database.Database, input: ExecutionInput): CodexRuntimeRow | null {
  const rows = db
    .prepare(
      `SELECT command, display_name, runtime_slug, scope, workspace_root, metadata_json
       FROM agent_runtimes
       WHERE company_id = ?
         AND provider = 'codex'
         AND status <> 'disabled'
         AND (agent_id = ? OR agent_id IS NULL)
       ORDER BY
         CASE WHEN agent_id = ? THEN 0 ELSE 1 END,
         CASE scope WHEN 'agent' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
         updated_at DESC
       LIMIT 1`,
    )
    .all(input.agent.company_id, input.agent.id, input.agent.id) as CodexRuntimeRow[];

  return rows[0] ?? null;
}

function resolveWorkspaceRoot(db: Database.Database, input: ExecutionInput, runtime: CodexRuntimeRow | null): WorkspaceResolution {
  const row = db
    .prepare(
      `SELECT
         c.id AS company_id,
         c.company_code AS company_code,
         c.workspace_slug AS company_workspace_slug,
         c.workspace_root AS company_workspace_root,
         c.workspace_source AS company_workspace_source,
         p.settings_json AS project_settings_json
       FROM companies c
       LEFT JOIN tasks t ON (t.id = ? OR t.task_key = ?) AND t.archived_at IS NULL
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(input.session.taskKey, input.session.taskKey, input.agent.company_id) as WorkspaceRow | undefined;

  const companyRoot = row?.company_workspace_source === "openclaw"
    ? resolveCanonicalCompanyWorkspaceRoot(row.company_id, row.company_workspace_slug)
    : resolveCompanyWorkspaceRoot({
        companyId: row?.company_id ?? input.agent.company_id,
        workspaceSlug: row?.company_workspace_slug,
        workspaceRoot: row?.company_workspace_root,
        workspaceSource: row?.company_workspace_source,
      });
  const companyWorkspaceRoot = ensureCompanyWorkspaceScaffold(companyRoot).root;
  const companySource = ensureCompanySourceWorkspaceLink(companyWorkspaceRoot);
  const exposeSourceWorkspace = row?.company_code === "NEV";
  const projectSourceWorkspaceRoot = readProjectSourceWorkspaceRoot(row?.project_settings_json);

  if (projectSourceWorkspaceRoot) {
    const resolved = path.resolve(projectSourceWorkspaceRoot);
    return {
      cwd: resolved,
      companyWorkspaceRoot,
      sourceWorkspaceRoot: resolved,
      additionalWritableDirs: uniqueWritableDirs(resolved, [
        companyWorkspaceRoot,
      ]),
    };
  }

  const explicitRuntimeRoot = runtime?.workspace_root?.trim();
  if (explicitRuntimeRoot) {
    const resolved = path.resolve(explicitRuntimeRoot);
    fs.mkdirSync(resolved, { recursive: true });
    const agentSource = ensureAgentSourceWorkspaceLink(resolved, companyWorkspaceRoot);
    return {
      cwd: companyWorkspaceRoot,
      companyWorkspaceRoot,
      sourceWorkspaceRoot: exposeSourceWorkspace ? agentSource.targetPath : null,
      additionalWritableDirs: uniqueWritableDirs(companyWorkspaceRoot, [
        resolved,
        companyWorkspaceRoot,
        ...(exposeSourceWorkspace ? [agentSource.linkPath, agentSource.targetPath] : []),
      ]),
    };
  }

  return {
    cwd: companyWorkspaceRoot,
    companyWorkspaceRoot,
    sourceWorkspaceRoot: exposeSourceWorkspace ? companySource.targetPath : null,
    additionalWritableDirs: uniqueWritableDirs(companyWorkspaceRoot, [
      ...(exposeSourceWorkspace ? [companySource.linkPath, companySource.targetPath] : []),
    ]),
  };
}

function requiresConfiguredSourceWorkspace(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    /\b(this|current|same)\s+repo(sitory)?\b/.test(normalized) ||
    /\bin\s+the\s+repo(sitory)?\b/.test(normalized) ||
    /\bexisting\s+repo(sitory)?\s+(home|test|tests|tooling|patterns|conventions)\b/.test(normalized) ||
    /\brepo(sitory)?'s\s+existing\b/.test(normalized)
  );
}

function sourceWorkspaceMissingMessage(workspace: WorkspaceResolution): string {
  return [
    "Repo-scoped Codex work requires an explicit project source workspace root.",
    `Configured workspace: ${workspace.cwd}`,
    `Company workspace: ${workspace.companyWorkspaceRoot}`,
    "Set project settings workspace.sourceRoot/sourceWorkspaceRoot before running repository-scoped implementation or validation tasks.",
  ].join(" ");
}

function resolveCommand(runtime: CodexRuntimeRow | null): string {
  const metadata = parseJson(runtime?.metadata_json);
  const metadataCommand = typeof metadata.commandPath === "string" ? metadata.commandPath.trim() : "";
  return metadataCommand || runtime?.command?.trim() || "codex";
}

function resolveRuntimeControls(
  db: Database.Database,
  input: ExecutionInput,
  runtime: CodexRuntimeRow | null,
): CodexRuntimeControls {
  const runtimeMetadata = parseJson(runtime?.metadata_json);
  const runtimeConfig = parseJson(input.agent.runtime_config_json);
  const agentModel = db
    .prepare("SELECT model FROM agents WHERE id = ? LIMIT 1")
    .get(input.agent.id) as AgentModelRow | undefined;

  const modelCandidates = [
    input.taskModelRouting?.model,
    routeAttemptModel(input),
    runtimeConfig.model,
    runtimeMetadata.model,
    runtimeMetadata.modelId,
    agentModel?.model,
  ];
  let model = "";
  for (const candidate of modelCandidates) {
    const value = normalizeCodexModel(stringFrom(candidate));
    if (value) {
      model = value;
      break;
    }
  }

  let reasoningEffort = "";
  for (const candidate of [
    explicitTaskReasoning(input),
    runtimeConfig.reasoningEffort,
    runtimeConfig.modelReasoningEffort,
    runtimeConfig.thinkingLevel,
    runtimeMetadata.reasoningEffort,
    runtimeMetadata.modelReasoningEffort,
    runtimeMetadata.thinkingLevel,
    input.taskModelRouting?.reasoningEffort,
  ]) {
    const value = normalizeReasoningEffort(candidate);
    if (value) {
      reasoningEffort = value;
      break;
    }
  }

  const fastMode = boolFrom(runtimeConfig.fastMode) ?? boolFrom(runtimeMetadata.fastMode);
  const configuredSpeedPreference =
    normalizeSpeedPreference(explicitTaskSpeed(input)) ??
    normalizeSpeedPreference(runtimeConfig.speedPreference) ??
    normalizeSpeedPreference(runtimeConfig.speed) ??
    normalizeSpeedPreference(runtimeConfig.thinkingSpeed) ??
    normalizeSpeedPreference(runtimeMetadata.speedPreference) ??
    normalizeSpeedPreference(runtimeMetadata.speed) ??
    normalizeSpeedPreference(runtimeMetadata.thinkingSpeed);
  const speedPreference = configuredSpeedPreference ?? normalizeSpeedPreference(input.taskModelRouting?.speedPreference);
  const configuredServiceTier =
    normalizeServiceTier(runtimeConfig.serviceTier) ??
    normalizeServiceTier(runtimeConfig.service_tier) ??
    normalizeServiceTier(runtimeMetadata.serviceTier) ??
    normalizeServiceTier(runtimeMetadata.service_tier);
  const requestedServiceTier = configuredServiceTier ?? (fastMode === true || configuredSpeedPreference === "fast_1_5x" ? "fast" : null);
  // TODO: Codex fast service tier is only applied for models already proven by the Overseer runtime path.
  const serviceTierApplied = requestedServiceTier === "fast" && supportsCodexFastTier(model);

  return {
    model,
    reasoningEffort,
    speedPreference,
    fastMode,
    serviceTier: requestedServiceTier,
    serviceTierApplied,
  };
}

function buildEnv(command: string): NodeJS.ProcessEnv {
  const pathEntries = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""];
  if (path.isAbsolute(command)) {
    pathEntries.unshift(path.dirname(command));
  }
  return buildExternalRunnerEnv(process.env, {
    PATH: pathEntries.filter(Boolean).join(":"),
  });
}

function runCodex(
  command: string,
  prompt: string,
  cwd: string,
  model: string,
  reasoningEffort: string,
  serviceTier: string | null,
  additionalWritableDirs: string[],
  options: {
    onTranscriptEvent?: (event: TranscriptEventInput) => void;
    onLifecycleEvent?: (event: TranscriptEventInput) => void;
    onLiveEvent?: ExecutionLiveEventEmitter;
    onPidReady?: (pid: number | undefined) => void;
    onExit?: () => void;
    runId?: string;
  } = {},
): Promise<CodexExecResult> {
  const started = Date.now();
  const timeout = numberFromEnv("MC_CODEX_EXEC_TIMEOUT_MS", DEFAULT_CODEX_TIMEOUT_MS);
  const maxBuffer = numberFromEnv("MC_CODEX_EXEC_MAX_BUFFER", DEFAULT_CODEX_MAX_BUFFER);
  const outputFileName = options.runId
    ? `hiverunner-${options.runId}-${randomUUID()}.txt`
    : `hiverunner-codex-${randomUUID()}.txt`;
  const outputFile = path.join(os.tmpdir(), outputFileName);
  const args = [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
  ];
  const jsonCollector = createCodexJsonCollector(options.onTranscriptEvent);
  for (const writableDir of additionalWritableDirs) {
    args.push("--add-dir", writableDir);
  }
  if (reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
  }
  if (serviceTier === "fast") {
    args.push("-c", `service_tier="fast"`);
  }
  if (model) {
    args.push("--model", model);
  }
  args.push("--output-last-message", outputFile);
  args.push("-");

  return new Promise((resolve) => {
    options.onLiveEvent?.({
      kind: "command_start",
      summary: `Starting Codex CLI: ${path.basename(command)} exec`,
      provider: "codex",
      payload: {
        command: `${path.basename(command)} ${args.join(" ")}`,
        cwd,
        argv: [command, ...args],
      },
      providerMeta: {
        model: model || null,
        reasoningEffort: reasoningEffort || null,
        serviceTier: serviceTier ?? null,
        additionalWritableDirs,
      },
    });
    const child = spawn(command, args, {
      cwd,
      env: buildEnv(command),
      stdio: ["pipe", "pipe", "pipe"],
    });
    options.onPidReady?.(child.pid);
    options.onLiveEvent?.({
      kind: "process_spawned",
      summary: child.pid ? `Codex process spawned (${child.pid})` : "Codex process spawned",
      provider: "codex",
      payload: {
        pid: child.pid,
        command: path.basename(command),
        cwd,
      },
      providerMeta: {
        argv: [command, ...args],
      },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutLive = createAdapterLiveChunkEmitter(options.onLiveEvent, {
      kind: "stdout_chunk",
      provider: "codex",
      stream: "stdout",
      summaryPrefix: "Codex",
      startedAt: started,
    });
    const stderrLive = createAdapterLiveChunkEmitter(options.onLiveEvent, {
      kind: "stderr_chunk",
      provider: "codex",
      stream: "stderr",
      summaryPrefix: "Codex",
      startedAt: started,
    });
    let bufferedBytes = 0;
    let timedOut = false;
    let killedForBuffer = false;
    let spawnError: Error | null = null;
    let settled = false;
    let stdinClosedAtMs: number | null = null;
    let firstStdoutAtMs: number | null = null;
    let lastStdoutAtMs: number | null = null;
    let firstStderrAtMs: number | null = null;
    let lastStderrAtMs: number | null = null;

    options.onLifecycleEvent?.({
      kind: "provider_event",
      role: "system",
      title: "Codex process started",
      body: `codex exec launched with ${prompt.length} prompt chars and ${formatDuration(timeout)} timeout.`,
      occurredAt: new Date().toISOString(),
      metadata: {
        promptChars: prompt.length,
        timeoutMs: timeout,
        maxBufferBytes: maxBuffer,
        cwd,
        model: model || null,
        serviceTier: serviceTier ?? null,
        additionalWritableDirs,
      },
    });

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      options.onLiveEvent?.({
        kind: "runtime_progress",
        summary: `Codex exceeded ${formatDuration(timeout)}; terminating process.`,
        provider: "codex",
        payload: {
          phase: "timeout",
          message: `Codex exceeded ${formatDuration(timeout)}; terminating process.`,
        },
        providerMeta: {
          timeoutMs: timeout,
          durationMs: Date.now() - started,
        },
      });
      options.onLifecycleEvent?.({
        kind: "error",
        role: "error",
        title: "Codex timeout",
        body: `Codex exceeded ${formatDuration(timeout)} without completing.`,
        occurredAt: new Date().toISOString(),
        metadata: { timeoutMs: timeout, durationMs: Date.now() - started },
      });
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, TIMEOUT_SIGKILL_GRACE_MS);
    }, timeout);

    const appendChunk = (chunks: Buffer[], chunk: Buffer) => {
      bufferedBytes += chunk.length;
      if (bufferedBytes > maxBuffer && !killedForBuffer) {
        killedForBuffer = true;
        options.onLiveEvent?.({
          kind: "runtime_progress",
          summary: `Codex exceeded ${maxBuffer} bytes of buffered output; terminating process.`,
          provider: "codex",
          payload: {
            phase: "output_buffer_limit",
            message: `Codex exceeded ${maxBuffer} bytes of buffered output; terminating process.`,
          },
          providerMeta: {
            maxBufferBytes: maxBuffer,
            bufferedBytes,
          },
        });
        options.onLifecycleEvent?.({
          kind: "error",
          role: "error",
          title: "Codex output buffer limit",
          body: `Codex exceeded the ${maxBuffer} byte output buffer.`,
          occurredAt: new Date().toISOString(),
          metadata: { maxBufferBytes: maxBuffer, bufferedBytes },
        });
        child.kill("SIGTERM");
        return;
      }
      chunks.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const atMs = Date.now() - started;
      firstStdoutAtMs ??= atMs;
      lastStdoutAtMs = atMs;
      appendChunk(stdoutChunks, chunk);
      stdoutLive.push(chunk);
      jsonCollector.push(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const atMs = Date.now() - started;
      firstStderrAtMs ??= atMs;
      lastStderrAtMs = atMs;
      appendChunk(stderrChunks, chunk);
      stderrLive.push(chunk);
    });
    child.on("error", (error) => {
      spawnError = error;
      options.onLiveEvent?.({
        kind: "error",
        summary: `Codex process error: ${error.message}`,
        provider: "codex",
        payload: { errorMessage: error.message },
      });
    });

    child.on("close", (code, signal) => {
      options.onExit?.();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdoutLive.flush();
      stderrLive.flush();

      let finalMessage = "";
      try {
        finalMessage = fs.readFileSync(outputFile, "utf8");
      } catch {
        finalMessage = "";
      } finally {
        fs.rmSync(outputFile, { force: true });
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const outputLastMessageBytes = Buffer.byteLength(finalMessage);
      const jsonTelemetry = jsonCollector.finish(new Date().toISOString());
      const stdoutTrimmed = stdout.trim();
      const finalMessageTrimmed = finalMessage.trim();
      const assistantOutput =
        jsonTelemetry.resultText?.trim() ||
        jsonTelemetry.assistantSummary.trim();
      const stdoutText =
        assistantOutput ||
        finalMessageTrimmed ||
        (jsonTelemetry.structuredTelemetry ? "" : stdoutTrimmed);
      const errorMessage =
        spawnError?.message ??
        (timedOut
          ? `codex exec timed out after ${timeout}ms`
          : killedForBuffer
            ? `codex exec exceeded max buffer of ${maxBuffer} bytes`
            : code === 0
              ? null
              : `codex exec failed with exit code ${code ?? "unknown"}`);

      if (timedOut && options.runId) {
        cleanupRunArtifacts(options.runId).catch(() => {});
      }
      const durationMs = Date.now() - started;
      options.onLiveEvent?.({
        kind: "process_exit",
        summary: `Codex process exited with code ${code ?? "unknown"}`,
        provider: "codex",
        payload: {
          pid: child.pid,
          exitCode: code,
          signal,
          durationMs,
        },
        providerMeta: {
          timedOut,
          killedForBuffer,
          spawnError: spawnError?.message ?? null,
        },
      });
      options.onLiveEvent?.({
        kind: "command_exit",
        summary: `Codex command exited with code ${code ?? "unknown"}`,
        provider: "codex",
        payload: {
          command: path.basename(command),
          exitCode: code,
          signal,
          durationMs,
        },
        providerMeta: {
          timedOut,
          killedForBuffer,
          stdoutBytes: Buffer.byteLength(stdout),
          stderrBytes: Buffer.byteLength(stderr),
          outputLastMessageBytes,
        },
      });

      resolve({
        ok: code === 0 && !spawnError && !timedOut && !killedForBuffer,
        stdout: stdoutText,
        stderr,
        exitCode: code,
        signal,
        errorMessage,
        durationMs,
        jsonTelemetry,
        diagnostics: {
          promptChars: prompt.length,
          timeoutMs: timeout,
          maxBufferBytes: maxBuffer,
          stdoutBytes: Buffer.byteLength(stdout),
          stderrBytes: Buffer.byteLength(stderr),
          outputLastMessageBytes,
          stdinClosedAtMs,
          firstStdoutAtMs,
          lastStdoutAtMs,
          firstStderrAtMs,
          lastStderrAtMs,
          timedOut,
          killedForBuffer,
          spawnError: spawnError?.message ?? null,
        },
      });
    });

    child.stdin.write(prompt);
    child.stdin.end(() => {
      stdinClosedAtMs = Date.now() - started;
      options.onLifecycleEvent?.({
        kind: "provider_event",
        role: "system",
        title: "Codex prompt sent",
        body: `Prompt delivered to Codex stdin (${prompt.length} chars).`,
        occurredAt: new Date().toISOString(),
        metadata: { promptChars: prompt.length, stdinClosedAtMs },
      });
    });
  });
}

function insertTaskComment(input: {
  db: Database.Database;
  taskId: string;
  agentId: string;
  body: string;
  externalRef: string;
}): boolean {
  if (input.taskId === "__heartbeat__") return false;

  const task = input.db
    .prepare("SELECT id FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(input.taskId) as { id: string } | undefined;
  if (!task) return false;

  const existing = input.db
    .prepare(
      `SELECT id FROM comments
       WHERE task_id = ? AND source = 'mission_control' AND external_ref = ?
       LIMIT 1`,
    )
    .get(task.id, input.externalRef) as { id: string } | undefined;
  if (existing) return true;

  const now = new Date().toISOString();
  const sanitized = sanitizeAgentCommentLinks(input.body);
  if (sanitized.invalidLinks.length > 0) {
    console.warn("[codex:link-verification] withheld agent comment with invalid external links", {
      taskId: task.id,
      invalidLinks: sanitized.invalidLinks.map((link) => ({ url: link.url, status: link.status, reason: link.reason })),
    });
  }
  input.db
    .prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, author_user_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 'status_update', 'mission_control', ?, ?, ?)`,
    )
    .run(randomUUID(), task.id, input.agentId, sanitized.body, input.externalRef, now, now);
  return true;
}

function buildCommentBody(input: {
  ok: boolean;
  command: string;
  model: string;
  reasoningEffort: string;
  serviceTier: string | null;
  workspaceRoot: string;
  additionalWritableDirs: string[];
  durationMs: number;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
}): string {
  const status = input.ok ? "completed" : "failed";
  const parts = [
    `Codex execution ${status}.`,
    "",
    `Command: ${path.basename(input.command)} exec --json --sandbox workspace-write --skip-git-repo-check --ephemeral --ignore-user-config${input.reasoningEffort ? ` -c model_reasoning_effort="${input.reasoningEffort}"` : ""}${input.serviceTier === "fast" ? ` -c service_tier="fast"` : ""}${input.model ? ` --model ${input.model}` : ""}`,
    `Workspace: ${input.workspaceRoot}`,
    `Duration: ${formatDuration(input.durationMs)}`,
  ];
  if (input.additionalWritableDirs.length > 0) {
    parts.splice(3, 0, `Writable roots: ${input.additionalWritableDirs.join(", ")}`);
  }

  if (input.errorMessage) {
    parts.push("", `Error: ${input.errorMessage}`);
  }
  if (input.stdout.trim()) {
    parts.push("", "Stdout:", trimForStorage(input.stdout.trim(), 3000));
  }
  if (input.stderr.trim()) {
    parts.push("", "Stderr:", trimForStorage(input.stderr.trim(), 2000));
  }

  return trimForStorage(parts.join("\n"), 6500);
}

async function execute(input: ExecutionInput): Promise<ExecutionResult> {
  const db = getDb();
  const runtime = resolveCodexRuntime(db, input);
  const command = resolveCommand(runtime);
  const controls = resolveRuntimeControls(db, input, runtime);
  const { model, reasoningEffort } = controls;
  const appliedServiceTier = controls.serviceTierApplied ? controls.serviceTier : null;
  const workspace = resolveWorkspaceRoot(db, input, runtime);
  const runtimeSkills = listRuntimeAgentSkills(input.agent.company_id, input.agent.id).skills;
  const workspaceRoot = workspace.cwd;
  const trackedRoots = [
    workspaceRoot,
    workspace.companyWorkspaceRoot,
    ...(workspace.sourceWorkspaceRoot ? [workspace.sourceWorkspaceRoot] : []),
    ...workspace.additionalWritableDirs,
  ];
  const workspaceBefore = captureWorkspaceGitSnapshots(trackedRoots);
  const readOnlyIntent = detectReadOnlyIntent(input.prompt);
  const startedAt = new Date().toISOString();
  const lifecycleEvents: TranscriptEventInput[] = [];
  const recordLifecycleEvent = (event: TranscriptEventInput) => {
    lifecycleEvents.push(event);
    input.emitEvent?.(liveEventTypeForTranscript(event), liveDetailForTranscript(event));
    input.emitLiveEvent?.(liveEventForTranscript(event));
  };
  const recordTranscriptEvent = (event: TranscriptEventInput) => {
    input.emitEvent?.(liveEventTypeForTranscript(event), liveDetailForTranscript(event));
    input.emitLiveEvent?.(liveEventForTranscript(event));
  };
  const { executionRunId } = input;
  if (requiresConfiguredSourceWorkspace(input.prompt) && !workspace.sourceWorkspaceRoot) {
    const error = sourceWorkspaceMissingMessage(workspace);
    try {
      insertTaskComment({
        db,
        taskId: input.session.taskKey,
        agentId: input.agent.id,
        body: `[SOURCE_WORKSPACE_REQUIRED] ${error}`,
        externalRef: `codex:${input.agent.id}:${input.session.taskKey}:${startedAt}`,
      });
    } catch (commentError) {
      console.warn(
        `[codex-adapter] failed to persist source-workspace guard comment for ${input.agent.id}/${input.session.taskKey}:`,
        commentError,
      );
    }
    return {
      runnerProvider: "codex",
      runnerModel: model || null,
      error,
      usage: {
        provider: "codex",
        runnerProvider: "codex",
        runnerModel: model || null,
        source: "codex-cli",
        integrationPath: "source-workspace-guard",
        command: path.basename(command),
        ephemeral: true,
        ignoreUserConfig: true,
        model: model || null,
        reasoningEffort: reasoningEffort || null,
        taskModelLane: input.taskModelRouting?.lane ?? "default",
        taskModelRoutingLabel: input.taskModelRouting?.label ?? "Default",
        speedPreference: controls.speedPreference,
        fastMode: controls.fastMode,
        serviceTier: controls.serviceTier,
        serviceTierApplied: controls.serviceTierApplied,
        runtimeSlug: runtime?.runtime_slug ?? null,
        runtimeScope: runtime?.scope ?? null,
        runtimeDisplayName: runtime?.display_name ?? null,
        workspaceRoot,
        companyWorkspaceRoot: workspace.companyWorkspaceRoot,
        sourceWorkspaceRoot: workspace.sourceWorkspaceRoot,
        additionalWritableDirs: workspace.additionalWritableDirs,
        sourceWorkspaceRequired: true,
        sourceWorkspaceGuard: "missing_project_source_root",
        startedAt,
        completedAt: new Date().toISOString(),
        diagnostics: {
          promptChars: input.prompt.length,
        },
      },
    };
  }
  const result = await runCodex(command, input.prompt, workspaceRoot, model, reasoningEffort, appliedServiceTier, workspace.additionalWritableDirs, {
    onTranscriptEvent: recordTranscriptEvent,
    onLifecycleEvent: recordLifecycleEvent,
    onLiveEvent: input.emitLiveEvent,
    ...(executionRunId ? {
      runId: executionRunId,
      onPidReady: (pid: number | undefined) => {
        if (!pid) return;
        try { db.prepare("UPDATE execution_runs SET process_pid = ? WHERE id = ?").run(pid, executionRunId); } catch {}
      },
      onExit: () => {
        try { db.prepare("UPDATE execution_runs SET process_pid = NULL WHERE id = ?").run(executionRunId); } catch {}
      },
    } : {}),
  });
  const workspaceAfter = captureWorkspaceGitSnapshots(trackedRoots);
  const workspaceRunVisibility = buildWorkspaceRunVisibility({
    before: workspaceBefore,
    after: workspaceAfter,
    readOnlyIntent,
  });
  const completedAt = new Date().toISOString();
  const codexTelemetry = result.jsonTelemetry;
  const filteredStderr = filterCodexStderr(result.stderr);
  const evidenceStderr = filteredStderr.stderr;
  const timedOutLikely =
    result.durationMs >= numberFromEnv("MC_CODEX_EXEC_TIMEOUT_MS", DEFAULT_CODEX_TIMEOUT_MS) - 1000;
  const emptySuccessfulOutput = result.ok && result.stdout.trim().length === 0;
  const codexReportedError = codexTelemetry.resultErrors.find((entry) => entry.trim())?.trim() ?? "";
  const firstStderrLine = evidenceStderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  const effectiveErrorMessage = emptySuccessfulOutput
    ? timedOutLikely
      ? "codex exec completed at the timeout boundary without assistant output"
      : "codex exec completed without assistant output"
    : result.errorMessage && codexReportedError
      ? `${result.errorMessage}: ${trimForStorage(codexReportedError, 1000)}`
      : result.errorMessage && firstStderrLine
        ? `${result.errorMessage}: ${trimForStorage(firstStderrLine, 1000)}`
      : result.errorMessage;
  const effectiveOk = result.ok && !emptySuccessfulOutput;
  const telemetryHasAssistantText = codexTelemetry.transcriptEvents.some((event) =>
    event.kind === "assistant_text_delta" || event.kind === "assistant_text_final",
  );
  const stdoutTranscript = transcriptText(codexTelemetry.resultText || result.stdout);
  const stderrTranscript = transcriptText(evidenceStderr, 6000);

  const externalRef = `codex:${input.agent.id}:${input.session.taskKey}:${startedAt}`;
  const commentBodyBase = buildCommentBody({
    ok: effectiveOk,
    command,
    model,
    reasoningEffort,
    serviceTier: appliedServiceTier,
    workspaceRoot,
    additionalWritableDirs: workspace.additionalWritableDirs,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: evidenceStderr,
    errorMessage: effectiveErrorMessage,
  });
  const commentBody = !effectiveOk && firstStderrLine
    ? trimForStorage(`[CLI_FAILURE] Codex CLI exited ${result.exitCode ?? "unknown"}: ${firstStderrLine}\n\n${commentBodyBase}`, 6500)
    : commentBodyBase;

  let taskEvidenceCommentCreated = false;
  if (!emptySuccessfulOutput) {
    try {
      taskEvidenceCommentCreated = insertTaskComment({
        db,
        taskId: input.session.taskKey,
        agentId: input.agent.id,
        body: commentBody,
        externalRef,
      });
    } catch (error) {
      console.warn(
        `[codex-adapter] failed to persist task comment for ${input.agent.id}/${input.session.taskKey}:`,
        error,
      );
    }
  }

  const usage = {
    provider: "codex",
    runnerProvider: "codex",
    runnerModel: model || null,
    source: codexTelemetry.source,
    cli: codexTelemetry.cli,
    integrationPath: codexTelemetry.structuredTelemetry ? "cli-json-events" : "cli-batch",
    structuredTelemetry: codexTelemetry.structuredTelemetry,
    observedLiveText: codexTelemetry.observedLiveText,
    observedThinking: codexTelemetry.observedThinking,
    observedStructuredTools: codexTelemetry.observedStructuredTools,
    jsonEventCount: codexTelemetry.jsonEventCount,
    parsedEventCount: codexTelemetry.parsedEventCount,
    rawJsonLineCount: codexTelemetry.rawJsonLineCount,
    toolCallNames: codexTelemetry.toolCallNames,
    assistantSummary: trimForStorage(codexTelemetry.assistantSummary, 4000),
    thinkingSummary: trimForStorage(codexTelemetry.thinkingSummary, 3000),
    toolResultSummary: trimForStorage(codexTelemetry.toolResultSummary, 3000),
    resultErrors: codexTelemetry.resultErrors,
    inputTokens: codexTelemetry.inputTokens,
    outputTokens: codexTelemetry.outputTokens,
    cacheReadInputTokens: codexTelemetry.cacheReadInputTokens,
    cacheCreationInputTokens: codexTelemetry.cacheCreationInputTokens,
    totalTokens: codexTelemetry.totalTokens,
    totalCostUsd: codexTelemetry.totalCostUsd,
    totalCostCents: codexTelemetry.totalCostCents,
    command: path.basename(command),
    ephemeral: true,
    ignoreUserConfig: true,
    model: model || null,
    reasoningEffort: reasoningEffort || null,
    taskModelLane: input.taskModelRouting?.lane ?? "default",
    taskModelRoutingLabel: input.taskModelRouting?.label ?? "Default",
    speedPreference: controls.speedPreference,
    fastMode: controls.fastMode,
    serviceTier: controls.serviceTier,
    serviceTierApplied: controls.serviceTierApplied,
    runtimeSkillCount: runtimeSkills.length,
    runtimeSkillContract: {
      schema: "hiverunner.runtime_skills.v1",
      trackingAction: "use_skill",
      trackingRule: "When an assigned active skill is materially applied during the run, emit one use_skill mc-action with the skill slug and a short evidence note.",
    },
    runtimeSkills: runtimeSkills.map((skill) => ({
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      version: skill.version,
      assignmentId: skill.assignmentId,
      description: skill.description,
    })),
    runtimeSlug: runtime?.runtime_slug ?? null,
    runtimeScope: runtime?.scope ?? null,
    runtimeDisplayName: runtime?.display_name ?? null,
    workspaceRoot,
    companyWorkspaceRoot: workspace.companyWorkspaceRoot,
    sourceWorkspaceRoot: workspace.sourceWorkspaceRoot,
    additionalWritableDirs: workspace.additionalWritableDirs,
    workspaceRunVisibility,
    taskEvidenceCommentCreated,
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    diagnostics: {
      ...result.diagnostics,
      stderrFilteredLineCount: filteredStderr.filteredLineCount,
    },
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutTail: trimForStorage(result.stdout, 4000),
    stderrTail: trimForStorage(evidenceStderr, 2000),
    resultText: result.stdout,
    transcriptEvents: [
      {
        kind: "run_start",
        role: "system",
        title: "Codex CLI command",
        body: `${path.basename(command)} exec --json --sandbox workspace-write --skip-git-repo-check --ephemeral --ignore-user-config${reasoningEffort ? ` -c model_reasoning_effort="${reasoningEffort}"` : ""}${appliedServiceTier === "fast" ? ` -c service_tier="fast"` : ""}${model ? ` --model ${model}` : ""}`,
        occurredAt: startedAt,
        metadata: {
          command,
          ephemeral: true,
          ignoreUserConfig: true,
          model: model || null,
          reasoningEffort: reasoningEffort || null,
          speedPreference: controls.speedPreference,
          fastMode: controls.fastMode,
          serviceTier: controls.serviceTier,
          serviceTierApplied: controls.serviceTierApplied,
          taskModelLane: input.taskModelRouting?.lane ?? "default",
          taskModelRoutingLabel: input.taskModelRouting?.label ?? "Default",
          workspaceRoot,
          sourceWorkspaceRoot: workspace.sourceWorkspaceRoot,
          additionalWritableDirs: workspace.additionalWritableDirs,
          runtimeSlug: runtime?.runtime_slug ?? null,
          runtimeScope: runtime?.scope ?? null,
          runtimeSkillCount: runtimeSkills.length,
          runtimeSkills: runtimeSkills.map((skill) => ({
            slug: skill.slug,
            name: skill.name,
            version: skill.version,
          })),
        },
      },
      ...lifecycleEvents,
      ...codexTelemetry.transcriptEvents,
      ...(stdoutTranscript.body && !telemetryHasAssistantText
        ? [{
            kind: "assistant_text_final",
            role: "assistant",
            title: codexTelemetry.structuredTelemetry ? "assistant final" : "stdout",
            body: stdoutTranscript.body,
            occurredAt: completedAt,
            metadata: {
              stream: codexTelemetry.structuredTelemetry ? "output-last-message" : "stdout",
              truncated: stdoutTranscript.truncated,
              rawLength: result.stdout.length,
            },
          }]
        : []),
      ...(stderrTranscript.body
        ? [{
            kind: effectiveOk ? "tool_result" : "error",
            role: effectiveOk ? "tool" : "error",
            title: "stderr",
            body: stderrTranscript.body,
            occurredAt: completedAt,
            metadata: {
              stream: "stderr",
              truncated: stderrTranscript.truncated,
              rawLength: evidenceStderr.length,
              filteredLineCount: filteredStderr.filteredLineCount,
            },
          }]
        : []),
      ...(emptySuccessfulOutput
        ? [{
            kind: "error",
            role: "error",
            title: "empty assistant output",
            body: effectiveErrorMessage,
            occurredAt: completedAt,
            metadata: {
              durationMs: result.durationMs,
              timedOutLikely,
              diagnostics: {
                ...result.diagnostics,
                stderrFilteredLineCount: filteredStderr.filteredLineCount,
              },
            },
          }]
        : []),
      {
        kind: "provider_event",
        role: "system",
        title: "Workspace visibility snapshot",
        body: `${workspaceRunVisibility.totals.changedDuringRunCount} file status change(s) during run; ${workspaceRunVisibility.totals.beforeDirtyCount} dirty before, ${workspaceRunVisibility.totals.afterDirtyCount} dirty after.`,
        occurredAt: completedAt,
        metadata: {
          readOnlyIntent: workspaceRunVisibility.readOnlyIntent,
          warnings: workspaceRunVisibility.warnings,
          totals: workspaceRunVisibility.totals,
        },
      },
      {
        kind: effectiveOk ? "run_end" : "run_error",
        role: "system",
        title: effectiveOk ? "Codex completed" : "Codex failed",
        body: effectiveOk
          ? `Codex completed in ${formatDuration(result.durationMs)}.`
          : effectiveErrorMessage || `Codex failed with exit code ${result.exitCode ?? "unknown"}.`,
        occurredAt: completedAt,
        metadata: {
          exitCode: result.exitCode,
          signal: result.signal,
          durationMs: result.durationMs,
          diagnostics: {
            ...result.diagnostics,
            stderrFilteredLineCount: filteredStderr.filteredLineCount,
          },
        },
      },
    ],
    note: "Codex CLI runs through codex exec --json when available. HiveRunner persists normalized JSON events as transcript evidence and falls back to the final message/stdout path for older or quiet CLIs; exact token/cost detail depends on the event payloads Codex emits.",
  };

  if (!effectiveOk) {
    return {
      error: effectiveErrorMessage || `codex exec failed with exit code ${result.exitCode ?? "unknown"}`,
      runnerProvider: "codex",
      runnerModel: model || null,
      usage,
    };
  }

  return {
    messageCountBefore: 0,
    runnerProvider: "codex",
    runnerModel: model || null,
    usage,
  };
}

function clearTaskSessionForSelfHeal(
  db: Database.Database,
  input: ExecutionSelfHealInput,
): void {
  try {
    db.prepare(
      `UPDATE agent_task_sessions
       SET session_params_json = '{}',
           session_display_id = NULL,
           last_error = ?,
           updated_at = ?
       WHERE company_id = ?
         AND agent_id = ?
         AND adapter_type = 'codex'
         AND task_key = ?`,
    ).run(
      `self_heal:${input.reason}`,
      new Date().toISOString(),
      input.companyId,
      input.agentId,
      input.taskKey,
    );
  } catch (err) {
    console.warn(
      `[engine:runtime] failed to clear codex task session for ${input.agentId}/${input.taskKey} (${input.reason}):`,
      err,
    );
  }
}

async function cancelByPid(pid: number | null): Promise<CancelAdapterResult> {
  if (pid === null) return { killed: false, method: "no-op:pid-null" };
  try { process.kill(pid, 0); } catch { return { killed: false, method: "no-op:already-exited" }; }
  try { process.kill(pid, "SIGTERM"); } catch (e) { return { killed: false, method: "SIGTERM", error: String(e) }; }
  await new Promise((r) => setTimeout(r, CANCEL_SIGKILL_GRACE_MS));
  try {
    process.kill(pid, 0);
    try { process.kill(pid, "SIGKILL"); } catch {}
    return { killed: true, method: "SIGTERM+SIGKILL" };
  } catch {
    return { killed: true, method: "SIGTERM" };
  }
}

export const codexExecutionAdapter: ExecutionAdapter = {
  adapterType: "codex",
  execute,
  clearTaskSessionForSelfHeal,
  cancel: (_runId, pid) => cancelByPid(pid),
};
