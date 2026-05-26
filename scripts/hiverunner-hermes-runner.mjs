#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const RUNNER_VERSION = "hiverunner-hermes-runner 0.1.0";
const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  thoughtTokens: 0,
  cachedReadTokens: 0,
};

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

function stringFrom(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberFrom(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeHermesModel(value) {
  const raw = stringFrom(value);
  const model = raw.toLowerCase();
  if (
    !model ||
    model === "auto" ||
    model === "default" ||
    model === "hermes" ||
    model === "hermes-default" ||
    model === "hermes/default" ||
    model === "hermes/auto"
  ) {
    return "";
  }
  return raw;
}

function buildPrompt(payload) {
  const task = asRecord(payload.task) ?? {};
  const project = asRecord(task.project) ?? {};
  const company = asRecord(task.company) ?? {};
  const workspace = asRecord(payload.workspace) ?? {};
  const runtimeCapabilities = asRecord(workspace.runtimeCapabilities) ?? {};
  const capabilities = Array.isArray(runtimeCapabilities.capabilities)
    ? runtimeCapabilities.capabilities.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const additionalWritableDirs = Array.isArray(workspace.additionalWritableDirs)
    ? workspace.additionalWritableDirs.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const context = [
    "You are running as a HERMES ACP implementation of the HiveRunner external runner contract.",
    "",
    `HiveRunner run ID: ${payload.runId ?? "unknown"}`,
    `Task: ${task.key ?? task.id ?? "unknown"} - ${task.title ?? "Untitled task"}`,
    `Project: ${project.name ?? project.slug ?? "unknown"}`,
    `Company: ${company.name ?? company.slug ?? company.code ?? "unknown"}`,
    `Source workspace for code changes and tests: ${workspace.sourceWorkspaceRoot ?? workspace.cwd ?? "unknown"}`,
    `Company workspace for HiveRunner artifacts: ${workspace.companyWorkspaceRoot ?? "unknown"}`,
    additionalWritableDirs.length > 0 ? `Additional writable directories: ${additionalWritableDirs.join(", ")}` : "",
    capabilities.length > 0 ? `Trusted local runtime capabilities: ${capabilities.join(", ")}` : "",
    runtimeCapabilities.trustedLocalExecution ? "This task is running in a trusted local HiveRunner runtime. Use local services and verification tools when the task requires them, and report any unavailable capability explicitly." : "",
    "",
    "HiveRunner is the source of truth for task state. If you need to update HiveRunner task state, include a fenced mc-action block in your final response.",
    "Make product code changes in the source workspace. Use the company workspace only for HiveRunner artifacts, notes, or task outputs when requested.",
  ].join("\n");

  return [context, stringFrom(payload.prompt)].filter(Boolean).join("\n\n");
}

function resolvePayloadModel(payload) {
  return normalizeHermesModel(
    stringFrom(process.env.HIVERUNNER_HERMES_MODEL) ||
    stringFrom(payload.runnerModel),
  );
}

function buildHermesInvocation(payload) {
  const commandParts = splitCommandLine(process.env.HIVERUNNER_HERMES_COMMAND || "hermes");
  const command = commandParts[0] || "hermes";
  const commandPrefixArgs = commandParts.slice(1);
  const configuredArgs = process.env.HIVERUNNER_HERMES_ARGS
    ? splitCommandLine(process.env.HIVERUNNER_HERMES_ARGS)
    : ["acp"];
  const model = resolvePayloadModel(payload);
  return {
    command,
    args: [...commandPrefixArgs, ...configuredArgs],
    model,
  };
}

function buildEnv(command) {
  const pathEntries = [
    path.join(process.env.HOME ?? "", ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH ?? "",
  ];
  if (path.isAbsolute(command)) {
    pathEntries.unshift(path.dirname(command));
  }
  return {
    ...process.env,
    HERMES_YOLO_MODE: "1",
    HIVERUNNER_EXTERNAL_RUNNER: "1",
    HIVERUNNER_HERMES_RUNNER: "1",
    PATH: pathEntries.filter(Boolean).join(":"),
  };
}

function mergeUsage(base, raw) {
  const record = asRecord(raw);
  const usage = asRecord(record?.usage) ?? record;
  if (!usage) return base;
  return {
    inputTokens: Math.max(base.inputTokens, numberFrom(usage.inputTokens)),
    outputTokens: Math.max(base.outputTokens, numberFrom(usage.outputTokens)),
    totalTokens: Math.max(base.totalTokens, numberFrom(usage.totalTokens)),
    thoughtTokens: Math.max(base.thoughtTokens, numberFrom(usage.thoughtTokens)),
    cachedReadTokens: Math.max(base.cachedReadTokens, numberFrom(usage.cachedReadTokens)),
  };
}

function extractContentText(update) {
  const content = update.content;
  const contentRecord = asRecord(content);
  if (contentRecord) return stringFrom(contentRecord.text);
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const record = asRecord(block);
        if (!record) return "";
        const inner = asRecord(record.content);
        return stringFrom(inner?.text) || stringFrom(record.text);
      })
      .filter(Boolean)
      .join("\n");
  }
  return stringFrom(update.text);
}

