/**
 * HiveRunner - HERMES Execution Adapter
 *
 * Runs HERMES through its ACP JSON-RPC transport (`hermes acp`) for
 * heartbeat Tasks. This captures structured post-run evidence without
 * exposing the ACP session ID to the OpenClaw session importer.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { createInterface } from "readline";
import { spawn } from "child_process";
import type { ChildProcessWithoutNullStreams } from "child_process";
import type { Writable } from "stream";
import type Database from "better-sqlite3";

import {
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { sanitizeAgentCommentLinks } from "@/lib/orchestration/comment-link-verification";
import { cleanupRunArtifacts } from "../cleanup";

import type {
  CancelAdapterResult,
  ExecutionAdapter,
  ExecutionInput,
  ExecutionResult,
  ExecutionSelfHealInput,
} from "./types";

type HermesRuntimeRow = {
  command: string | null;
  display_name: string;
  runtime_slug: string;
  scope: string;
  workspace_root: string | null;
  metadata_json: string;
};

type WorkspaceRow = {
  company_id: string;
  company_workspace_slug: string | null;
  company_workspace_root: string | null;
  company_workspace_source: string | null;
};

type AgentModelRow = {
  model: string | null;
};

type HermesUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  thoughtTokens: number;
  cachedReadTokens: number;
};

type HermesToolCall = {
  callId: string;
  toolName: string;
  title: string;
  kind: string;
  input: Record<string, unknown> | null;
};

type HermesToolResult = {
  callId: string;
  toolName: string;
  status: string;
  output: string;
};

type HermesExecConfig = {
  command: string;
  args: string[];
  model: string;
  cliDisplay: string;
};

type HermesExecResult = {
  ok: boolean;
  sessionId: string | null;
  assistantText: string;
  thinkingText: string;
  toolCalls: HermesToolCall[];
  toolResults: HermesToolResult[];
  usage: HermesUsage;
  promptStopReason: string | null;
  stdoutTail: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  errorMessage: string | null;
  durationMs: number;
};

type PendingRpc = {
  method: string;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

const DEFAULT_HERMES_TIMEOUT_MS = 20 * 60 * 1000;
const CANCEL_SIGKILL_GRACE_MS = parseInt(process.env.MC_CANCEL_SIGKILL_GRACE_MS ?? "5000", 10);
const ZERO_HERMES_USAGE: HermesUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  thoughtTokens: 0,
  cachedReadTokens: 0,
};

function getDb(): Database.Database {
  // Lazy require keeps adapter registry imports from opening a live DB.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getOrchestrationDb } = require("@/lib/orchestration/db") as {
    getOrchestrationDb: () => Database.Database;
  };
  return getOrchestrationDb();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function stringFrom(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimForStorage(value: string, maxChars = 4000): string {
  if (value.length <= maxChars) return value;
  return value.slice(-maxChars);
}

function transcriptText(value: string | null | undefined, maxChars = 12000): { body: string; truncated: boolean } {
  const trimmed = (value ?? "").trim();
  if (trimmed.length <= maxChars) return { body: trimmed, truncated: false };
  return { body: trimmed.slice(-maxChars), truncated: true };
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function resolveHermesRuntime(db: Database.Database, input: ExecutionInput): HermesRuntimeRow | null {
  const rows = db
    .prepare(
      `SELECT command, display_name, runtime_slug, scope, workspace_root, metadata_json
       FROM agent_runtimes
       WHERE company_id = ?
         AND provider = 'hermes'
         AND status <> 'disabled'
         AND (agent_id = ? OR agent_id IS NULL)
       ORDER BY
         CASE WHEN agent_id = ? THEN 0 ELSE 1 END,
         CASE scope WHEN 'agent' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
         updated_at DESC
       LIMIT 1`,
    )
    .all(input.agent.company_id, input.agent.id, input.agent.id) as HermesRuntimeRow[];

  return rows[0] ?? null;
}

function resolveWorkspaceRoot(db: Database.Database, input: ExecutionInput, runtime: HermesRuntimeRow | null): string {
  const row = db
    .prepare(
      `SELECT
         c.id AS company_id,
         c.workspace_slug AS company_workspace_slug,
         c.workspace_root AS company_workspace_root,
         c.workspace_source AS company_workspace_source
       FROM companies c
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(input.agent.company_id) as WorkspaceRow | undefined;
  const explicitRuntimeRoot = runtime?.workspace_root?.trim();
  if (explicitRuntimeRoot) {
    fs.mkdirSync(path.resolve(explicitRuntimeRoot), { recursive: true });
  }

  const root = row?.company_workspace_source === "openclaw"
    ? resolveCanonicalCompanyWorkspaceRoot(
        row.company_id,
        row.company_workspace_slug,
      )
    : resolveCompanyWorkspaceRoot({
        companyId: row?.company_id ?? input.agent.company_id,
        workspaceSlug: row?.company_workspace_slug,
        workspaceRoot: row?.company_workspace_root,
        workspaceSource: row?.company_workspace_source,
      });
  return ensureCompanyWorkspaceScaffold(root).root;
}

function resolveCommand(runtime: HermesRuntimeRow | null): string {
  const metadata = parseJson(runtime?.metadata_json);
  const metadataCommand = stringFrom(metadata.commandPath);
  return metadataCommand || runtime?.command?.trim() || "hermes";
}

function nestedJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return parseJson(value);
  return asRecord(value) ?? {};
}

function resolveModel(db: Database.Database, input: ExecutionInput, runtime: HermesRuntimeRow | null): string {
  const runtimeMetadata = parseJson(runtime?.metadata_json);
  const adapterConfig = parseJson(input.agent.adapter_config_json);
  const runtimeConfig = parseJson(input.agent.runtime_config_json);
  const seededAdapterConfig = nestedJsonRecord(runtimeMetadata.adapterConfig);
  const seededRuntimeConfig = nestedJsonRecord(runtimeMetadata.runtimeConfig);
  const agentModel = db
    .prepare("SELECT model FROM agents WHERE id = ? LIMIT 1")
    .get(input.agent.id) as AgentModelRow | undefined;

  const candidates = [
    runtimeMetadata.model,
    runtimeMetadata.modelId,
    runtimeMetadata.hermesModel,
    seededAdapterConfig.model,
    seededRuntimeConfig.model,
    adapterConfig.model,
    runtimeConfig.model,
    agentModel?.model,
  ];

  for (const candidate of candidates) {
    const value = stringFrom(candidate);
    if (value) return value;
  }
  return "";
}

function buildEnv(command: string): NodeJS.ProcessEnv {
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
    PATH: pathEntries.filter(Boolean).join(":"),
  };
}

function buildHermesConfig(command: string, model: string): HermesExecConfig {
  return {
    command,
    args: ["acp"],
    model,
    cliDisplay: `${path.basename(command)} acp`,
  };
}

function hermesSessionParams(cwd: string, model: string): Record<string, unknown> {
  const params: Record<string, unknown> = {
    cwd,
    mcpServers: [],
  };
  if (model) params.model = model;
  return params;
}

function mergeUsage(base: HermesUsage, raw: unknown): HermesUsage {
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

function extractContentText(update: Record<string, unknown>): string {
  const content = update.content;
  const contentRecord = asRecord(content);
  if (contentRecord) {
    const text = stringFrom(contentRecord.text);
    if (text) return text;
  }
  if (Array.isArray(content)) {
    return extractACPToolCallText(content);
  }
  return stringFrom(update.text);
}

function extractACPToolCallText(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const record = asRecord(block);
    if (!record) continue;
    const type = stringFrom(record.type);
    if (type === "content") {
      const inner = asRecord(record.content);
      const text = stringFrom(inner?.text);
      if (text) parts.push(text);
      continue;
    }
    if (type === "diff") {
      const filePath = stringFrom(record.path);
      if (!filePath) continue;
      const oldText = stringFrom(record.oldText);
      const newText = stringFrom(record.newText);
      parts.push(oldText ? `--- ${filePath}\n+++ ${filePath}\n(edited: ${oldText.length} -> ${newText.length} bytes)` : `--- ${filePath}\n+++ ${filePath}\n(new file, ${newText.length} bytes)`);
    }
  }
  return parts.join("\n");
}

function normalizeACPUpdateType(value: string): string {
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

function normalizeACPUpdate(update: unknown): { type: string; data: Record<string, unknown> } | null {
  const record = asRecord(update);
  if (!record) return null;

  const explicitType = normalizeACPUpdateType(
    stringFrom(record.sessionUpdate) || stringFrom(record.type),
  );
  if (explicitType) return { type: explicitType, data: record };

  const entries = Object.entries(record);
  if (entries.length === 1) {
    const [key, value] = entries[0]!;
    const wrappedType = normalizeACPUpdateType(key);
    const wrappedRecord = asRecord(value);
    if (wrappedType && wrappedRecord) return { type: wrappedType, data: wrappedRecord };
  }

  return null;
}

function toolNameFromTitle(title: string, kind: string): string {
  if (title === "execute code") return "execute_code";
  const colonIndex = title.indexOf(":");
  if (colonIndex > 0) {
    const name = title.slice(0, colonIndex).trim();
    if (name === "terminal") return "terminal";
    if (name === "read") return "read_file";
    if (name === "write") return "write_file";
    if (name.startsWith("patch")) return "patch";
    if (name === "search") return "search_files";
    if (name === "web search") return "web_search";
    if (name === "extract") return "web_extract";
    if (name === "delegate") return "delegate_task";
    if (name === "analyze image") return "vision_analyze";
    return name;
  }
  if (kind === "read") return "read_file";
  if (kind === "edit") return "write_file";
  if (kind === "execute") return "terminal";
  if (kind === "search") return "search_files";
  if (kind === "fetch") return "web_search";
  if (kind === "think") return "thinking";
  return title || kind || "tool";
}

function parseToolInput(update: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(update.rawInput) ?? asRecord(update.input) ?? asRecord(update.parameters);
}

function providerErrorFromStderr(stderr: string): string | null {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const detailRegex = /(?:Error:|detail:|Details:)\s*(.+)/i;
  const headerRegex = /(?:BadRequestError|AuthenticationError|RateLimitError|HTTP [0-9]{3}|Non-retryable|API call failed)/i;
  for (const line of lines) {
    const match = detailRegex.exec(line);
    if (match?.[1]?.trim()) return `HERMES provider error: ${match[1].trim()}`;
  }
  const header = lines.find((line) => headerRegex.test(line));
  return header ? `HERMES provider error: ${header}` : null;
}

class HermesRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private readonly assistantChunks: string[] = [];
  private readonly thinkingChunks: string[] = [];
  private readonly toolCalls: HermesToolCall[] = [];
  private readonly toolResults: HermesToolResult[] = [];
  private readonly pendingToolNames = new Map<string, string>();
  private usage: HermesUsage = { ...ZERO_HERMES_USAGE };
  private promptStopReason: string | null = null;
  private sessionId: string | null = null;

  constructor(private readonly writer: Writable) {}

  async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId;
    this.nextId += 1;

    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
    });

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    await this.writeLine(payload);
    return result;
  }

  closeAllPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  handleLine(line: string): void {
    let parsed: unknown;
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
      void this.handleAgentRequest(raw);
      return;
    }
    if (method) {
      this.handleNotification(raw);
    }
  }

  snapshot(): {
    sessionId: string | null;
    assistantText: string;
    thinkingText: string;
    toolCalls: HermesToolCall[];
    toolResults: HermesToolResult[];
    usage: HermesUsage;
    promptStopReason: string | null;
  } {
    return {
      sessionId: this.sessionId,
      assistantText: this.assistantChunks.join(""),
      thinkingText: this.thinkingChunks.join(""),
      toolCalls: [...this.toolCalls],
      toolResults: [...this.toolResults],
      usage: { ...this.usage },
      promptStopReason: this.promptStopReason,
    };
  }

  private writeLine(payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.writer.write(`${payload}\n`, (error: Error | null | undefined) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private handleResponse(raw: Record<string, unknown>): void {
    const id = numberFrom(raw.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);

    const errorRecord = asRecord(raw.error);
    if (errorRecord) {
      pending.reject(
        new Error(`${pending.method}: ${stringFrom(errorRecord.message) || "JSON-RPC error"} (code=${numberFrom(errorRecord.code) || "unknown"})`),
      );
      return;
    }

    const result = asRecord(raw.result) ?? {};
    if (pending.method === "session/new" || pending.method === "session/resume") {
      this.sessionId = stringFrom(result.sessionId) || this.sessionId;
    }
    if (pending.method === "session/prompt") {
      this.extractPromptResult(result);
    }
    pending.resolve(result);
  }

  private async handleAgentRequest(raw: Record<string, unknown>): Promise<void> {
    const method = stringFrom(raw.method);
    const id = raw.id;
    const response = method === "session/request_permission"
      ? {
          jsonrpc: "2.0",
          id,
          result: {
            outcome: {
              outcome: "selected",
              optionId: "approve_for_session",
            },
          },
        }
      : {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `method not found: ${method || "unknown"}`,
          },
        };

    try {
      await this.writeLine(JSON.stringify(response));
    } catch {
      // The run will surface the transport failure through the main request.
    }
  }

  private handleNotification(raw: Record<string, unknown>): void {
    const method = stringFrom(raw.method);
    if (method !== "session/update" && method !== "session/notification") return;

    const params = asRecord(raw.params);
    const normalized = normalizeACPUpdate(params?.update);
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
    if (normalized.type === "tool_call") {
      this.handleToolCall(normalized.data);
      return;
    }
    if (normalized.type === "tool_call_update") {
      this.handleToolCallUpdate(normalized.data);
      return;
    }
    if (normalized.type === "usage_update" || normalized.type === "turn_end") {
      this.extractPromptResult(normalized.data);
    }
  }

  private handleToolCall(update: Record<string, unknown>): void {
    const callId = stringFrom(update.toolCallId) || `tool-${this.toolCalls.length + 1}`;
    const title = stringFrom(update.title) || stringFrom(update.name);
    const kind = stringFrom(update.kind);
    const toolName = toolNameFromTitle(title, kind);
    this.pendingToolNames.set(callId, toolName);
    this.toolCalls.push({
      callId,
      toolName,
      title,
      kind,
      input: parseToolInput(update),
    });
  }

  private handleToolCallUpdate(update: Record<string, unknown>): void {
    const callId = stringFrom(update.toolCallId) || `tool-${this.toolResults.length + 1}`;
    const title = stringFrom(update.title) || stringFrom(update.name);
    const kind = stringFrom(update.kind);
    const toolName = this.pendingToolNames.get(callId) || toolNameFromTitle(title, kind);
    const status = stringFrom(update.status) || "updated";
    if (status !== "completed" && status !== "failed") return;

    const rawOutput = stringFrom(update.rawOutput) || stringFrom(update.output);
    const output = rawOutput || (Array.isArray(update.content) ? extractACPToolCallText(update.content) : "");
    this.toolResults.push({ callId, toolName, status, output });
    this.pendingToolNames.delete(callId);
  }

  private extractPromptResult(result: Record<string, unknown>): void {
    const stopReason = stringFrom(result.stopReason);
    if (stopReason) this.promptStopReason = stopReason;
    this.usage = mergeUsage(this.usage, result);
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams, client: HermesRpcClient): Promise<{ exitCode: number | null; signal: string | null; error: Error | null }> {
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

async function runHermes(config: HermesExecConfig, prompt: string, cwd: string, opts?: {
  onPidReady?: (pid: number | undefined) => void;
  onExit?: () => void;
  runId?: string;
}): Promise<HermesExecResult> {
  const started = Date.now();
  const timeoutMs = numberFromEnv("MC_HERMES_EXEC_TIMEOUT_MS", DEFAULT_HERMES_TIMEOUT_MS);
  const stdoutLines: string[] = [];
  let stderr = "";
  let timeoutHit = false;

  const child = spawn(config.command, config.args, {
    cwd,
    env: buildEnv(config.command),
  });
  opts?.onPidReady?.(child.pid);
  const client = new HermesRpcClient(child.stdin);
  const exitPromise = waitForExit(child, client);

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    stdoutLines.push(trimmed);
    if (stdoutLines.length > 120) stdoutLines.shift();
    client.handleLine(trimmed);
  });
  rl.on("close", () => {
    client.closeAllPending(new Error("HERMES stdout closed before completing the active JSON-RPC request"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = trimForStorage(`${stderr}${chunk.toString("utf8")}`, 12000);
  });

  const timeout = setTimeout(() => {
    timeoutHit = true;
    client.closeAllPending(new Error(`HERMES timed out after ${formatDuration(timeoutMs)}`));
    child.kill("SIGTERM");
  }, timeoutMs);

  let driveError: string | null = null;
  try {
    await client.request("initialize", {
      protocolVersion: 1,
      clientInfo: {
        name: "hiverunner",
        version: "0.1.0",
      },
      clientCapabilities: {},
    });

    const sessionResult = await client.request("session/new", hermesSessionParams(cwd, config.model));
    const sessionId = stringFrom(sessionResult.sessionId);
    if (!sessionId) {
      throw new Error("HERMES session/new returned no session ID");
    }

    if (config.model) {
      await client.request("session/set_model", {
        sessionId,
        modelId: config.model,
      });
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
      // ignore transport shutdown races
    }
  }

  if (driveError && !child.killed) {
    child.kill("SIGTERM");
  }

  const exit = await Promise.race([
    exitPromise,
    new Promise<{ exitCode: number | null; signal: string | null; error: Error | null }>((resolve) => {
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        if (opts?.runId) cleanupRunArtifacts(opts.runId).catch(() => {});
        resolve({ exitCode: null, signal: "SIGKILL", error: new Error("HERMES process did not exit after stdin closed") });
      }, 3000);
    }),
  ]);
  opts?.onExit?.();
  rl.close();

  const snapshot = client.snapshot();
  const providerError = providerErrorFromStderr(stderr);
  const stopReasonError = snapshot.promptStopReason === "cancelled" ? "HERMES cancelled the prompt" : null;
  const errorMessage =
    timeoutHit
      ? `HERMES timed out after ${formatDuration(timeoutMs)}`
      : driveError || stopReasonError || (snapshot.assistantText.trim() ? null : providerError) || exit.error?.message || null;

  return {
    ok: !errorMessage,
    sessionId: snapshot.sessionId,
    assistantText: snapshot.assistantText,
    thinkingText: snapshot.thinkingText,
    toolCalls: snapshot.toolCalls,
    toolResults: snapshot.toolResults,
    usage: snapshot.usage,
    promptStopReason: snapshot.promptStopReason,
    stdoutTail: trimForStorage(stdoutLines.join("\n"), 4000),
    stderr,
    exitCode: exit.exitCode,
    signal: exit.signal,
    errorMessage,
    durationMs: Date.now() - started,
  };
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
       WHERE task_id = ? AND source = 'hermes' AND external_ref = ?
       LIMIT 1`,
    )
    .get(task.id, input.externalRef) as { id: string } | undefined;
  if (existing) return true;

  const now = new Date().toISOString();
  const sanitized = sanitizeAgentCommentLinks(input.body);
  if (sanitized.invalidLinks.length > 0) {
    console.warn("[hermes:link-verification] withheld agent comment with invalid external links", {
      taskId: task.id,
      invalidLinks: sanitized.invalidLinks.map((link) => ({ url: link.url, status: link.status, reason: link.reason })),
    });
  }
  input.db
    .prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, author_user_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 'status_update', 'hermes', ?, ?, ?)`,
    )
    .run(randomUUID(), task.id, input.agentId, sanitized.body, input.externalRef, now, now);
  return true;
}

function buildCommentBody(input: {
  ok: boolean;
  config: HermesExecConfig;
  workspaceRoot: string;
  durationMs: number;
  sessionId: string | null;
  assistantText: string;
  stderr: string;
  errorMessage: string | null;
  toolCallNames: string[];
}): string {
  const status = input.ok ? "completed" : "failed";
  const parts = [
    `HERMES execution ${status}.`,
    "",
    `Command: ${input.config.cliDisplay}`,
    `Workspace: ${input.workspaceRoot}`,
    input.config.model ? `Model: ${input.config.model}` : "Model: HERMES default",
    `Duration: ${formatDuration(input.durationMs)}`,
  ];

  if (input.sessionId) parts.push(`ACP session: ${input.sessionId}`);
  if (input.toolCallNames.length > 0) parts.push(`Tools: ${input.toolCallNames.join(", ")}`);
  if (input.errorMessage) parts.push("", `Error: ${input.errorMessage}`);
  if (input.assistantText.trim()) {
    parts.push("", "Summary:", trimForStorage(input.assistantText.trim(), 3500));
  }
  if (input.stderr.trim()) {
    parts.push("", "Stderr:", trimForStorage(input.stderr.trim(), 2000));
  }

  return trimForStorage(parts.join("\n"), 7000);
}

function uniqueToolNames(toolCalls: HermesToolCall[], toolResults: HermesToolResult[]): string[] {
  const names = new Set<string>();
  for (const tool of toolCalls) {
    if (tool.toolName) names.add(tool.toolName);
  }
  for (const tool of toolResults) {
    if (tool.toolName) names.add(tool.toolName);
  }
  return [...names];
}

async function execute(input: ExecutionInput): Promise<ExecutionResult> {
  const db = getDb();
  const runtime = resolveHermesRuntime(db, input);
  const command = resolveCommand(runtime);
  const workspaceRoot = resolveWorkspaceRoot(db, input, runtime);
  const model = resolveModel(db, input, runtime);
  const config = buildHermesConfig(command, model);

  const startedAt = new Date().toISOString();
  const { executionRunId } = input;
  const result = await runHermes(config, input.prompt, workspaceRoot, executionRunId ? {
    onPidReady: (pid) => {
      if (!pid) return;
      try { db.prepare("UPDATE execution_runs SET process_pid = ? WHERE id = ?").run(pid, executionRunId); } catch {}
    },
    onExit: () => {
      try { db.prepare("UPDATE execution_runs SET process_pid = NULL WHERE id = ?").run(executionRunId); } catch {}
    },
    runId: executionRunId,
  } : undefined);
  const completedAt = new Date().toISOString();
  const assistantTranscript = transcriptText(result.assistantText);
  const thinkingTranscript = transcriptText(result.thinkingText, 6000);
  const stderrTranscript = transcriptText(result.stderr, 6000);
  const toolResultTranscript = transcriptText(
    result.toolResults
      .map((tool) => [tool.toolName, tool.output].filter(Boolean).join(": "))
      .filter(Boolean)
      .join("\n"),
    6000,
  );
  const toolCallNames = uniqueToolNames(result.toolCalls, result.toolResults);
  const totalInputTokens = result.usage.inputTokens + result.usage.cachedReadTokens;

  const externalRef = `hermes:${input.agent.id}:${input.session.taskKey}:${startedAt}`;
  const commentBody = buildCommentBody({
    ok: result.ok,
    config,
    workspaceRoot,
    durationMs: result.durationMs,
    sessionId: result.sessionId,
    assistantText: result.assistantText,
    stderr: result.stderr,
    errorMessage: result.errorMessage,
    toolCallNames,
  });

  let taskEvidenceCommentCreated = false;
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
      `[hermes-adapter] failed to persist task comment for ${input.agent.id}/${input.session.taskKey}:`,
      error,
    );
  }

  const usage = {
    provider: "hermes",
    runnerProvider: "hermes",
    runnerModel: model || null,
    integrationPath: "acp-json-rpc",
    command: path.basename(command),
    runtimeSlug: runtime?.runtime_slug ?? null,
    runtimeScope: runtime?.scope ?? null,
    runtimeDisplayName: runtime?.display_name ?? null,
    workspaceRoot,
    model: model || null,
    taskEvidenceCommentCreated,
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    sessionId: result.sessionId,
    promptStopReason: result.promptStopReason,
    resultText: result.assistantText,
    stdoutTail: result.stdoutTail,
    stderrTail: trimForStorage(result.stderr, 2000),
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    totalInputTokens,
    totalOutputTokens: result.usage.outputTokens,
    totalTokens: result.usage.totalTokens,
    thoughtTokens: result.usage.thoughtTokens,
    cacheReadTokens: result.usage.cachedReadTokens,
    toolCallNames,
    observedThinking: Boolean(thinkingTranscript.body),
    observedStructuredTools: toolCallNames.length > 0,
    transcriptEvents: [
      {
        kind: "run_start",
        role: "system",
        title: "HERMES ACP command",
        body: config.cliDisplay,
        occurredAt: startedAt,
        metadata: {
          command,
          args: config.args,
          workspaceRoot,
          runtimeSlug: runtime?.runtime_slug ?? null,
          runtimeScope: runtime?.scope ?? null,
          model: model || null,
        },
      },
      ...(thinkingTranscript.body
        ? [{
            kind: "thinking_summary",
            role: "assistant",
            title: "thinking",
            body: thinkingTranscript.body,
            occurredAt: completedAt,
            metadata: {
              truncated: thinkingTranscript.truncated,
              rawLength: result.thinkingText.length,
            },
          }]
        : []),
      ...result.toolCalls.map((tool) => ({
        kind: "tool_call_start",
        role: "tool",
        title: tool.toolName,
        body: tool.title || `HERMES reported tool use: ${tool.toolName}`,
        occurredAt: completedAt,
        metadata: {
          callId: tool.callId,
          toolName: tool.toolName,
          title: tool.title,
          kind: tool.kind,
          input: tool.input,
        },
      })),
      ...(toolResultTranscript.body
        ? [{
            kind: "tool_result",
            role: "tool",
            title: "tool results",
            body: toolResultTranscript.body,
            occurredAt: completedAt,
            metadata: {
              truncated: toolResultTranscript.truncated,
              rawLength: result.toolResults.reduce((sum, tool) => sum + tool.output.length, 0),
            },
          }]
        : []),
      ...(assistantTranscript.body
        ? [{
            kind: "assistant_text_final",
            role: "assistant",
            title: "assistant",
            body: assistantTranscript.body,
            occurredAt: completedAt,
            metadata: {
              truncated: assistantTranscript.truncated,
              sessionId: result.sessionId,
              promptStopReason: result.promptStopReason,
            },
          }]
        : []),
      ...(stderrTranscript.body && !result.ok
        ? [{
            kind: "error",
            role: "error",
            title: "stderr",
            body: stderrTranscript.body,
            occurredAt: completedAt,
            metadata: {
              truncated: stderrTranscript.truncated,
              rawLength: result.stderr.length,
            },
          }]
        : []),
      {
        kind: result.ok ? "run_end" : "run_error",
        role: "system",
        title: result.ok ? "HERMES completed" : "HERMES failed",
        body: result.ok
          ? `HERMES completed in ${formatDuration(result.durationMs)}.`
          : result.errorMessage || "HERMES failed.",
        occurredAt: completedAt,
        metadata: {
          exitCode: result.exitCode,
          signal: result.signal,
          durationMs: result.durationMs,
          sessionId: result.sessionId,
          promptStopReason: result.promptStopReason,
        },
      },
    ],
    note: "HERMES ACP emitted JSON-RPC telemetry. HiveRunner persists normalized assistant, thinking, tool, usage, and lifecycle events as post-run transcript evidence.",
  };

  if (!result.ok) {
    return {
      error: result.errorMessage || "HERMES execution failed",
      runnerProvider: "hermes",
      runnerModel: model || null,
      usage,
    };
  }

  return {
    messageCountBefore: 0,
    runnerProvider: "hermes",
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
         AND adapter_type = 'hermes'
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
      `[engine:runtime] failed to clear HERMES task session for ${input.agentId}/${input.taskKey} (${input.reason}):`,
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

export const hermesExecutionAdapter: ExecutionAdapter = {
  adapterType: "hermes",
  execute,
  clearTaskSessionForSelfHeal,
  cancel: (_runId, pid, _sessionId) => cancelByPid(pid),
};
