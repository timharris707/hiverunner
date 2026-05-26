/**
 * HiveRunner - Anthropic Execution Adapter
 *
 * Runs Claude Code as a local CLI provider for heartbeat Tasks.
 * This path captures Claude stream-json telemetry and a summarized Task
 * comment, but does not expose Claude session IDs to the OpenClaw-style
 * session importer until provider-specific transcript import is wired.
 */

import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

import {
  collectAnthropicCliTelemetry,
  summarizeAnthropicCliOutput,
} from "@/lib/orchestration/anthropic-execution-bridge";
import { readProjectSourceWorkspaceRoot } from "@/lib/orchestration/service/shared";
import {
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { sanitizeAgentCommentLinks } from "@/lib/orchestration/comment-link-verification";
import { cleanupRunArtifacts } from "../cleanup";
import { DEFAULT_CLAUDE_TIMEOUT_MS } from "@/lib/orchestration/execution-timeouts";

import type {
  CancelAdapterResult,
  ExecutionAdapter,
  ExecutionInput,
  ExecutionResult,
  ExecutionSelfHealInput,
} from "./types";

type AnthropicRuntimeRow = {
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
  project_settings_json: string | null;
};

type AgentModelRow = {
  model: string | null;
};

type ClaudeExecConfig = {
  command: string;
  args: string[];
  model: string;
  permissionMode: string;
  stdinPrompt: string;
  cliDisplay: string;
};

type ClaudeExecResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  errorMessage: string | null;
  durationMs: number;
};

const DEFAULT_CLAUDE_MAX_BUFFER = 10 * 1024 * 1024;
const TIMEOUT_SIGKILL_GRACE_MS = parseInt(process.env.MC_TIMEOUT_SIGKILL_GRACE_MS ?? "8000", 10);
const CANCEL_SIGKILL_GRACE_MS = parseInt(process.env.MC_CANCEL_SIGKILL_GRACE_MS ?? "5000", 10);

