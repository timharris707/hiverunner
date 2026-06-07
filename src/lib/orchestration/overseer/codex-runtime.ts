import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import {
  appendOverseerMessage,
  buildDeterministicOverseerSummary,
  completeOverseerTurn,
  createApprovalsForOverseerActions,
  createOverseerTurn,
  decideOverseerCompaction,
  getOverseerSession,
  getOverseerSettings,
  latestOverseerCompactedSummary,
  listOverseerEvents,
  listOverseerMessages,
  recordOverseerEvent,
  requestOverseerSessionCompaction,
  setOverseerTurnCodexSessionId,
  setOverseerTurnProcess,
} from "./service";
import type {
  OverseerCodexEvent,
  OverseerCodexRunResult,
  OverseerCodexSessionTelemetry,
  OverseerQuotaSnapshot,
  OverseerUsageSnapshot,
} from "./types";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const codexSessionFileCache = new Map<string, string>();
const codexSessionTelemetryCache = new Map<string, {
  filePath: string;
  mtimeMs: number;
  size: number;
  telemetry: OverseerCodexSessionTelemetry | null;
}>();

type GitDiffSnapshot = {
  files: Map<string, { additions: number; deletions: number }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeRecord(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function stringFrom(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberFrom(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numberFrom(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringFrom(record[key]);
    if (value) return value;
  }
  return undefined;
}

function firstTimestampIso(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const date = new Date(raw > 10_000_000_000 ? raw : raw * 1000);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
    if (typeof raw === "string" && raw.trim()) {
      const numeric = Number(raw);
      const date = Number.isFinite(numeric)
        ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
        : new Date(raw);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
  }
  return undefined;
}

function mergeUsage(base: OverseerUsageSnapshot, next: OverseerUsageSnapshot): OverseerUsageSnapshot {
  const max = (a?: number, b?: number) => b === undefined ? a : a === undefined ? b : Math.max(a, b);
  return {
    inputTokens: max(base.inputTokens, next.inputTokens),
    outputTokens: max(base.outputTokens, next.outputTokens),
    cacheReadInputTokens: max(base.cacheReadInputTokens, next.cacheReadInputTokens),
    cacheCreationInputTokens: max(base.cacheCreationInputTokens, next.cacheCreationInputTokens),
    totalTokens: max(base.totalTokens, next.totalTokens),
  };
}

function supportsCodexFastTier(model: string | null | undefined): boolean {
  const normalized = normalizeCodexModelArg(model);
  return normalized === "gpt-5.5" || normalized === "gpt-5.4";
}

function normalizeCodexModelArg(model: string | null | undefined): string | null {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  return normalized
    .replace(/^openai-codex\//, "")
    .replace(/^openai\//, "")
    .replace(/^codex\//, "");
}

function quotaBucketFromRecord(label: string, record: Record<string, unknown>): NonNullable<OverseerQuotaSnapshot["buckets"]>[number] | null {
  const usedPercent = firstNumber(record, ["usedPercent", "used_percent"]);
  const resetsAt = firstTimestampIso(record, ["resetsAt", "resets_at"]);
  const windowDurationMins = firstNumber(record, ["windowDurationMins", "window_duration_mins", "windowMinutes", "window_minutes"]);
  if (usedPercent === undefined && !resetsAt && windowDurationMins === undefined) return null;
  const normalizedLabel = windowDurationMins && windowDurationMins >= 10080
    ? "Weekly limit"
    : windowDurationMins === 300
      ? "5h limit"
    : label.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    label: normalizedLabel,
    usedPercent,
    resetsAt,
    windowDurationMins,
  };
}

function quotaBucketsFromValue(value: unknown, label = "Subscription"): NonNullable<OverseerQuotaSnapshot["buckets"]> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => quotaBucketsFromValue(entry, `${label} ${index + 1}`));
  }
  const record = asRecord(value);
  if (!record) return [];

  const direct = quotaBucketFromRecord(firstString(record, ["label", "name", "limit_name"]) ?? label, record);
  if (direct) return [direct];

  const buckets: NonNullable<OverseerQuotaSnapshot["buckets"]> = [];
  for (const [key, nested] of Object.entries(record)) {
    const nestedRecord = asRecord(nested);
    if (!nestedRecord) continue;
    const bucket = quotaBucketFromRecord(firstString(nestedRecord, ["label", "name", "limit_name"]) ?? key, nestedRecord);
    if (bucket) buckets.push(bucket);
    else buckets.push(...quotaBucketsFromValue(nestedRecord, key));
  }
  return buckets;
}

function quotaFromRecord(record: Record<string, unknown>, depth = 0): OverseerQuotaSnapshot | undefined {
  if (depth > 4) return undefined;
  const buckets = quotaBucketsFromValue(record.rate_limits ?? record.rateLimits);
  if (buckets.length > 0) {
    return {
      status: "available",
      updatedAt: new Date().toISOString(),
      buckets,
    };
  }
  for (const key of ["usage", "token_usage", "tokenUsage", "metrics", "data", "event", "message", "result"] as const) {
    const nested = asRecord(record[key]);
    if (!nested) continue;
    const quota = quotaFromRecord(nested, depth + 1);
    if (quota) return quota;
  }
  return undefined;
}

function usageFromRecord(record: Record<string, unknown>, depth = 0): OverseerUsageSnapshot {
  if (depth > 4) return {};
  let usage: OverseerUsageSnapshot = {
    inputTokens: firstNumber(record, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]),
    outputTokens: firstNumber(record, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]),
    cacheReadInputTokens: firstNumber(record, ["cacheReadInputTokens", "cache_read_input_tokens", "cachedInputTokens", "cached_input_tokens"]),
    cacheCreationInputTokens: firstNumber(record, ["cacheCreationInputTokens", "cache_creation_input_tokens", "cacheWriteTokens", "cache_write_tokens"]),
    totalTokens: firstNumber(record, ["totalTokens", "total_tokens"]),
  };
  for (const key of ["usage", "token_usage", "tokenUsage", "metrics", "data", "event", "message", "result"] as const) {
    const nested = asRecord(record[key]);
    if (nested) usage = mergeUsage(usage, usageFromRecord(nested, depth + 1));
  }
  if (usage.totalTokens === undefined && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) {
    usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  return usage;
}

function threadIdFromRecord(record: Record<string, unknown>): string | null {
  const direct = stringFrom(record.thread_id) || stringFrom(record.threadId) || stringFrom(record.session_id) || stringFrom(record.sessionId);
  if (direct) return direct;
  const thread = asRecord(record.thread);
  if (thread) {
    const nested = stringFrom(thread.id) || stringFrom(thread.thread_id);
    if (nested) return nested;
  }
  return null;
}

function textFromRecord(record: Record<string, unknown>): string {
  const direct = stringFrom(record.text) || stringFrom(record.delta) || stringFrom(record.output) || stringFrom(record.content);
  if (direct) return direct;
  const message = asRecord(record.message);
  if (message) {
    const nested = stringFrom(message.text) || stringFrom(message.content);
    if (nested) return nested;
  }
  const item = asRecord(record.item);
  if (item) {
    const nested = stringFrom(item.text) || stringFrom(item.content);
    if (nested) return nested;
  }
  return "";
}

function classifyEventType(record: Record<string, unknown>): string {
  return stringFrom(record.type) || stringFrom(record.event) || "codex.event";
}

function shouldAppendAssistantText(type: string): boolean {
  return /assistant|message|response|final|text\.delta|text_delta/i.test(type)
    && !/tool|reasoning|thinking/i.test(type);
}

function readGitDiffSnapshot(workspaceRoot: string): GitDiffSnapshot | null {
  const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: 5000,
  });
  if (probe.status !== 0 || probe.stdout.trim() !== "true") return null;

  const diff = spawnSync("git", ["diff", "--numstat"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  if (diff.status !== 0) return null;

  const files = new Map<string, { additions: number; deletions: number }>();
  for (const line of diff.stdout.split(/\r?\n/)) {
    const [additionsRaw, deletionsRaw, ...pathParts] = line.split("\t");
    const filePath = pathParts.join("\t").trim();
    if (!filePath) continue;
    const additions = numberFrom(additionsRaw);
    const deletions = numberFrom(deletionsRaw);
    files.set(filePath, {
      additions: additions ?? 0,
      deletions: deletions ?? 0,
    });
  }
  return { files };
}

function diffSnapshots(before: GitDiffSnapshot | null, after: GitDiffSnapshot | null): {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: Array<{ path: string; additions: number; deletions: number }>;
} | null {
  if (!before || !after) return null;
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  const files: Array<{ path: string; additions: number; deletions: number }> = [];
  let additions = 0;
  let deletions = 0;

  for (const filePath of paths) {
    const previous = before.files.get(filePath) ?? { additions: 0, deletions: 0 };
    const current = after.files.get(filePath) ?? { additions: 0, deletions: 0 };
    if (previous.additions === current.additions && previous.deletions === current.deletions) continue;
    const added = Math.max(0, current.additions - previous.additions);
    const deleted = Math.max(0, current.deletions - previous.deletions);
    additions += added;
    deletions += deleted;
    files.push({ path: filePath, additions: added, deletions: deleted });
  }

  if (files.length === 0) return null;
  return {
    filesChanged: files.length,
    additions,
    deletions,
    files,
  };
}

function buildPrompt(input: {
  userMessage: string;
  workspaceRoot: string;
  isResume: boolean;
  fastMode?: boolean;
  compactedSummary?: string | null;
}): string {
  return [
    "You are HiveRunner Overseer running inside the HiveRunner product cockpit.",
    "Use concise operator-facing answers. Ask clarifying questions when needed.",
    input.fastMode ? "Fast Mode is enabled for this session: prioritize shorter check-ins and low-latency investigation paths when that does not reduce correctness." : "Fast Mode is off for this session.",
    "Do not directly perform state-changing HiveRunner actions. When you want to create tasks, update tasks, hire agents, register artifacts, review candidates, mark goals complete, or otherwise mutate HiveRunner state, emit a fenced ```mc-action JSON block. HiveRunner will request approval before executing state-changing actions.",
    "Read-only analysis and reports are allowed. The working root shown below is the bound company/project workspace, not the HiveRunner app repository.",
    `Workspace root: ${input.workspaceRoot}`,
    input.isResume ? "This is a follow-up turn in an existing Codex session." : "This is the first turn in a new Codex session.",
    input.compactedSummary
      ? [
          "",
          "Compacted session summary to preserve before answering:",
          input.compactedSummary,
        ].join("\n")
      : "",
    "",
    "Operator message:",
    input.userMessage,
  ].filter((line) => line !== "").join("\n");
}

export function detectCodexStatus(command = "codex"): {
  command: string;
  installed: boolean;
  version: string | null;
  authReady: boolean;
  authMode: "chatgpt" | "api_key" | "unknown" | "missing";
  loginStatus: string;
  error?: string;
} {
  const version = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0) {
    return {
      command,
      installed: false,
      version: null,
      authReady: false,
      authMode: "missing",
      loginStatus: "Codex CLI not found",
      error: version.error?.message || version.stderr?.trim() || "Codex CLI not found",
    };
  }
  const login = spawnSync(command, ["login", "status"], { encoding: "utf8" });
  const loginStatus = `${login.stdout ?? ""}${login.stderr ? `\n${login.stderr}` : ""}`.trim();
  const lower = loginStatus.toLowerCase();
  const chatgpt = lower.includes("chatgpt");
  const apiKey = lower.includes("api key") || lower.includes("api-key") || lower.includes("openai api");
  const authReady = login.status === 0 && (chatgpt || apiKey || lower.includes("logged in"));
  return {
    command,
    installed: true,
    version: version.stdout.trim() || version.stderr.trim() || null,
    authReady,
    authMode: chatgpt ? "chatgpt" : apiKey ? "api_key" : authReady ? "unknown" : "missing",
    loginStatus: loginStatus || (authReady ? "Logged in" : "Not logged in"),
    error: login.status === 0 ? undefined : login.stderr?.trim() || undefined,
  };
}

