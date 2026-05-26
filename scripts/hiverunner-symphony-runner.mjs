#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const RUNNER_VERSION = "hiverunner-symphony-runner 0.1.0";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(RUNNER_VERSION);
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(body));
  });
}

function splitCommandLine(value) {
  const parts = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'([^']*)'|[^\s]+/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    if (match[1] !== undefined) {
      parts.push(match[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\"));
    } else if (match[2] !== undefined) {
      parts.push(match[2]);
    } else {
      parts.push(match[0]);
    }
  }
  return parts;
}

function numberFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberFrom(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
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

function stringFrom(value) {
  return typeof value === "string" ? value.trim() : "";
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

function extractText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value;
  return (
    stringFrom(record.text) ||
    stringFrom(record.message) ||
    stringFrom(record.content) ||
    stringFrom(record.summary) ||
    stringFrom(record.summaryText) ||
    stringFrom(record.output_text)
  );
}

function collectUsage(records) {
  let usage = {};
  for (const record of records) {
    const candidate = record.usage ?? record.token_usage ?? record.tokenUsage ?? record;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    usage = mergeUsage(usage, {
      inputTokens: firstNumberFromRecord(candidate, [
        "inputTokens",
        "input_tokens",
        "promptTokens",
        "prompt_tokens",
        "totalInputTokens",
        "total_input_tokens",
      ]),
      outputTokens: firstNumberFromRecord(candidate, [
        "outputTokens",
        "output_tokens",
        "completionTokens",
        "completion_tokens",
        "totalOutputTokens",
        "total_output_tokens",
      ]),
      cacheReadInputTokens: firstNumberFromRecord(candidate, [
        "cacheReadInputTokens",
        "cache_read_input_tokens",
        "cacheReadTokens",
        "cache_read_tokens",
        "cachedReadTokens",
        "cached_read_tokens",
        "cachedInputTokens",
        "cached_input_tokens",
      ]),
      cacheCreationInputTokens: firstNumberFromRecord(candidate, [
        "cacheCreationInputTokens",
        "cache_creation_input_tokens",
        "cacheWriteTokens",
        "cache_write_tokens",
        "cachedWriteTokens",
        "cached_write_tokens",
      ]),
      totalTokens: firstNumberFromRecord(candidate, ["totalTokens", "total_tokens"]),
      totalCostUsd: firstNumberFromRecord(candidate, ["totalCostUsd", "total_cost_usd", "costUsd", "cost_usd"]),
      totalCostCents: firstNumberFromRecord(candidate, ["totalCostCents", "total_cost_cents", "costCents", "cost_cents"]),
    });
  }
  if (!usage.totalTokens && (usage.inputTokens || usage.outputTokens)) {
    usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  return usage;
}

function collectTranscriptEvents(records, finalMessage) {
  const events = [];
  for (const record of records) {
    const body = extractText(record);
    if (!body) continue;
    events.push({
      role: typeof record.role === "string" ? record.role : "assistant",
      kind: typeof record.type === "string" ? record.type : "message",
      title: "Codex event",
      body,
    });
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
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        HIVERUNNER_SYMPHONY_RUNNER: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let killedForBuffer = false;
    let spawnError = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxBufferBytes) stdoutChunks.push(chunk);
      if (stdoutBytes > maxBufferBytes && !killedForBuffer) {
        killedForBuffer = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxBufferBytes) stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const error =
        spawnError ??
        (timedOut ? `Codex command timed out after ${timeoutMs}ms` : null) ??
        (killedForBuffer ? `Codex command exceeded ${maxBufferBytes} bytes of stdout` : null) ??
        (exitCode === 0 ? null : `Codex command exited with code ${exitCode}${signal ? ` (${signal})` : ""}`);
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        error,
        durationMs: Date.now() - startedAt,
      });
    });
    child.stdin.end(prompt);
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
    const assistantSummary = finalMessage || result.stdout.trim() || result.stderr.trim();
    process.stdout.write(JSON.stringify({
      sessionId: stringFrom(records.find((record) => stringFrom(record.session_id) || stringFrom(record.sessionId))?.session_id) ||
        stringFrom(records.find((record) => stringFrom(record.sessionId))?.sessionId) ||
        `codex-${payload.runId ?? Date.now()}`,
      resultText: assistantSummary,
      assistantSummary,
      error: result.error ?? undefined,
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
      usage: {
        ...usage,
        runnerProvider: "codex",
        runnerModel: runnerModel || null,
        model: runnerModel || null,
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
