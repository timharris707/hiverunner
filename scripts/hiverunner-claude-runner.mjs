#!/usr/bin/env node
import { asRecord, buildExternalRunnerPrompt, numberFrom, numberFromEnv, readStdin, runBufferedCommand, splitCommandLine, stringFrom } from "./lib/external-runner-utils.mjs";

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const RUNNER_VERSION = "hiverunner-claude-runner 0.1.0";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(RUNNER_VERSION);
  process.exit(0);
}

function normalizeClaudeModel(value) {
  const model = stringFrom(value).replace(/^anthropic\//i, "").toLowerCase();
  if (
    !model ||
    model === "auto" ||
    model === "default" ||
    model === "claude" ||
    model === "sonnet" ||
    model === "claude-sonnet"
  ) {
    return DEFAULT_CLAUDE_MODEL;
  }
  if (model === "opus" || model === "claude-opus") {
    return "claude-opus-4-7";
  }
  return model;
}

function parseJsonLine(line) {
  try {
    const parsed = JSON.parse(line);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function extractText(value) {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return "";
  const direct =
    stringFrom(record.text) ||
    stringFrom(record.message) ||
    stringFrom(record.content) ||
    stringFrom(record.summary) ||
    stringFrom(record.result) ||
    stringFrom(record.output_text);
  if (direct) return direct;

  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((item) => {
      const part = asRecord(item);
      return part ? stringFrom(part.text) || stringFrom(part.content) : "";
    })
    .filter(Boolean)
    .join("\n");
}

function collectUsage(records) {
  const usage = {};
  for (const record of records) {
    const candidate = asRecord(record.usage) ?? asRecord(record.token_usage) ?? asRecord(record.tokenUsage) ?? record;
    if (!candidate) continue;
    usage.inputTokens ??= numberFrom(candidate.inputTokens ?? candidate.input_tokens ?? candidate.prompt_tokens);
    usage.outputTokens ??= numberFrom(candidate.outputTokens ?? candidate.output_tokens ?? candidate.completion_tokens);
    usage.totalTokens ??= numberFrom(candidate.totalTokens ?? candidate.total_tokens);
  }
  if (!usage.totalTokens && (usage.inputTokens || usage.outputTokens)) {
    usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  return usage;
}

function collectTranscriptEvents(records, finalMessage) {
  const events = [];
  for (const record of records) {
    const type = stringFrom(record.type);
    if (type === "system" || type === "usage") continue;
    const body = extractText(record);
    if (!body) continue;
    events.push({
      role: stringFrom(record.role) || (type === "assistant" ? "assistant" : "assistant"),
      kind: type || "message",
      title: type === "result" ? "Claude result" : "Claude event",
      body,
    });
  }
  if (events.length === 0 && finalMessage) {
    events.push({
      role: "assistant",
      kind: "message",
      title: "Claude final message",
      body: finalMessage,
    });
  }
  return events.slice(-25);
}

function buildPrompt(payload) {
  return buildExternalRunnerPrompt(
    payload,
    "You are running as a Claude Code implementation of the HiveRunner external runner contract.",
  );
}

function resolvePayloadModel(payload) {
  return stringFrom(process.env.HIVERUNNER_CLAUDE_MODEL) ||
    stringFrom(payload.runnerModel) ||
    DEFAULT_CLAUDE_MODEL;
}

function buildClaudeInvocation(payload) {
  const commandParts = splitCommandLine(process.env.HIVERUNNER_CLAUDE_COMMAND || "claude");
  const command = commandParts[0] || "claude";
  const commandPrefixArgs = commandParts.slice(1);
  const permissionMode =
    stringFrom(process.env.HIVERUNNER_CLAUDE_PERMISSION_MODE) ||
    stringFrom(process.env.MC_CLAUDE_PERMISSION_MODE) ||
    "bypassPermissions";
  const model = normalizeClaudeModel(resolvePayloadModel(payload));
  const configuredArgs = process.env.HIVERUNNER_CLAUDE_ARGS
    ? splitCommandLine(process.env.HIVERUNNER_CLAUDE_ARGS)
    : [
        "--permission-mode",
        permissionMode,
        "--model",
        model,
        "--print",
        "--input-format",
        "text",
        "--output-format",
        "stream-json",
        "--verbose",
      ];

  return {
    command,
    args: [
      ...commandPrefixArgs,
      ...configuredArgs,
    ],
    model,
    permissionMode,
  };
}

function runClaude({ command, args, cwd, prompt }) {
  const timeoutMs = numberFromEnv("HIVERUNNER_CLAUDE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const maxBufferBytes = numberFromEnv("HIVERUNNER_CLAUDE_MAX_BUFFER", DEFAULT_MAX_BUFFER_BYTES);

  return runBufferedCommand({
    command,
    args,
    cwd,
    env: {
      ...process.env,
      HIVERUNNER_EXTERNAL_RUNNER: "1",
      HIVERUNNER_CLAUDE_RUNNER: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
    stdin: prompt,
    timeoutMs,
    maxBufferBytes,
    describeTimeout: () => `Claude command timed out after ${timeoutMs}ms`,
    describeBufferLimit: () => `Claude command exceeded ${maxBufferBytes} bytes of stdout`,
    describeExit: ({ exitCode, signal }) => `Claude command exited with code ${exitCode}${signal ? ` (${signal})` : ""}`,
  });
}

async function main() {
  const rawInput = await readStdin();
  const payload = JSON.parse(rawInput);
  if (payload.schema !== "hiverunner.symphony.execution.v1") {
    throw new Error(`Unsupported payload schema: ${payload.schema ?? "missing"}`);
  }

  const workspace = asRecord(payload.workspace) ?? {};
  const cwd = stringFrom(workspace.cwd) || process.cwd();
  const prompt = buildPrompt(payload);
  if (process.env.HIVERUNNER_CLAUDE_DRY_RUN === "1" || process.env.HIVERUNNER_EXTERNAL_RUNNER_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({
      sessionId: `claude-dry-run-${payload.runId ?? Date.now()}`,
      resultText: [
        "Claude external runner dry run accepted the HiveRunner task payload.",
        "",
        "```mc-action",
        JSON.stringify({ action: "report", summary: "Claude external runner dry run completed without launching Claude Code." }),
        "```",
      ].join("\n"),
      assistantSummary: "Claude external runner dry run completed without launching Claude Code.",
      runnerProvider: "anthropic",
      runnerModel: normalizeClaudeModel(resolvePayloadModel(payload)),
      transcriptEvents: [
        {
          role: "assistant",
          kind: "message",
          title: "Claude external runner dry run",
          body: prompt,
        },
      ],
    }) + "\n");
    return;
  }

  const invocation = buildClaudeInvocation(payload);
  const result = await runClaude({ ...invocation, cwd, prompt });
  const records = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);
  const usage = collectUsage(records);
  const assistantSummary =
    records.map(extractText).filter(Boolean).at(-1) ||
    result.stdout.trim() ||
    result.stderr.trim();
  const sessionId =
    stringFrom(records.find((record) => stringFrom(record.session_id))?.session_id) ||
    stringFrom(records.find((record) => stringFrom(record.sessionId))?.sessionId) ||
    `claude-${payload.runId ?? Date.now()}`;

  process.stdout.write(JSON.stringify({
    sessionId,
    resultText: assistantSummary,
    assistantSummary,
    error: result.error ?? undefined,
    runnerProvider: "anthropic",
    runnerModel: invocation.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    durationMs: result.durationMs,
    transcriptEvents: collectTranscriptEvents(records, assistantSummary),
  }) + "\n");
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    resultText: "",
    assistantSummary: "",
    runnerProvider: "anthropic",
  }) + "\n");
});