function normalizeUpdateType(value) {
  const key = value.trim().toLowerCase().replace(/[_-]/g, "");
  switch (key) {
    case "agentmessagechunk":
      return "agent_message_chunk";
    case "agentthoughtchunk":
      return "agent_thought_chunk";
    case "toolcall":
      return "tool_call";
    case "toolcallupdate":
      return "tool_call_update";
    case "usageupdate":
      return "usage_update";
    case "turnend":
    case "endturn":
      return "turn_end";
    default:
      return "";
  }
}

function normalizeUpdate(update) {
  const record = asRecord(update);
  if (!record) return null;
  const explicitType = normalizeUpdateType(stringFrom(record.sessionUpdate) || stringFrom(record.type));
  if (explicitType) return { type: explicitType, data: record };
  const entries = Object.entries(record);
  if (entries.length === 1) {
    const [key, value] = entries[0];
    const wrappedType = normalizeUpdateType(key);
    const wrappedRecord = asRecord(value);
    if (wrappedType && wrappedRecord) return { type: wrappedType, data: wrappedRecord };
  }
  return null;
}

function toolNameFromTitle(title, kind) {
  const colonIndex = title.indexOf(":");
  if (colonIndex > 0) return title.slice(0, colonIndex).trim() || "tool";
  if (kind === "execute") return "terminal";
  if (kind === "read") return "read_file";
  if (kind === "edit") return "write_file";
  if (kind === "search") return "search_files";
  return title || kind || "tool";
}

class HermesRpcClient {
  constructor(writer) {
    this.writer = writer;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.assistantChunks = [];
    this.thinkingChunks = [];
    this.toolCalls = [];
    this.toolResults = [];
    this.pendingToolNames = new Map();
    this.usage = { ...ZERO_USAGE };
  }