export function detectCodexModelCatalog(command = "codex"): Array<{
  slug: string;
  displayName: string;
  contextWindow: number | null;
  maxContextWindow: number | null;
  effectiveContextWindowPercent: number | null;
  additionalSpeedTiers: string[];
}> {
  const result = spawnSync(command, ["debug", "models"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return [];
  const parsed = safeRecord(result.stdout);
  const models = Array.isArray(parsed?.models) ? parsed.models : [];
  return models.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const slug = stringFrom(record.slug);
    if (!slug) return [];
    return [{
      slug,
      displayName: stringFrom(record.display_name) || slug,
      contextWindow: firstNumber(record, ["context_window", "contextWindow"]) ?? null,
      maxContextWindow: firstNumber(record, ["max_context_window", "maxContextWindow"]) ?? null,
      effectiveContextWindowPercent: firstNumber(record, ["effective_context_window_percent", "effectiveContextWindowPercent"]) ?? null,
      additionalSpeedTiers: Array.isArray(record.additional_speed_tiers)
        ? record.additional_speed_tiers.flatMap((tier) => stringFrom(tier) ? [stringFrom(tier)] : [])
        : [],
    }];
  });
}

function findCodexSessionFile(sessionId: string): string | null {
  const safeSessionId = sessionId.trim();
  if (!safeSessionId || /[/\\]/.test(safeSessionId)) return null;
  if (codexSessionFileCache.has(safeSessionId)) {
    const cached = codexSessionFileCache.get(safeSessionId);
    if (cached && fs.existsSync(cached)) return cached;
    codexSessionFileCache.delete(safeSessionId);
  }
  const sessionsRoot = path.join(os.homedir(), ".codex", "sessions");
  if (!fs.existsSync(sessionsRoot)) return null;
  const stack = [sessionsRoot];
  let visited = 0;
  while (stack.length > 0 && visited < 20_000) {
    const current = stack.pop()!;
    visited += 1;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl") && entry.name.includes(safeSessionId)) {
        codexSessionFileCache.set(safeSessionId, fullPath);
        return fullPath;
      }
    }
  }
  return null;
}

