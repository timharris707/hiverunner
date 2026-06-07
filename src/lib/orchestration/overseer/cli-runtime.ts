import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import {
  appendOverseerMessage,
  completeOverseerTurn,
  createApprovalsForOverseerActions,
  createOverseerTurn,
  getOverseerSession,
  recordOverseerEvent,
  setOverseerTurnProcess,
} from "./service";
import type {
  OverseerQuotaSnapshot,
  OverseerRuntimeProvider,
  OverseerUsageSnapshot,
} from "./types";
import {
  cleanupGeminiCliModelConfig,
  createGeminiCliModelConfig,
  type GeminiCliModelConfig,
} from "@/lib/orchestration/gemini-cli-model-config";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

type GitDiffSnapshot = {
  files: Map<string, { additions: number; deletions: number }>;
};

type ProviderRunResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  runtimeSessionId: string | null;
  assistantText: string;
  usage: OverseerUsageSnapshot;
  quota?: OverseerQuotaSnapshot;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
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

function usageFromRecord(record: Record<string, unknown>, depth = 0): OverseerUsageSnapshot {
  if (depth > 4) return {};
  let usage: OverseerUsageSnapshot = {
    inputTokens: firstNumber(record, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "totalInputTokens"]),
    outputTokens: firstNumber(record, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens", "totalOutputTokens"]),
    cacheReadInputTokens: firstNumber(record, ["cacheReadInputTokens", "cache_read_input_tokens", "cacheReadTokens"]),
    cacheCreationInputTokens: firstNumber(record, ["cacheCreationInputTokens", "cache_creation_input_tokens", "cacheWriteTokens"]),
    totalTokens: firstNumber(record, ["totalTokens", "total_tokens"]),
  };
  for (const key of ["usage", "token_usage", "tokenUsage", "metrics", "data", "result"] as const) {
    const nested = asRecord(record[key]);
    if (nested) usage = mergeUsage(usage, usageFromRecord(nested, depth + 1));
  }
  if (usage.totalTokens === undefined && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) {
    usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  return usage;
}

function threadIdFromRecord(record: Record<string, unknown>): string | null {
  return stringFrom(record.session_id) ||
    stringFrom(record.sessionId) ||
    stringFrom(record.thread_id) ||
    stringFrom(record.threadId) ||
    null;
}

function appendText(existing: string, next: string): string {
  if (!next.trim()) return existing;
  return existing ? `${existing}\n\n${next.trim()}` : next.trim();
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const text = stringFrom(record?.text) || stringFrom(record?.content);
    return text ? [text] : [];
  }).join("\n");
}

function textFromRecord(record: Record<string, unknown>): string {
  const direct = stringFrom(record.result) ||
    stringFrom(record.text) ||
    stringFrom(record.output) ||
    stringFrom(record.content) ||
    stringFrom(record.message);
  if (direct) return direct;
  const message = asRecord(record.message);
  if (message) {
    const nested = stringFrom(message.text) || stringFrom(message.content);
    if (nested) return nested;
  }
  return "";
}

function buildPrompt(input: {
  userMessage: string;
  workspaceRoot: string;
  provider: OverseerRuntimeProvider;
  isResume: boolean;
  fastMode?: boolean;
}): string {
  const providerName = input.provider === "anthropic" ? "Claude Code" : input.provider === "gemini" ? "Gemini CLI" : "Codex";
  return [
    "You are HiveRunner Overseer running inside the HiveRunner product cockpit.",
    `Runtime provider: ${providerName}.`,
    "Use concise operator-facing answers. Ask clarifying questions when needed.",
    input.fastMode ? "Fast Mode is enabled for this session: prioritize shorter check-ins and low-latency investigation paths when that does not reduce correctness." : "Fast Mode is off for this session.",
    "Do not directly perform state-changing HiveRunner actions. When you want to create tasks, update tasks, hire agents, register artifacts, review candidates, mark goals complete, or otherwise mutate HiveRunner state, emit a fenced ```mc-action JSON block. HiveRunner will request approval before executing state-changing actions.",
    "Read-only analysis and reports are allowed. The working root shown below is the bound company/project workspace, not the HiveRunner app repository.",
    `Workspace root: ${input.workspaceRoot}`,
    input.isResume ? "This is a follow-up turn in an existing Overseer runtime session." : "This is the first turn in a new Overseer runtime session.",
    "",
    "Operator message:",
    input.userMessage,
  ].join("\n");
}