  request(method, params) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
    });
    this.writer.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return result;
  }

  closeAllPending(error) {
    for (const [id, pending] of this.pending.entries()) {
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  handleLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const raw = asRecord(parsed);
    if (!raw) return;
    const hasId = Object.prototype.hasOwnProperty.call(raw, "id");
    const hasResult = Object.prototype.hasOwnProperty.call(raw, "result");
    const hasError = Object.prototype.hasOwnProperty.call(raw, "error");
    const method = stringFrom(raw.method);
    if (hasId && (hasResult || hasError)) {
      this.handleResponse(raw);
      return;
    }
    if (hasId && method) {
      this.handleAgentRequest(raw);
      return;
    }
    if (method) this.handleNotification(raw);
  }

  snapshot() {
    return {
      sessionId: this.sessionId,
      assistantText: this.assistantChunks.join(""),
      thinkingText: this.thinkingChunks.join(""),
      toolCalls: [...this.toolCalls],
      toolResults: [...this.toolResults],
      usage: { ...this.usage },
    };
  }

  handleResponse(raw) {
    const id = numberFrom(raw.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    const errorRecord = asRecord(raw.error);
    if (errorRecord) {
      pending.reject(new Error(`${pending.method}: ${stringFrom(errorRecord.message) || "JSON-RPC error"}`));
      return;
    }
    const result = asRecord(raw.result) ?? {};
    if (pending.method === "session/new" || pending.method === "session/resume") {
      this.sessionId = stringFrom(result.sessionId) || this.sessionId;
    }
    if (pending.method === "session/prompt") {
      this.usage = mergeUsage(this.usage, result);
    }
    pending.resolve(result);
  }

  handleAgentRequest(raw) {
    const method = stringFrom(raw.method);
    const response = method === "session/request_permission"
      ? {
          jsonrpc: "2.0",
          id: raw.id,
          result: { outcome: { outcome: "selected", optionId: "approve_for_session" } },
        }
      : {
          jsonrpc: "2.0",
          id: raw.id,
          error: { code: -32601, message: `method not found: ${method || "unknown"}` },
        };
    this.writer.write(`${JSON.stringify(response)}\n`);
  }

  handleNotification(raw) {
    const method = stringFrom(raw.method);
    if (method !== "session/update" && method !== "session/notification") return;
    const params = asRecord(raw.params);
    const normalized = normalizeUpdate(params?.update);
    if (!normalized) return;
    if (normalized.type === "agent_message_chunk") {
      const text = extractContentText(normalized.data);
      if (text) this.assistantChunks.push(text);
      return;
    }
    if (normalized.type === "agent_thought_chunk") {
      const text = extractContentText(normalized.data);
      if (text) this.thinkingChunks.push(text);
      return;
    }
    if (normalized.type === "usage_update" || normalized.type === "turn_end") {
      this.usage = mergeUsage(this.usage, normalized.data);
      return;
    }
    if (normalized.type === "tool_call") {
      const callId = stringFrom(normalized.data.toolCallId) || `tool-${this.toolCalls.length + 1}`;
      const title = stringFrom(normalized.data.title) || stringFrom(normalized.data.name);
      const kind = stringFrom(normalized.data.kind);
      const toolName = toolNameFromTitle(title, kind);
      this.pendingToolNames.set(callId, toolName);
      this.toolCalls.push({ callId, toolName, title, kind });
      return;
    }
    if (normalized.type === "tool_call_update") {
      const callId = stringFrom(normalized.data.toolCallId) || `tool-${this.toolResults.length + 1}`;
      const title = stringFrom(normalized.data.title) || stringFrom(normalized.data.name);
      const kind = stringFrom(normalized.data.kind);
      const toolName = this.pendingToolNames.get(callId) || toolNameFromTitle(title, kind);
      const status = stringFrom(normalized.data.status) || "updated";
      if (status === "completed" || status === "failed") {
        this.toolResults.push({
          callId,
          toolName,
          status,
          output: stringFrom(normalized.data.rawOutput) || stringFrom(normalized.data.output),
        });
      }
    }
  }
}

function waitForExit(child, client) {
  return new Promise((resolve) => {
    child.once("error", (error) => {
      client.closeAllPending(error instanceof Error ? error : new Error(String(error)));
      resolve({ exitCode: null, signal: null, error: error instanceof Error ? error : new Error(String(error)) });
    });
    child.once("exit", (code, signal) => {
      resolve({ exitCode: code, signal, error: null });
    });
  });
}

async function runHermes({ command, args, model, cwd, prompt }) {
  const timeoutMs = numberFromEnv("HIVERUNNER_HERMES_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  let stderr = "";
  let timedOut = false;
  const stdoutLines = [];
  const child = spawn(command, args, { cwd, env: buildEnv(command), stdio: ["pipe", "pipe", "pipe"] });
  const client = new HermesRpcClient(child.stdin);
  const exitPromise = waitForExit(child, client);
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    stdoutLines.push(trimmed);
    if (stdoutLines.length > 80) stdoutLines.shift();
    client.handleLine(trimmed);
  });
  rl.on("close", () => {
    client.closeAllPending(new Error("HERMES stdout closed before completing the active JSON-RPC request"));
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-12000);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    client.closeAllPending(new Error(`HERMES command timed out after ${timeoutMs}ms`));
    child.kill("SIGTERM");
  }, timeoutMs);

  let driveError = null;
  try {
    await client.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "hiverunner-hermes-runner", version: "0.1.0" },
      clientCapabilities: {},
    });
    const sessionParams = { cwd, mcpServers: [] };
    if (model) sessionParams.model = model;
    const sessionResult = await client.request("session/new", sessionParams);
    const sessionId = stringFrom(sessionResult.sessionId);
    if (!sessionId) throw new Error("HERMES session/new returned no session ID");
    if (model) {
      await client.request("session/set_model", { sessionId, modelId: model });
    }
    await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
  } catch (error) {
    driveError = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timeout);
    try {
      child.stdin.end();
    } catch {
      // ignore shutdown races
    }
  }

  if (driveError && !child.killed) child.kill("SIGTERM");
  const exit = await Promise.race([
    exitPromise,
    new Promise((resolve) => {
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve({ exitCode: null, signal: "SIGKILL", error: new Error("HERMES process did not exit after stdin closed") });
      }, 3000);
    }),
  ]);
  rl.close();

  const snapshot = client.snapshot();
  return {
    ...snapshot,
    stderr,
    stdoutTail: stdoutLines.join("\n").slice(-4000),
    exitCode: exit.exitCode,
    signal: exit.signal,
    error: timedOut ? `HERMES command timed out after ${timeoutMs}ms` : driveError || exit.error?.message || null,
    durationMs: Date.now() - startedAt,
  };
}