function tokenCountTelemetryFromRecord(
  record: Record<string, unknown>,
  sessionId: string,
  updatedAt: string,
): OverseerCodexSessionTelemetry | null {
  const payload = asRecord(record.payload);
  const payloadType = stringFrom(payload?.type);
  const recordType = stringFrom(record.type);
  if (payloadType !== "token_count" && recordType !== "token_count") return null;

  const info = asRecord(payload?.info) ?? asRecord(record.info) ?? {};
  const lastTokenUsage = asRecord(info.last_token_usage) ?? asRecord(info.lastTokenUsage) ?? {};
  const totalTokenUsage = asRecord(info.total_token_usage) ?? asRecord(info.totalTokenUsage) ?? {};
  const usedTokens = firstNumber(lastTokenUsage, ["input_tokens", "inputTokens"]) ?? null;
  const limitTokens = firstNumber(info, ["model_context_window", "modelContextWindow", "context_window", "contextWindow"]) ?? null;
  const totalTokens = firstNumber(lastTokenUsage, ["total_tokens", "totalTokens"]) ?? null;
  const cumulativeTotalTokens = firstNumber(totalTokenUsage, ["total_tokens", "totalTokens"]) ?? null;
  const quota = quotaFromRecord({
    rate_limits: payload?.rate_limits ?? payload?.rateLimits ?? record.rate_limits ?? record.rateLimits,
  }) ?? {
    status: "unavailable",
    reason: "Codex token-count event did not include rate-limit telemetry.",
    updatedAt,
  };

  return {
    sessionId,
    source: "codex_session_file",
    updatedAt,
    context: {
      usedTokens,
      limitTokens,
      totalTokens,
      cumulativeTotalTokens,
    },
    quota,
  };
}