function getDb(): Database.Database {
  // Lazy require keeps adapter registry imports from opening a live DB.
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

function normalizeClaudeModel(value: string): string {
  const model = value.trim().replace(/^anthropic\//i, "").toLowerCase();
  if (
    !model ||
    model === "auto" ||
    model === "default" ||
    model === "claude" ||
    model === "claude-default" ||
    model === "sonnet" ||
    model === "claude-sonnet" ||
    model === "sonnet-3.7" ||
    model === "sonnet-3-7" ||
    model === "claude-3.7-sonnet" ||
    model === "claude-3-7-sonnet" ||
    model === "claude-sonnet-3.7" ||
    model === "claude-sonnet-3-7" ||
    model === "sonnet-4.5" ||
    model === "sonnet-4-5" ||
    model === "claude-sonnet-4.5" ||
    model === "claude-sonnet-4-5"
  ) {
    return "claude-sonnet-4-6";
  }
  if (model === "opus" || model === "claude-opus") {
    return "claude-opus-4-7";
  }
  return model;
}

function isClaudeModelCandidate(value: string): boolean {
  const normalized = value.trim().replace(/^anthropic\//i, "").toLowerCase();
  return (
    normalized === "auto" ||
    normalized === "default" ||
    normalized === "claude" ||
    normalized === "sonnet" ||
    normalized === "opus" ||
    normalized === "haiku" ||
    normalized.includes("claude") ||
    normalized.includes("sonnet") ||
    normalized.includes("opus") ||
    normalized.includes("haiku")
  );
}

function normalizedClaudeModelFromCandidate(candidate: unknown): string | null {
  const value = stringFrom(candidate);
  if (!value || !isClaudeModelCandidate(value)) return null;
  return normalizeClaudeModel(value);
}

function resolveAnthropicRuntime(
  db: Database.Database,
  input: ExecutionInput,
): AnthropicRuntimeRow | null {
  const rows = db
    .prepare(
      `SELECT command, display_name, runtime_slug, scope, workspace_root, metadata_json
       FROM agent_runtimes
       WHERE company_id = ?
         AND provider = 'anthropic'
         AND status <> 'disabled'
         AND (agent_id = ? OR agent_id IS NULL)
       ORDER BY
         CASE WHEN agent_id = ? THEN 0 ELSE 1 END,
         CASE scope WHEN 'agent' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
         updated_at DESC
       LIMIT 1`,
    )
    .all(input.agent.company_id, input.agent.id, input.agent.id) as AnthropicRuntimeRow[];

  return rows[0] ?? null;
}

function resolveWorkspaceRoot(
  db: Database.Database,
  input: ExecutionInput,
  runtime: AnthropicRuntimeRow | null,
): string {
  const row = db
    .prepare(
      `SELECT
         c.id AS company_id,
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
  const explicitRuntimeRoot = runtime?.workspace_root?.trim();
  if (explicitRuntimeRoot) {
    fs.mkdirSync(path.resolve(explicitRuntimeRoot), { recursive: true });
  }

  const projectSourceWorkspaceRoot = readProjectSourceWorkspaceRoot(row?.project_settings_json);
  if (projectSourceWorkspaceRoot) {
    const resolved = path.resolve(projectSourceWorkspaceRoot);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
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

function resolveCommand(runtime: AnthropicRuntimeRow | null): string {
  const metadata = parseJson(runtime?.metadata_json);
  const metadataCommand = stringFrom(metadata.commandPath);
  return metadataCommand || runtime?.command?.trim() || "claude";
}

function resolveModel(
  db: Database.Database,
  input: ExecutionInput,
  runtime: AnthropicRuntimeRow | null,
): string {
  const runtimeMetadata = parseJson(runtime?.metadata_json);
  const adapterConfig = parseJson(input.agent.adapter_config_json);
  const runtimeConfig = parseJson(input.agent.runtime_config_json);
  const seededAdapterConfig = parseJson(
    typeof runtimeMetadata.adapterConfig === "string"
      ? runtimeMetadata.adapterConfig
      : JSON.stringify(runtimeMetadata.adapterConfig ?? {}),
  );
  const seededRuntimeConfig = parseJson(
    typeof runtimeMetadata.runtimeConfig === "string"
      ? runtimeMetadata.runtimeConfig
      : JSON.stringify(runtimeMetadata.runtimeConfig ?? {}),
  );
  const agentModel = db
    .prepare("SELECT model FROM agents WHERE id = ? LIMIT 1")
    .get(input.agent.id) as AgentModelRow | undefined;

  const routeModel = normalizedClaudeModelFromCandidate(input.executionRouteAttempt?.target.model);
  if (routeModel) return routeModel;

  const configuredCandidates = [
    runtimeMetadata.model,
    runtimeMetadata.modelId,
    runtimeMetadata.claudeModel,
    seededAdapterConfig.model,
    seededRuntimeConfig.model,
    adapterConfig.model,
    runtimeConfig.model,
  ];

  for (const candidate of configuredCandidates) {
    const model = normalizedClaudeModelFromCandidate(candidate);
    if (model) return model;
  }

  // Lane-routed Anthropic execution may run a Codex/Gemini-profile agent via
  // Claude. In that case the agent profile model is legacy metadata and must
  // not be passed to `claude --model`.
  const agentModelValue = stringFrom(agentModel?.model);
  if (agentModelValue && isClaudeModelCandidate(agentModelValue)) {
    return normalizeClaudeModel(agentModelValue);
  }

  return "claude-sonnet-4-6";
}

function resolvePermissionMode(runtime: AnthropicRuntimeRow | null): string {
  const metadata = parseJson(runtime?.metadata_json);
  return (
    stringFrom(metadata.permissionMode) ||
    stringFrom(metadata.permission_mode) ||
    process.env.MC_CLAUDE_PERMISSION_MODE?.trim() ||
    "bypassPermissions"
  );
}

function buildEnv(command: string): NodeJS.ProcessEnv {
  const pathEntries = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""];
  if (path.isAbsolute(command)) {
    pathEntries.unshift(path.dirname(command));
  }
  return {
    ...process.env,
    PATH: pathEntries.filter(Boolean).join(":"),
  };
}

function buildClaudeConfig(input: {
  command: string;
  model: string;
  permissionMode: string;
  prompt: string;
}): ClaudeExecConfig {
  const args = [
    "--permission-mode",
    input.permissionMode,
    "--model",
    input.model,
    "--print",
    "--input-format",
    "text",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  const cliDisplay =
    `${path.basename(input.command)} ${args.join(" ")} <stdin-prompt>`;
  return {
    command: input.command,
    args,
    model: input.model,
    permissionMode: input.permissionMode,
    stdinPrompt: input.prompt,
    cliDisplay,
  };
}

function runClaude(config: ClaudeExecConfig, cwd: string, opts?: {
  onPidReady?: (pid: number | undefined) => void;
  onExit?: () => void;
  runId?: string;
}): Promise<ClaudeExecResult> {
  const started = Date.now();
  const timeout = numberFromEnv("MC_CLAUDE_EXEC_TIMEOUT_MS", DEFAULT_CLAUDE_TIMEOUT_MS);
  const maxBuffer = numberFromEnv("MC_CLAUDE_EXEC_MAX_BUFFER", DEFAULT_CLAUDE_MAX_BUFFER);

  return new Promise((resolve) => {
    const child = spawn(
      config.command,
      config.args,
      {
        cwd,
        env: buildEnv(config.command),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    opts?.onPidReady?.(child.pid);

    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (input: {
      ok: boolean;
      exitCode: number | null;
      signal: string | null;
      errorMessage: string | null;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: input.ok,
        stdout,
        stderr,
        exitCode: input.exitCode,
        signal: input.signal,
        errorMessage: input.errorMessage,
        durationMs: Date.now() - started,
      });
    };

    const timer = setTimeout(() => {
      if (settled || child.killed) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        if (opts?.runId) cleanupRunArtifacts(opts.runId).catch(() => {});
      }, TIMEOUT_SIGKILL_GRACE_MS);
      finish({
        ok: false,
        exitCode: null,
        signal: "SIGTERM",
        errorMessage: `Claude Code CLI timed out after ${timeout}ms`,
      });
    }, timeout);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.length > maxBuffer) {
        child.kill("SIGTERM");
        finish({
          ok: false,
          exitCode: null,
          signal: "SIGTERM",
          errorMessage: `Claude Code CLI stdout exceeded ${maxBuffer} bytes`,
        });
      }
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > maxBuffer) {
        child.kill("SIGTERM");
        finish({
          ok: false,
          exitCode: null,
          signal: "SIGTERM",
          errorMessage: `Claude Code CLI stderr exceeded ${maxBuffer} bytes`,
        });
      }
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        errorMessage: error.message,
      });
    });
    child.on("close", (code, signal) => {
      opts?.onExit?.();
      finish({
        ok: code === 0,
        exitCode: code,
        signal,
        errorMessage: code === 0
          ? null
          : `Command failed: ${config.cliDisplay}${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
      });
    });

    child.stdin?.write(config.stdinPrompt);
    child.stdin?.end();
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
       WHERE task_id = ? AND source = 'anthropic' AND external_ref = ?
       LIMIT 1`,
    )
    .get(task.id, input.externalRef) as { id: string } | undefined;
  if (existing) return true;

  const now = new Date().toISOString();
  const sanitized = sanitizeAgentCommentLinks(input.body);
  if (sanitized.invalidLinks.length > 0) {
    console.warn("[anthropic:link-verification] withheld agent comment with invalid external links", {
      taskId: task.id,
      invalidLinks: sanitized.invalidLinks.map((link) => ({ url: link.url, status: link.status, reason: link.reason })),
    });
  }
  input.db
    .prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, author_user_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 'status_update', 'anthropic', ?, ?, ?)`,
    )
    .run(randomUUID(), task.id, input.agentId, sanitized.body, input.externalRef, now, now);
  return true;
}