function collectTranscriptEvents(result, finalMessage) {
  const events = [];
  if (result.thinkingText) {
    events.push({ role: "assistant", kind: "thinking_summary", title: "HERMES thinking", body: result.thinkingText });
  }
  for (const tool of result.toolCalls) {
    events.push({ role: "tool", kind: "tool_call_start", title: tool.toolName, body: tool.title || tool.toolName });
  }
  for (const tool of result.toolResults) {
    events.push({ role: "tool", kind: "tool_result", title: tool.toolName, body: tool.output || tool.status });
  }
  if (finalMessage) {
    events.push({ role: "assistant", kind: "message", title: "HERMES final message", body: finalMessage });
  }
  return events.slice(-25);
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
  const invocation = buildHermesInvocation(payload);
  if (process.env.HIVERUNNER_HERMES_DRY_RUN === "1" || process.env.HIVERUNNER_EXTERNAL_RUNNER_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({
      sessionId: `hermes-dry-run-${payload.runId ?? Date.now()}`,
      resultText: [
        "HERMES external runner dry run accepted the HiveRunner task payload.",
        "",
        "```mc-action",
        JSON.stringify({ action: "report", summary: "HERMES external runner dry run completed without launching HERMES ACP." }),
        "```",
      ].join("\n"),
      assistantSummary: "HERMES external runner dry run completed without launching HERMES ACP.",
      runnerProvider: "hermes",
      runnerModel: invocation.model || null,
      transcriptEvents: [
        {
          role: "assistant",
          kind: "message",
          title: "HERMES external runner dry run",
          body: prompt,
        },
      ],
    }) + "\n");
    return;
  }

  const result = await runHermes({ ...invocation, cwd, prompt });
  const assistantSummary = result.assistantText.trim() || result.stderr.trim();
  process.stdout.write(JSON.stringify({
    sessionId: result.sessionId || `hermes-${payload.runId ?? Date.now()}`,
    resultText: assistantSummary,
    assistantSummary,
    error: result.error ?? undefined,
    runnerProvider: "hermes",
    runnerModel: invocation.model || null,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens: result.usage.totalTokens,
    thoughtTokens: result.usage.thoughtTokens,
    cacheReadTokens: result.usage.cachedReadTokens,
    durationMs: result.durationMs,
    transcriptEvents: collectTranscriptEvents(result, assistantSummary),
  }) + "\n");
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    resultText: "",
    assistantSummary: "",
    runnerProvider: "hermes",
  }) + "\n");
});