function buildEnv(command: string, modelConfig: GeminiCliModelConfig | null = null): NodeJS.ProcessEnv {
  const pathEntries = [process.env.PATH ?? "", "/opt/homebrew/bin", "/usr/local/bin"];
  if (path.isAbsolute(command)) pathEntries.unshift(path.dirname(command));
  return {
    ...process.env,
    ...(modelConfig ? { GEMINI_CLI_SYSTEM_SETTINGS_PATH: modelConfig.settingsPath } : {}),
    PATH: pathEntries.filter(Boolean).join(":"),
  };
}

function readGitDiffSnapshot(cwd: string): GitDiffSnapshot | null {
  try {
    if (!fs.existsSync(path.join(cwd, ".git"))) return null;
    const result = spawnSync("git", ["diff", "--numstat"], { cwd, encoding: "utf8", timeout: 5000 });
    if (result.status !== 0) return null;
    const files = new Map<string, { additions: number; deletions: number }>();
    for (const line of result.stdout.split(/\r?\n/)) {
      const [addedRaw, deletedRaw, filePath] = line.split(/\t/);
      if (!filePath) continue;
      const additions = Number.parseInt(addedRaw ?? "0", 10);
      const deletions = Number.parseInt(deletedRaw ?? "0", 10);
      files.set(filePath, {
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      });
    }
    return { files };
  } catch {
    return null;
  }
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
  return files.length > 0 ? { filesChanged: files.length, additions, deletions, files } : null;
}

function providerEventPrefix(provider: OverseerRuntimeProvider): string {
  return provider === "anthropic" ? "claude" : provider;
}

function mapReasoningEffort(provider: OverseerRuntimeProvider, value: string | null | undefined): string | null {
  if (provider !== "anthropic") return null;
  if (value === "max") return "max";
  if (value === "xhigh") return "xhigh";
  if (value === "high" || value === "medium" || value === "low") return value;
  return null;
}