function buildCommentBody(input: {
  ok: boolean;
  config: ClaudeExecConfig;
  workspaceRoot: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
  summary: string | null;
  resultSubtype: string | null;
  toolCallNames: string[];
}): string {
  const status = input.ok ? "completed" : "failed";
  const parts = [`Claude Code execution ${status}.`];

  if (input.resultSubtype && input.resultSubtype !== "success") {
    parts.push("", `Result subtype: ${input.resultSubtype}`);
  }
  if (input.errorMessage) {
    parts.push("", `Error: ${input.errorMessage}`);
  }
  if (input.summary?.trim()) {
    parts.push("", "Summary:", trimForStorage(input.summary.trim(), 3500));
  } else if (input.stdout.trim()) {
    parts.push("", "Stdout:", trimForStorage(input.stdout.trim(), 3000));
  }

  return trimForStorage(parts.join("\n"), 4000);
}

function semanticClaudeError(input: {
  ok: boolean;
  errorMessage: string | null;
  telemetry: ReturnType<typeof collectAnthropicCliTelemetry>;
}): string | null {
  if (!input.ok) {
    return input.errorMessage || "Claude Code CLI failed";
  }
  if (input.telemetry.resultIsError) {
    return input.telemetry.resultErrors[0] || "Claude Code result reported an error";
  }
  if (input.telemetry.resultErrors.length > 0) {
    return input.telemetry.resultErrors.join(" | ");
  }
  if (
    input.telemetry.resultSubtype &&
    input.telemetry.resultSubtype !== "success"
  ) {
    return `Claude Code result subtype: ${input.telemetry.resultSubtype}`;
  }
  return null;
}