export function readCodexSessionTelemetry(sessionId: string | null | undefined): OverseerCodexSessionTelemetry | null {
  if (!sessionId?.trim()) return null;
  const filePath = findCodexSessionFile(sessionId);
  if (!filePath) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const cached = codexSessionTelemetryCache.get(sessionId);
  if (cached && cached.filePath === filePath && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.telemetry;
  }
  let lines: string[];
  try {
    lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }

  let latest: OverseerCodexSessionTelemetry | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const record = safeRecord(line);
    if (!record) continue;
    const updatedAt = stringFrom(record.timestamp) || new Date().toISOString();
    const telemetry = tokenCountTelemetryFromRecord(record, sessionId, updatedAt);
    if (telemetry) latest = telemetry;
  }
  codexSessionTelemetryCache.set(sessionId, {
    filePath,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    telemetry: latest,
  });
  return latest;
}

function runCodexProcess(input: {
  command: string;
  sessionId: string;
  turnId: string;
  prompt: string;
  workspaceRoot: string;
  codexSessionId: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  fastMode?: boolean;
}): Promise<OverseerCodexRunResult> {
  const started = Date.now();
  const beforeDiff = readGitDiffSnapshot(input.workspaceRoot);
  const timeoutMs = Number.parseInt(process.env.MC_OVERSEER_CODEX_TIMEOUT_MS ?? "", 10) || DEFAULT_TIMEOUT_MS;
  const outputFile = path.join(os.tmpdir(), `hiverunner-overseer-${input.turnId}.txt`);
  const args = input.codexSessionId
    ? ["exec", "resume", "--json", "--skip-git-repo-check", "-o", outputFile]
    : ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-C", input.workspaceRoot, "-o", outputFile];
  const modelArg = normalizeCodexModelArg(input.model);

  if (modelArg) args.push("-m", modelArg);
  if (input.reasoningEffort) args.push("-c", `model_reasoning_effort="${input.reasoningEffort}"`);
  if (input.fastMode && supportsCodexFastTier(modelArg ?? "gpt-5.5")) args.push("-c", `service_tier="fast"`);

  if (input.codexSessionId) {
    args.push(input.codexSessionId, "-");
  } else {
    args.push("-");
  }

  return new Promise((resolve) => {
    const child = spawn(input.command, args, {
      cwd: input.workspaceRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    setOverseerTurnProcess({ sessionId: input.sessionId, turnId: input.turnId, pid: child.pid ?? null });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const events: OverseerCodexEvent[] = [];
    let buffer = "";
    let usage: OverseerUsageSnapshot = {};
    let quota: OverseerQuotaSnapshot | undefined;
    let threadId: string | null = input.codexSessionId;
    let assistantText = "";
    let bufferedBytes = 0;
    let settled = false;
    let timedOut = false;
    let killedForBuffer = false;
    let spawnError: Error | null = null;

    const ingestLine = (lineRaw: string) => {
      const line = lineRaw.trim();
      if (!line) return;
      const record = safeRecord(line);
      if (!record) return;
      const occurredAt = new Date().toISOString();
      const type = classifyEventType(record);
      events.push({ type, record, occurredAt });
      try {
        recordOverseerEvent({
          sessionId: input.sessionId,
          turnId: input.turnId,
          eventType: type,
          event: record,
          occurredAt,
        });
      } catch {
        // Event persistence should not break a running Codex turn.
      }
      usage = mergeUsage(usage, usageFromRecord(record));
      quota = quotaFromRecord(record) ?? quota;
      const nextThreadId = threadIdFromRecord(record);
      if (nextThreadId && nextThreadId !== threadId) {
        threadId = nextThreadId;
        try {
          setOverseerTurnCodexSessionId({
            sessionId: input.sessionId,
            turnId: input.turnId,
            codexSessionId: nextThreadId,
          });
        } catch {
          // Session-id persistence should not interrupt a running Codex turn.
        }
      } else {
        threadId = nextThreadId ?? threadId;
      }
      const text = textFromRecord(record);
      if (text && shouldAppendAssistantText(type)) {
        assistantText = assistantText ? `${assistantText}\n${text}` : text;
      }
    };

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setOverseerTurnProcess({ sessionId: input.sessionId, turnId: input.turnId, pid: null });
      if (buffer.trim()) ingestLine(buffer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      let outputText = "";
      try {
        outputText = fs.readFileSync(outputFile, "utf8").trim();
      } catch {
        outputText = "";
      }
      try {
        fs.rmSync(outputFile, { force: true });
      } catch {
        // best effort cleanup
      }
      const finalText = outputText || assistantText || "";
      const errorMessage = spawnError?.message
        ?? (timedOut ? `Codex timed out after ${timeoutMs}ms` : null)
        ?? (killedForBuffer ? `Codex output exceeded ${MAX_BUFFER_BYTES} bytes` : null)
        ?? (exitCode && exitCode !== 0 ? stderr.trim() || `Codex exited with ${exitCode}` : null);
      const diff = diffSnapshots(beforeDiff, readGitDiffSnapshot(input.workspaceRoot));
      if (diff) {
        try {
          recordOverseerEvent({
            sessionId: input.sessionId,
            turnId: input.turnId,
            eventType: "workspace.diff",
            event: diff,
          });
        } catch {
          // Diff telemetry should not break a completed Codex turn.
        }
      }
      resolve({
        ok: exitCode === 0 && !spawnError && !timedOut && !killedForBuffer,
        exitCode,
        signal,
        durationMs: Date.now() - started,
        threadId,
        assistantText: finalText,
        usage,
        quota,
        events,
        stdout,
        stderr,
        errorMessage,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 5000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      bufferedBytes += chunk.length;
      if (bufferedBytes > MAX_BUFFER_BYTES) {
        killedForBuffer = true;
        child.kill("SIGTERM");
        return;
      }
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) ingestLine(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      bufferedBytes += chunk.length;
      if (bufferedBytes > MAX_BUFFER_BYTES) {
        killedForBuffer = true;
        child.kill("SIGTERM");
      }
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", finish);
    child.stdin.end(input.prompt);
  });
}

export async function runOverseerCodexTurn(input: {
  sessionId: string;
  userMessageId: string;
  userMessage: string;
  command?: string;
}): Promise<{
  session: ReturnType<typeof getOverseerSession>;
  turnId: string;
  assistantMessageId: string | null;
  approvalIds: string[];
  ok: boolean;
}> {
  let session = getOverseerSession(input.sessionId);
  const settings = getOverseerSettings(session.companyId).settings;
  if (session.codexSessionId) {
    const telemetry = readCodexSessionTelemetry(session.codexSessionId);
    const decision = decideOverseerCompaction({ session, settings, telemetry });
    if (decision.shouldCompact) {
      recordOverseerEvent({
        sessionId: session.id,
        eventType: "codex.compaction.requested",
        event: {
          codexSessionId: session.codexSessionId,
          decision,
        },
      });
      const summary = buildDeterministicOverseerSummary({
        session,
        messages: listOverseerMessages(session.id).messages,
        events: listOverseerEvents(session.id).events,
        decision,
      });
      requestOverseerSessionCompaction({
        sessionId: session.id,
        summary: summary.summary,
        source: decision.context.percent === null ? "manual" : "auto",
        reason: decision.reason,
        metadata: {
          strategy: summary.strategy,
          limitation: summary.limitation,
          sourceCodexSessionId: summary.sourceCodexSessionId,
          context: summary.context,
        },
        requestedBy: "overseer-runtime",
      });
      session = getOverseerSession(session.id);
    }
  }
  const isResume = Boolean(session.codexSessionId);
  const prompt = buildPrompt({
    userMessage: input.userMessage,
    workspaceRoot: session.workspaceRoot,
    isResume,
    fastMode: session.scope.fastMode === true,
    compactedSummary: latestOverseerCompactedSummary(session),
  });
  const turn = createOverseerTurn({
    sessionId: session.id,
    userMessageId: input.userMessageId,
    prompt,
  });
  recordOverseerEvent({
    sessionId: session.id,
    turnId: turn.id,
    eventType: isResume ? "codex.resume.started" : "codex.exec.started",
    event: {
      codexSessionId: session.codexSessionId,
      workspaceRoot: session.workspaceRoot,
      fastMode: session.scope.fastMode === true,
    },
  });

  const result = await runCodexProcess({
    command: input.command ?? "codex",
    sessionId: session.id,
    turnId: turn.id,
    prompt,
    workspaceRoot: session.workspaceRoot,
    codexSessionId: session.codexSessionId,
    model: session.model,
    reasoningEffort: session.reasoningEffort,
    fastMode: session.scope.fastMode === true,
  });

  const assistant = result.assistantText.trim()
    ? appendOverseerMessage({
        sessionId: session.id,
        turnId: turn.id,
        role: "assistant",
        content: result.assistantText.trim(),
        metadata: {
          codexSessionId: result.threadId,
          usage: result.usage,
          exitCode: result.exitCode,
          signal: result.signal,
        },
      })
    : null;

  const approvals = assistant
    ? createApprovalsForOverseerActions({
        session: getOverseerSession(session.id),
        turnId: turn.id,
        messageId: assistant.id,
        assistantText: assistant.content,
      })
    : { approvalIds: [], safeActions: 0, parseErrors: [] };

  if (approvals.approvalIds.length > 0) {
    appendOverseerMessage({
      sessionId: session.id,
      turnId: turn.id,
      role: "approval",
      content: `${approvals.approvalIds.length} state-changing Overseer action${approvals.approvalIds.length === 1 ? "" : "s"} require approval before execution.`,
      metadata: { approvalIds: approvals.approvalIds },
    });
  }

  const status = result.ok
    ? approvals.approvalIds.length > 0 ? "approval_required" : "completed"
    : "failed";
  const completed = completeOverseerTurn({
    sessionId: session.id,
    turnId: turn.id,
    status,
    assistantMessageId: assistant?.id ?? null,
    codexSessionId: result.threadId,
    usage: result.usage,
    quota: result.quota,
    errorMessage: result.errorMessage,
    durationMs: result.durationMs,
  });

  return {
    session: completed.session,
    turnId: turn.id,
    assistantMessageId: assistant?.id ?? null,
    approvalIds: approvals.approvalIds,
    ok: result.ok,
  };
}
