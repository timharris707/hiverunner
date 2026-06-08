#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildExternalRunnerEnv,
  numberFrom,
  numberFromEnv,
  readStdin,
  runBufferedCommand,
  splitCommandLine,
  stringFrom,
} from "./lib/external-runner-utils.mjs";

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const DEFAULT_CODEX_NO_OUTPUT_TIMEOUT_MS = 90 * 1000;
const DEFAULT_CODEX_PROGRESS_INTERVAL_MS = 30 * 1000;
const DEFAULT_CODEX_TERMINATION_GRACE_MS = 5 * 1000;
const RUNNER_VERSION = "hiverunner-symphony-runner 0.1.0";
const LIVE_EVENT_SCHEMA = "hiverunner.external-runner.live-event.v1";
const LIVE_EVENT_PREFIX = "::hiverunner-live-event ";
const DEFAULT_LIVE_EVENT_LIMIT = 200;
const USAGE_CONTAINER_KEYS = ["usage", "token_usage", "tokenUsage", "metrics", "data", "event", "message", "result"];

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(RUNNER_VERSION);
  process.exit(0);
}

function firstNumberFromRecord(record, keys) {
  for (const key of keys) {
    const value = numberFrom(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function mergeUsageValue(current, next) {
  if (next === undefined) return current;
  if (current === undefined) return next;
  return Math.max(current, next);
}

function mergeUsage(base, next) {
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

function usageSnapshotFromRecord(record) {
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

function usageWithDerivedTotal(usage) {
  if (!usage.totalTokens && (usage.inputTokens || usage.outputTokens)) {
    return {
      ...usage,
      totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    };
  }
  return usage;
}

function usageFromArray(value, depth) {
  return value.reduce((usage, item) => mergeUsage(usage, extractUsage(item, depth + 1)), {});
}

function nestedUsageFromRecord(record, depth) {
  return USAGE_CONTAINER_KEYS.reduce(
    (usage, key) => mergeUsage(usage, extractUsage(record[key], depth + 1)),
    usageSnapshotFromRecord(record),
  );
}

function extractUsage(value, depth = 0) {
  if (depth > 4) return {};
  if (Array.isArray(value)) return usageWithDerivedTotal(usageFromArray(value, depth));
  const record = asRecord(value);
  if (!record) return {};
  return usageWithDerivedTotal(nestedUsageFromRecord(record, depth));
}

function numberFromEnvNames(names, fallback) {
  for (const name of names) {
    const parsed = Number.parseInt(process.env[name] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function normalizeCodexCliModel(value) {
  const model = stringFrom(value)
    .replace(/^openai-codex\//i, "")
    .replace(/^openai\//i, "")
    .replace(/^codex\//i, "")
    .trim();
  if (!model) return "";
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

function resolveCodexModel(payload) {
  const envModel = stringFrom(process.env.HIVERUNNER_SYMPHONY_MODEL);
  if (envModel) return normalizeCodexCliModel(envModel);
  return normalizeCodexCliModel(stringFrom(payload.runnerModel));
}

function unquoteTomlString(value) {
  const text = String(value ?? "").trim();
  const quoted = text.match(/^"((?:[^"\\]|\\.)*)"$/) || text.match(/^'([^']*)'$/);
  if (!quoted) return text;
  return quoted[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function profileSectionNames(profile) {
  const name = stringFrom(profile);
  if (!name) return new Set();
  return new Set([
    `profiles.${name}`,
    `profiles."${name}"`,
    `profiles.'${name}'`,
  ]);
}

async function readCodexConfigText() {
  const candidates = [
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "config.toml") : "",
    process.env.HOME ? path.join(process.env.HOME, ".codex", "config.toml") : "",
    path.join(os.homedir(), ".codex", "config.toml"),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      return await readFile(file, "utf8");
    } catch {
      // Try the next known Codex config location.
    }
  }
  return "";
}

async function readCodexConfiguredModel(profile) {
  const text = await readCodexConfigText();
  if (!text) return "";
  const wantedProfileSections = profileSectionNames(profile);
  let section = "";
  let globalModel = "";
  let profileModel = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    const modelMatch = line.match(/^model\s*=\s*(.+)$/);
    if (!modelMatch) continue;
    const value = normalizeCodexCliModel(unquoteTomlString(modelMatch[1].replace(/\s+#.*$/, "")));
    if (!value) continue;
    if (!section) globalModel = value;
    if (wantedProfileSections.has(section)) profileModel = value;
  }

  return profileModel || globalModel;
}

async function resolveActualCodexModel(payload) {
  // `codex exec` can deliberately omit --model so the CLI uses the operator's
  // configured default. HiveRunner still needs audit truth, so infer that
  // default from Codex config when no explicit route model is present.
  return resolveCodexModel(payload) || await readCodexConfiguredModel(process.env.HIVERUNNER_SYMPHONY_PROFILE);
}

function parseJsonLine(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function extractText(value, depth = 0) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item, depth + 1)).filter(Boolean).join("\n").trim();
  }
  if (depth > 6) return "";
  if (!value || typeof value !== "object") return "";
  const record = value;
  for (const key of [
    "text",
    "message",
    "content",
    "summary",
    "summaryText",
    "output_text",
    "output",
    "aggregated_output",
    "stdout",
    "stderr",
    "result",
    "delta",
    "command",
  ]) {
    const direct = stringFrom(record[key]);
    if (direct) return direct;
  }

  for (const key of ["message", "item", "event", "delta", "content", "output", "tool_call", "toolCall", "function"]) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const text = extractText(nested, depth + 1);
      if (text) return text;
    }
  }

  return "";
}

function codexEventType(record) {
  return stringFrom(record.type) || stringFrom(record.event) || stringFrom(record.kind) || "codex_event";
}

function codexItem(record) {
  return asRecord(record.item) || asRecord(record.message) || asRecord(record.event);
}

function codexItemType(record) {
  const item = codexItem(record);
  return item ? stringFrom(item.type) || stringFrom(item.kind) || stringFrom(item.name) : "";
}

function codexSessionId(record) {
  if (!record) return "";
  const item = codexItem(record);
  return (
    stringFrom(record.session_id) ||
    stringFrom(record.sessionId) ||
    stringFrom(record.thread_id) ||
    stringFrom(record.threadId) ||
    stringFrom(item?.session_id) ||
    stringFrom(item?.sessionId) ||
    stringFrom(item?.thread_id) ||
    stringFrom(item?.threadId)
  );
}

function codexToolName(record) {
  const item = codexItem(record);
  return (
    stringFrom(record.tool_name) ||
    stringFrom(record.toolName) ||
    stringFrom(record.name) ||
    stringFrom(record.command) ||
    stringFrom(item?.tool_name) ||
    stringFrom(item?.toolName) ||
    stringFrom(item?.name) ||
    stringFrom(item?.command) ||
    codexItemType(record) ||
    codexEventType(record)
  );
}

function codexEventFromRecord(record) {
  const type = codexEventType(record);
  const itemType = codexItemType(record);
  const lowerType = type.toLowerCase();
  const lowerItemType = itemType.toLowerCase();
  const body = trimForLiveEvent(extractText(record));
  const sessionId = codexSessionId(record);
  const metadata = {
    runnerProvider: "codex",
    source: "codex-stdout",
    codexEventType: type || null,
    codexItemType: itemType || null,
    sessionId: sessionId || null,
  };

  if (lowerType === "thread.started" || lowerType === "session") {
    return {
      kind: "provider_event",
      role: "system",
      title: "Codex session started",
      body: body || (sessionId ? `Codex session ${sessionId} started.` : "Codex session started."),
      metadata,
    };
  }

  if (lowerType === "turn.started") {
    return {
      kind: "provider_event",
      role: "system",
      title: "Codex turn started",
      body: body || "Codex turn started.",
      metadata,
    };
  }

  if (lowerType === "turn.completed") {
    return {
      kind: "provider_event",
      role: "system",
      title: "Codex turn completed",
      body: body || "Codex turn completed.",
      metadata,
    };
  }

  if (lowerType === "item.started" && /(command|tool|exec|shell|terminal|function)/i.test(lowerItemType)) {
    const toolName = codexToolName(record);
    return {
      kind: "tool_call_start",
      role: "tool",
      title: toolName || "Codex tool call",
      body: body || `Codex started ${toolName || itemType || "a tool call"}.`,
      metadata,
    };
  }

  if (lowerType === "item.completed" && /(command|tool|exec|shell|terminal|function)/i.test(lowerItemType)) {
    const toolName = codexToolName(record);
    return {
      kind: "tool_result",
      role: "tool",
      title: toolName || "Codex tool result",
      body: body || `Codex completed ${toolName || itemType || "a tool call"}.`,
      metadata,
    };
  }

  if (lowerItemType === "agent_message" || lowerItemType === "assistant_message") {
    if (!body) return null;
    return {
      kind: lowerType.includes("completed") ? "assistant_text_final" : "assistant_text_delta",
      role: "assistant",
      title: lowerType.includes("completed") ? "Codex assistant final" : "Codex assistant text",
      body,
      metadata,
    };
  }

  if (/(reason|thinking|thought)/i.test(`${lowerType} ${lowerItemType}`)) {
    if (!body) return null;
    return {
      kind: "thinking_summary",
      role: "assistant",
      title: "Codex thinking summary",
      body,
      metadata,
    };
  }

  const role = stringFrom(record.role) || (body ? "assistant" : "system");
  if (body && (role === "assistant" || type === "message" || type === "assistant")) {
    return {
      kind: "assistant_text_delta",
      role: "assistant",
      title: "Codex assistant text",
      body,
      metadata,
    };
  }

  if (!body && !sessionId && type !== "session") return null;
  return {
    kind: "provider_event",
    role,
    title: type === "session" ? "Codex session started" : "Codex event",
    body: body || (sessionId ? `Codex session ${sessionId} started.` : type || "Codex event"),
    metadata,
  };
}

function trimForLiveEvent(value, maxChars = 4000) {
  const text = stringFrom(value);
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

function emitRunnerLiveEvent(event) {
  try {
    process.stderr.write(`${LIVE_EVENT_PREFIX}${JSON.stringify({
      schema: LIVE_EVENT_SCHEMA,
      event,
    })}\n`);
  } catch {
    // Live progress is best effort; final JSON output is still authoritative.
  }
}

function createCodexLiveStdoutForwarder() {
  const limit = numberFromEnv("HIVERUNNER_SYMPHONY_LIVE_EVENT_LIMIT", DEFAULT_LIVE_EVENT_LIMIT);
  let lineBuffer = "";
  let forwarded = 0;
  let limitReported = false;

  const maybeEmitLimit = () => {
    if (limitReported) return;
    limitReported = true;
    emitRunnerLiveEvent({
      kind: "runtime_progress",
      role: "system",
      title: "Codex live event limit reached",
      body: `Codex live output exceeded ${limit} forwarded event(s); continuing to buffer final output.`,
      metadata: {
        runnerProvider: "codex",
        source: "codex-stdout",
        liveEventLimit: limit,
      },
    });
  };

  const ingestLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (forwarded >= limit) {
      maybeEmitLimit();
      return;
    }

    const record = parseJsonLine(line);
    if (!record) return;
    const event = codexEventFromRecord(record);
    if (!event) return;
    emitRunnerLiveEvent(event);
    forwarded += 1;
  };

  return {
    push(chunk) {
      lineBuffer += chunk.toString("utf8");
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) ingestLine(line);
    },
    finish() {
      if (lineBuffer.trim()) ingestLine(lineBuffer);
      lineBuffer = "";
    },
  };
}

function collectUsage(records) {
  let usage = {};
  for (const record of records) {
    usage = mergeUsage(usage, extractUsage(record));
  }
  if (!usage.totalTokens && (usage.inputTokens || usage.outputTokens)) {
    usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  return usage;
}

function collectTranscriptEvents(records, finalMessage) {
  const events = [];
  for (const record of records) {
    const event = codexEventFromRecord(record);
    if (!event) continue;
    events.push(event);
  }
  if (events.length === 0 && finalMessage) {
    events.push({
      role: "assistant",
      kind: "message",
      title: "Codex final message",
      body: finalMessage,
    });
  }
  return events.slice(-25);
}

function buildPrompt(payload) {
  const task = payload.task && typeof payload.task === "object" ? payload.task : {};
  const project = task.project && typeof task.project === "object" ? task.project : {};
  const company = task.company && typeof task.company === "object" ? task.company : {};
  const workspace = payload.workspace && typeof payload.workspace === "object" ? payload.workspace : {};
  const runtimeCapabilities = workspace.runtimeCapabilities && typeof workspace.runtimeCapabilities === "object"
    ? workspace.runtimeCapabilities
    : {};
  const capabilities = Array.isArray(runtimeCapabilities.capabilities)
    ? runtimeCapabilities.capabilities.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const context = [
    "You are running as the HiveRunner external execution runner for a Symphony-compatible task handoff.",
    "",
    `HiveRunner run ID: ${payload.runId ?? "unknown"}`,
    `Task: ${task.key ?? task.id ?? "unknown"} - ${task.title ?? "Untitled task"}`,
    `Project: ${project.name ?? project.slug ?? "unknown"}`,
    `Company: ${company.name ?? company.slug ?? company.code ?? "unknown"}`,
    `Source workspace for code changes and tests: ${workspace.sourceWorkspaceRoot ?? workspace.cwd ?? "unknown"}`,
    `Company workspace for HiveRunner artifacts: ${workspace.companyWorkspaceRoot ?? "unknown"}`,
    capabilities.length > 0 ? `Trusted local runtime capabilities: ${capabilities.join(", ")}` : "",
    runtimeCapabilities.trustedLocalExecution ? "This task is running in a trusted local HiveRunner runtime. Use local services and verification tools when the task requires them, and report any unavailable capability explicitly." : "",
    "",
    "HiveRunner is the source of truth for task state. If you need to update HiveRunner task state, include a fenced mc-action block in your final response.",
    "Make product code changes in the source workspace. Use the company workspace only for HiveRunner artifacts, notes, or task outputs when requested.",
    "Validation policy: task-specific failing checks are blockers. Branch-wide or inherited hygiene findings, such as a broad fallow changed audit against many unrelated files, are caveats unless you can tie them directly to this task's changed files or acceptance criteria. If focused validation passes and only unrelated branch-wide hygiene remains, report the caveat and move the task to done.",
    "Blocked policy: only move a task to blocked when a concrete external blocker prevents completion, and include an update_task comment that states the blocker and exit condition.",
  ].join("\n");

  return [context, stringFrom(payload.prompt)].filter(Boolean).join("\n\n");
}

function buildCodexInvocation(cwd, lastMessageFile, additionalWritableDirs = [], payload = {}) {
  const commandParts = splitCommandLine(process.env.HIVERUNNER_SYMPHONY_CODEX_COMMAND || "codex");
  const command = commandParts[0] || "codex";
  const commandPrefixArgs = commandParts.slice(1);
  const configuredArgs = process.env.HIVERUNNER_SYMPHONY_CODEX_ARGS
    ? splitCommandLine(process.env.HIVERUNNER_SYMPHONY_CODEX_ARGS)
    : [
        "--ask-for-approval",
        process.env.HIVERUNNER_SYMPHONY_APPROVAL_POLICY || "never",
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        process.env.HIVERUNNER_SYMPHONY_SANDBOX || "workspace-write",
      ];
  const model = resolveCodexModel(payload);
  const modelArgs = model
    ? ["--model", model]
    : [];
  const profileArgs = process.env.HIVERUNNER_SYMPHONY_PROFILE
    ? ["--profile", process.env.HIVERUNNER_SYMPHONY_PROFILE]
    : [];

  const writableArgs = [];
  for (const dir of additionalWritableDirs) {
    const value = stringFrom(dir);
    if (value && value !== cwd) writableArgs.push("--add-dir", value);
  }

  return {
    command,
    args: [
      ...commandPrefixArgs,
      ...configuredArgs,
      ...writableArgs,
      ...modelArgs,
      ...profileArgs,
      "-C",
      cwd,
      "-o",
      lastMessageFile,
      "-",
    ],
  };
}

function runCodex({ command, args, cwd, prompt }) {
  const timeoutMs = numberFromEnv("HIVERUNNER_SYMPHONY_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const maxBufferBytes = numberFromEnv("HIVERUNNER_SYMPHONY_MAX_BUFFER", DEFAULT_MAX_BUFFER_BYTES);
  const noOutputTimeoutMs = Math.min(
    numberFromEnvNames(
      [
        "HIVERUNNER_SYMPHONY_CODEX_NO_OUTPUT_TIMEOUT_MS",
        "HIVERUNNER_SYMPHONY_CODEX_SILENT_TIMEOUT_MS",
        "HIVERUNNER_SYMPHONY_NO_OUTPUT_TIMEOUT_MS",
        "HIVERUNNER_SYMPHONY_SILENT_TIMEOUT_MS",
        "SYMPHONY_EXEC_NO_OUTPUT_TIMEOUT_MS",
        "SYMPHONY_EXEC_SILENT_TIMEOUT_MS",
      ],
      DEFAULT_CODEX_NO_OUTPUT_TIMEOUT_MS,
    ),
    timeoutMs,
  );
  const progressIntervalMs = numberFromEnvNames(
    [
      "HIVERUNNER_SYMPHONY_CODEX_PROGRESS_INTERVAL_MS",
      "HIVERUNNER_SYMPHONY_PROGRESS_INTERVAL_MS",
      "SYMPHONY_EXEC_PROGRESS_INTERVAL_MS",
    ],
    DEFAULT_CODEX_PROGRESS_INTERVAL_MS,
  );
  const terminationGraceMs = numberFromEnvNames(
    [
      "HIVERUNNER_SYMPHONY_CODEX_TERMINATION_GRACE_MS",
      "HIVERUNNER_SYMPHONY_TERMINATION_GRACE_MS",
      "SYMPHONY_EXEC_TERMINATION_GRACE_MS",
    ],
    DEFAULT_CODEX_TERMINATION_GRACE_MS,
  );
  const liveStdout = createCodexLiveStdoutForwarder();

  return runBufferedCommand({
    command,
    args,
    cwd,
    env: buildExternalRunnerEnv({
      HIVERUNNER_SYMPHONY_RUNNER: "1",
    }),
    stdio: ["pipe", "pipe", "pipe"],
    stdin: prompt,
    timeoutMs,
    maxBufferBytes,
    noOutputTimeoutMs,
    progressIntervalMs,
    terminationGraceMs,
    terminateProcessTree: true,
    describeTimeout: () => `Codex command timed out after ${timeoutMs}ms`,
    describeNoOutputTimeout: () => `Codex command produced no stdout/stderr for ${noOutputTimeoutMs}ms`,
    describeBufferLimit: () => `Codex command exceeded ${maxBufferBytes} bytes of stdout`,
    describeExit: ({ exitCode, signal }) => `Codex command exited with code ${exitCode}${signal ? ` (${signal})` : ""}`,
    onStdout: (chunk) => {
      liveStdout.push(chunk);
    },
    onProgress: ({ durationMs, silentForMs, stdoutBytes, stderrBytes }) => {
      process.stderr.write(
        `[hiverunner-symphony-runner] Codex still active after ${formatDuration(durationMs)}; ` +
        `${formatDuration(silentForMs)} since last stdout/stderr ` +
        `(${stdoutBytes} stdout bytes, ${stderrBytes} stderr bytes).\n`,
      );
    },
  }).finally(() => {
    liveStdout.finish();
  });
}

function isRecoveredNoOutputTimeout(result, finalMessage, records) {
  if (!result.noOutputTimedOut) return false;
  const invalidated = [
    result.timedOut,
    result.killedForBuffer,
    result.forcedKilled,
    result.signal,
    result.exitCode !== 0,
  ].some(Boolean);
  if (invalidated) return false;
  if (finalMessage) return true;
  return records.some((record) => {
    const body = extractText(record);
    if (!body) return false;
    const role = stringFrom(record.role).toLowerCase();
    const type = stringFrom(record.type).toLowerCase();
    return role === "assistant" || ["assistant", "message", "response.completed", "item.completed"].includes(type);
  });
}

async function main() {
  const rawInput = await readStdin();
  const payload = JSON.parse(rawInput);
  if (payload.schema !== "hiverunner.symphony.execution.v1") {
    throw new Error(`Unsupported payload schema: ${payload.schema ?? "missing"}`);
  }

  const cwd = stringFrom(payload.workspace?.cwd) || process.cwd();
  const additionalWritableDirs = Array.isArray(payload.workspace?.additionalWritableDirs)
    ? payload.workspace.additionalWritableDirs
    : [];
  const prompt = buildPrompt(payload);
  const runnerModel = await resolveActualCodexModel(payload);
  if (process.env.HIVERUNNER_SYMPHONY_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({
      sessionId: `dry-run-${payload.runId ?? Date.now()}`,
      resultText: [
        "External runner dry run accepted the HiveRunner task payload.",
        "",
        "```mc-action",
        JSON.stringify({ action: "report", summary: "External runner dry run completed without launching Codex." }),
        "```",
      ].join("\n"),
      assistantSummary: "External runner dry run completed without launching Codex.",
      runnerProvider: "codex",
      runnerModel: runnerModel || null,
      usage: {
        runnerProvider: "codex",
        runnerModel: runnerModel || null,
        model: runnerModel || null,
      },
      transcriptEvents: [
        {
          role: "assistant",
          kind: "message",
          title: "External runner dry run",
          body: prompt,
        },
      ],
    }) + "\n");
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hiverunner-symphony-runner-"));
  const lastMessageFile = path.join(tempDir, "last-message.txt");
  try {
    await writeFile(lastMessageFile, "", "utf8");
    const invocation = buildCodexInvocation(cwd, lastMessageFile, additionalWritableDirs, payload);
    const result = await runCodex({ ...invocation, cwd, prompt });
    const finalMessage = stringFrom(await readFile(lastMessageFile, "utf8").catch(() => ""));
    const records = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseJsonLine)
      .filter(Boolean);
    const usage = collectUsage(records);
    const assistantSummary = finalMessage || result.stdout.trim() || result.stderr.trim() || stringFrom(result.error);
    const recoveredNoOutputTimeout = isRecoveredNoOutputTimeout(result, finalMessage, records);
    const effectiveError = recoveredNoOutputTimeout ? undefined : result.error;
    const effectiveNoOutputTimedOut = recoveredNoOutputTimeout ? false : result.noOutputTimedOut;
    const effectiveTerminationReason = recoveredNoOutputTimeout && result.terminationReason === "no_output_timeout"
      ? null
      : result.terminationReason;
    process.stdout.write(JSON.stringify({
      sessionId: codexSessionId(records.find((record) => codexSessionId(record))) ||
        `codex-${payload.runId ?? Date.now()}`,
      resultText: assistantSummary,
      assistantSummary,
      error: effectiveError ?? undefined,
      runnerProvider: "codex",
      runnerModel: runnerModel || null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      totalTokens: usage.totalTokens,
      totalCostUsd: usage.totalCostUsd,
      totalCostCents: usage.totalCostCents,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      noOutputTimedOut: effectiveNoOutputTimedOut,
      killedForBuffer: result.killedForBuffer,
      forcedKilled: result.forcedKilled,
      terminationReason: effectiveTerminationReason,
      terminationSignalMethod: result.terminationSignalMethod,
      exitCode: result.exitCode,
      signal: result.signal,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      recoveredNoOutputTimeout,
      usage: {
        ...usage,
        runnerProvider: "codex",
        runnerModel: runnerModel || null,
        model: runnerModel || null,
        timedOut: result.timedOut,
        noOutputTimedOut: effectiveNoOutputTimedOut,
        killedForBuffer: result.killedForBuffer,
        forcedKilled: result.forcedKilled,
        terminationReason: effectiveTerminationReason,
        terminationSignalMethod: result.terminationSignalMethod,
        exitCode: result.exitCode,
        signal: result.signal,
        stdoutBytes: result.stdoutBytes,
        stderrBytes: result.stderrBytes,
        recoveredNoOutputTimeout,
      },
      transcriptEvents: collectTranscriptEvents(records, assistantSummary),
    }) + "\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    resultText: "",
    assistantSummary: "",
  }) + "\n");
});