async function execute(input: ExecutionInput): Promise<ExecutionResult> {
  const db = getDb();
  const runtime = resolveAnthropicRuntime(db, input);
  const command = resolveCommand(runtime);
  const workspaceRoot = resolveWorkspaceRoot(db, input, runtime);
  const model = resolveModel(db, input, runtime);
  const permissionMode = resolvePermissionMode(runtime);
  const config = buildClaudeConfig({
    command,
    model,
    permissionMode,
    prompt: input.prompt,
  });

  const startedAt = new Date().toISOString();
  const { executionRunId } = input;
  const result = await runClaude(config, workspaceRoot, executionRunId ? {
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
  const telemetry = collectAnthropicCliTelemetry(result.stdout, result.stderr, {
    cli: config.cliDisplay,
  });
  const fallbackSummary = summarizeAnthropicCliOutput(
    result.stdout,
    result.stderr,
    result.errorMessage ?? undefined,
  );
  const summary =
    telemetry.resultText ||
    fallbackSummary ||
    telemetry.assistantSummary ||
    null;
  const errorMessage = semanticClaudeError({
    ok: result.ok,
    errorMessage: result.errorMessage,
    telemetry,
  });
  const ok = !errorMessage;
  const firstStderrLine = result.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  const assistantTranscript = transcriptText(
    telemetry.resultText || telemetry.assistantSummary || summary,
  );
  const thinkingTranscript = transcriptText(telemetry.thinkingSummary, 6000);
  const toolResultTranscript = transcriptText(telemetry.toolResultSummary, 6000);
  const stderrTranscript = transcriptText(result.stderr, 6000);

  const externalRef = `anthropic:${input.agent.id}:${input.session.taskKey}:${startedAt}`;
  const commentBodyBase = buildCommentBody({
    ok,
    config,
    workspaceRoot,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    errorMessage,
    summary,
    resultSubtype: telemetry.resultSubtype,
    toolCallNames: telemetry.toolCallNames,
  });
  const commentBody = !ok && firstStderrLine
    ? trimForStorage(`[CLI_FAILURE] Claude CLI exited ${result.exitCode ?? "unknown"}: ${firstStderrLine}\n\n${commentBodyBase}`, 4000)
    : commentBodyBase;

  let taskEvidenceCommentCreated = false;
  if (!ok) {
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
        `[anthropic-adapter] failed to persist task comment for ${input.agent.id}/${input.session.taskKey}:`,
        error,
      );
    }
  }

  const usage = {
    provider: "anthropic",
    runnerProvider: "anthropic",
    runnerModel: model || null,
    integrationPath: "cli-stream-json",
    command: path.basename(command),
    runtimeSlug: runtime?.runtime_slug ?? null,
    runtimeScope: runtime?.scope ?? null,
    runtimeDisplayName: runtime?.display_name ?? null,
    workspaceRoot,
    model,
    permissionMode,
    taskEvidenceCommentCreated,
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutTail: trimForStorage(result.stdout, 4000),
    stderrTail: trimForStorage(result.stderr, 2000),
    ...telemetry,
    transcriptEvents: [
      {
        kind: "run_start",
        role: "system",
        title: "Claude Code CLI command",
        body: config.cliDisplay,
        occurredAt: startedAt,
        metadata: {
          command,
          args: config.args,
          workspaceRoot,
          runtimeSlug: runtime?.runtime_slug ?? null,
          runtimeScope: runtime?.scope ?? null,
          model,
          permissionMode,
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
              rawLength: telemetry.thinkingSummary.length,
            },
          }]
        : []),
      ...telemetry.toolCallNames.map((toolName) => ({
        kind: "tool_call_start",
        role: "tool",
        title: toolName,
        body: `Claude Code reported tool use: ${toolName}`,
        occurredAt: completedAt,
        metadata: {
          toolName,
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
              rawLength: telemetry.toolResultSummary.length,
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
              resultSubtype: telemetry.resultSubtype,
              sessionId: telemetry.sessionId,
            },
          }]
        : []),
      ...(stderrTranscript.body && !ok
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
        kind: ok ? "run_end" : "run_error",
        role: "system",
        title: ok ? "Claude Code completed" : "Claude Code failed",
        body: ok
          ? `Claude Code completed in ${formatDuration(result.durationMs)}.`
          : errorMessage || "Claude Code failed.",
        occurredAt: completedAt,
        metadata: {
          exitCode: result.exitCode,
          signal: result.signal,
          durationMs: result.durationMs,
          sessionId: telemetry.sessionId,
          resultSubtype: telemetry.resultSubtype,
        },
      },
    ],
    note: "Claude Code CLI emitted stream-json telemetry. HiveRunner persists normalized assistant, thinking, tool, and lifecycle events as post-run transcript evidence.",
  };

  if (errorMessage) {
    return {
      error: errorMessage,
      runnerProvider: "anthropic",
      runnerModel: model || null,
      usage,
    };
  }

  return {
    messageCountBefore: 0,
    runnerProvider: "anthropic",
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
         AND adapter_type = 'anthropic'
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
      `[engine:runtime] failed to clear anthropic task session for ${input.agentId}/${input.taskKey} (${input.reason}):`,
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

export const anthropicExecutionAdapter: ExecutionAdapter = {
  adapterType: "anthropic",
  execute,
  clearTaskSessionForSelfHeal,
  cancel: (_runId, pid) => cancelByPid(pid),
};