function providerModelArg(provider: OverseerRuntimeProvider, model: string | null | undefined): string | null {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (provider === "anthropic") {
    return /claude|sonnet|opus|haiku/.test(normalized)
      ? normalized.replace(/^anthropic\//, "")
      : null;
  }
  if (provider === "gemini") {
    return /gemini/.test(normalized)
      ? normalized.replace(/^google\//, "").replace(/^models\//, "")
      : null;
  }
  return normalized;
}

function claudeToolType(name: string): string {
  return /^bash$/i.test(name) ? "command_execution" : "tool_call";
}

function claudeToolCommand(name: string, input: unknown): string {
  const record = asRecord(input);
  if (/^bash$/i.test(name)) return stringFrom(record?.command) || "bash";
  return name;
}

function runProviderProcess(input: {
  provider: OverseerRuntimeProvider;
  command: string;
  sessionId: string;
  turnId: string;
  prompt: string;
  workspaceRoot: string;
  runtimeSessionId: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
}): Promise<ProviderRunResult> {
  const started = Date.now();
  const beforeDiff = readGitDiffSnapshot(input.workspaceRoot);
  const timeoutMs = Number.parseInt(process.env.MC_OVERSEER_CLI_TIMEOUT_MS ?? "", 10) || DEFAULT_TIMEOUT_MS;
  const providerPrefix = providerEventPrefix(input.provider);
  const toolNames = new Map<string, string>();

  const modelArg = providerModelArg(input.provider, input.model);
  const modelConfig = input.provider === "gemini" && modelArg
    ? createGeminiCliModelConfig(modelArg, input.reasoningEffort)
    : null;
  const effectiveModelArg = modelConfig?.alias ?? modelArg;
  const args = input.provider === "anthropic"
    ? [
        "--print",
        "--input-format",
        "text",
        "--output-format",
        "stream-json",
        "--permission-mode",
        "plan",
        ...(input.runtimeSessionId ? ["--resume", input.runtimeSessionId] : ["--session-id", input.sessionId]),
        ...(effectiveModelArg ? ["--model", effectiveModelArg] : []),
        ...(mapReasoningEffort(input.provider, input.reasoningEffort) ? ["--effort", mapReasoningEffort(input.provider, input.reasoningEffort)!] : []),
      ]
    : [
        "--prompt",
        input.prompt,
        "--output-format",
        "stream-json",
        "--approval-mode",
        "plan",
        ...(input.runtimeSessionId ? ["--resume", input.runtimeSessionId] : []),
        ...(effectiveModelArg ? ["--model", effectiveModelArg] : []),
      ];

  return new Promise((resolve) => {
    const child = spawn(input.command, args, {
      cwd: input.workspaceRoot,
      env: buildEnv(input.command, modelConfig),
      stdio: ["pipe", "pipe", "pipe"],
    });
    setOverseerTurnProcess({ sessionId: input.sessionId, turnId: input.turnId, pid: child.pid ?? null });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let buffer = "";
    let usage: OverseerUsageSnapshot = {};
    let runtimeSessionId = input.runtimeSessionId;
    let assistantText = "";
    let bufferedBytes = 0;
    let settled = false;
    let timedOut = false;
    let killedForBuffer = false;
    let spawnError: Error | null = null;

    const persistEvent = (eventType: string, event: Record<string, unknown>) => {
      try {
        recordOverseerEvent({
          sessionId: input.sessionId,
          turnId: input.turnId,
          eventType,
          event: { provider: input.provider, ...event },
        });
      } catch {
        // Provider telemetry should not break an active turn.
      }
    };

    const ingestClaudeRecord = (record: Record<string, unknown>) => {
      const type = stringFrom(record.type);
      if (type === "system" && stringFrom(record.subtype) === "init") {
        runtimeSessionId = threadIdFromRecord(record) ?? runtimeSessionId;
        persistEvent("thread.started", {
          thread_id: runtimeSessionId,
          model: stringFrom(record.model),
        });
        return;
      }
      if (type === "assistant") {
        const message = asRecord(record.message) ?? {};
        const content = Array.isArray(message.content) ? message.content : [];
        for (const blockRaw of content) {
          const block = asRecord(blockRaw);
          if (!block) continue;
          const blockType = stringFrom(block.type);
          if (blockType === "text") {
            const text = stringFrom(block.text);
            assistantText = appendText(assistantText, text);
            if (text) persistEvent("item.completed", { item: { type: "agent_message", text } });
          } else if (blockType === "tool_use") {
            const id = stringFrom(block.id) || `${input.turnId}-${toolNames.size + 1}`;
            const name = stringFrom(block.name) || "tool";
            toolNames.set(id, name);
            persistEvent("item.started", {
              item: {
                id,
                type: claudeToolType(name),
                command: claudeToolCommand(name, block.input),
                name,
              },
            });
          }
        }
        return;
      }
      if (type === "user") {
        const message = asRecord(record.message) ?? {};
        const content = Array.isArray(message.content) ? message.content : [];
        for (const blockRaw of content) {
          const block = asRecord(blockRaw);
          if (!block || stringFrom(block.type) !== "tool_result") continue;
          const id = stringFrom(block.tool_use_id);
          const name = toolNames.get(id) ?? "tool";
          persistEvent("item.completed", {
            item: {
              id,
              type: claudeToolType(name),
              command: name,
              aggregated_output: extractTextContent(block.content),
              name,
            },
          });
        }
        return;
      }
      if (type === "result") {
        runtimeSessionId = threadIdFromRecord(record) ?? runtimeSessionId;
        usage = mergeUsage(usage, usageFromRecord(record));
        assistantText = textFromRecord(record) || assistantText;
      }
    };

    const ingestGenericRecord = (record: Record<string, unknown>) => {
      runtimeSessionId = threadIdFromRecord(record) ?? runtimeSessionId;
      usage = mergeUsage(usage, usageFromRecord(record));
      const text = textFromRecord(record);
      if (text) assistantText = appendText(assistantText, text);
      const type = stringFrom(record.type) || "event";
      persistEvent(`${providerPrefix}.${type}`, record);
    };

    const ingestLine = (lineRaw: string) => {
      const line = lineRaw.trim();
      if (!line) return;
      const record = safeRecord(line);
      if (!record) return;
      if (input.provider === "anthropic") {
        persistEvent(`${providerPrefix}.${stringFrom(record.type) || "event"}`, record);
        ingestClaudeRecord(record);
      } else {
        ingestGenericRecord(record);
      }
    };

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupGeminiCliModelConfig(modelConfig);
      setOverseerTurnProcess({ sessionId: input.sessionId, turnId: input.turnId, pid: null });
      if (buffer.trim()) ingestLine(buffer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (!assistantText && stdout.trim() && input.provider === "gemini") {
        assistantText = stdout
          .split(/\r?\n/)
          .flatMap((line) => {
            const record = safeRecord(line);
            return record ? [textFromRecord(record)] : [];
          })
          .filter(Boolean)
          .join("\n\n")
          .trim();
      }
      const errorMessage = spawnError?.message
        ?? (timedOut ? `${input.provider} Overseer runtime timed out after ${timeoutMs}ms` : null)
        ?? (killedForBuffer ? `${input.provider} Overseer runtime output exceeded ${MAX_BUFFER_BYTES} bytes` : null)
        ?? (exitCode && exitCode !== 0 ? stderr.trim() || `${input.command} exited with ${exitCode}` : null);
      const diff = diffSnapshots(beforeDiff, readGitDiffSnapshot(input.workspaceRoot));
      if (diff) persistEvent("workspace.diff", diff);
      persistEvent("turn.completed", {
        usage,
        runtimeSessionId,
        exitCode,
        signal,
      });
      resolve({
        ok: exitCode === 0 && !spawnError && !timedOut && !killedForBuffer,
        exitCode,
        signal,
        durationMs: Date.now() - started,
        runtimeSessionId,
        assistantText,
        usage,
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
    if (input.provider === "anthropic") child.stdin.end(input.prompt);
    else child.stdin.end();
  });
}

export function detectOverseerCliStatus(provider: OverseerRuntimeProvider): {
  command: string;
  installed: boolean;
  version: string | null;
  authReady: boolean;
  loginStatus: string;
  error?: string;
} {
  const command = provider === "anthropic" ? "claude" : "gemini";
  const version = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0) {
    return {
      command,
      installed: false,
      version: null,
      authReady: false,
      loginStatus: `${command} CLI not found`,
      error: version.error?.message || version.stderr?.trim() || `${command} CLI not found`,
    };
  }
  if (provider === "anthropic") {
    const auth = spawnSync(command, ["auth", "status"], { encoding: "utf8" });
    return {
      command,
      installed: true,
      version: version.stdout.trim() || version.stderr.trim() || null,
      authReady: auth.status === 0,
      loginStatus: `${auth.stdout ?? ""}${auth.stderr ? `\n${auth.stderr}` : ""}`.trim() || (auth.status === 0 ? "Claude logged in" : "Claude auth not ready"),
      error: auth.status === 0 ? undefined : auth.stderr?.trim() || undefined,
    };
  }
  return {
    command,
    installed: true,
    version: version.stdout.trim() || version.stderr.trim() || null,
    authReady: true,
    loginStatus: "Gemini CLI installed; auth is verified by the CLI when a turn starts.",
  };
}

export async function runOverseerCliTurn(input: {
  sessionId: string;
  userMessageId: string;
  userMessage: string;
  provider: Exclude<OverseerRuntimeProvider, "codex">;
}): Promise<{
  session: ReturnType<typeof getOverseerSession>;
  turnId: string;
  assistantMessageId: string | null;
  approvalIds: string[];
  ok: boolean;
}> {
  const session = getOverseerSession(input.sessionId);
  const isResume = Boolean(session.codexSessionId);
  const prompt = buildPrompt({
    userMessage: input.userMessage,
    workspaceRoot: session.workspaceRoot,
    provider: input.provider,
    isResume,
    fastMode: session.scope.fastMode === true,
  });
  const turn = createOverseerTurn({
    sessionId: session.id,
    userMessageId: input.userMessageId,
    prompt,
  });
  const command = input.provider === "anthropic" ? "claude" : "gemini";
  recordOverseerEvent({
    sessionId: session.id,
    turnId: turn.id,
    eventType: `${providerEventPrefix(input.provider)}.${isResume ? "resume" : "exec"}.started`,
    event: {
      provider: input.provider,
      runtimeSessionId: session.codexSessionId,
      workspaceRoot: session.workspaceRoot,
      fastMode: session.scope.fastMode === true,
    },
  });

  const result = await runProviderProcess({
    provider: input.provider,
    command,
    sessionId: session.id,
    turnId: turn.id,
    prompt,
    workspaceRoot: session.workspaceRoot,
    runtimeSessionId: session.codexSessionId,
    model: session.model,
    reasoningEffort: session.reasoningEffort,
  });

  const assistant = result.assistantText.trim()
    ? appendOverseerMessage({
        sessionId: session.id,
        turnId: turn.id,
        role: "assistant",
        content: result.assistantText.trim(),
        metadata: {
          provider: input.provider,
          runtimeSessionId: result.runtimeSessionId,
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
    codexSessionId: result.runtimeSessionId ?? session.codexSessionId ?? session.id,
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
