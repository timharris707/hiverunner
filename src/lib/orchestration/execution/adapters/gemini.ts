/**
 * HiveRunner - Gemini Execution Adapter
 *
 * Runs Gemini CLI as a local batch provider for heartbeat tasks. The adapter
 * captures Gemini output as transcript evidence and hands assistant text back
 * to the engine so normal mc-action parsing creates clean task comments.
 */

import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

import {
  ensureAgentSourceWorkspaceLink,
  ensureCompanySourceWorkspaceLink,
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { readProjectSourceWorkspaceRoot } from "@/lib/orchestration/service/shared";
import { cleanupRunArtifacts } from "../cleanup";

import type {
  CancelAdapterResult,
  ExecutionAdapter,
  ExecutionInput,
  ExecutionResult,
  ExecutionSelfHealInput,
} from "./types";

type GeminiRuntimeRow = {
  command: string | null;
  display_name: string;
  runtime_slug: string;
  scope: string;
  workspace_root: string | null;
  metadata_json: string;
};

type WorkspaceRow = {
  company_id: string;
  company_code: string | null;
  company_workspace_slug: string | null;
  company_workspace_root: string | null;
  company_workspace_source: string | null;
  project_settings_json: string | null;
};

type AgentModelRow = {
  model: string | null;
};

type WorkspaceResolution = {
  cwd: string;
  companyWorkspaceRoot: string;
  includeDirectories: string[];
};

type GeminiExecResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  errorMessage: string | null;
  durationMs: number;
};

type GeminiUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const DEFAULT_GEMINI_TIMEOUT_MS = 9 * 60 * 1000;
const DEFAULT_GEMINI_MAX_BUFFER = 10 * 1024 * 1024;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
const TIMEOUT_SIGKILL_GRACE_MS = parseInt(process.env.MC_TIMEOUT_SIGKILL_GRACE_MS ?? "8000", 10);
const CANCEL_SIGKILL_GRACE_MS = parseInt(process.env.MC_CANCEL_SIGKILL_GRACE_MS ?? "5000", 10);
const TEXT_KEYS = new Set(["text", "content", "message", "response", "result", "output"]);

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

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function realDirectoryPath(candidate: string | null | undefined): string | null {
  if (!candidate?.trim()) return null;
  try {
    const resolved = fs.realpathSync(path.resolve(candidate));
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function uniqueIncludeDirectories(cwd: string, candidates: Array<string | null | undefined>): string[] {
  const cwdReal = realDirectoryPath(cwd) ?? path.resolve(cwd);
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const resolved = realDirectoryPath(candidate);
    if (!resolved || resolved === cwdReal) continue;
    unique.add(resolved);
  }
  return Array.from(unique);
}

function normalizeGeminiModel(value: string): string {
  const model = value.trim().replace(/^google\//i, "").toLowerCase();
  if (
    !model ||
    model === "auto" ||
    model === "default" ||
    model === "google-default" ||
    model === "gemini-default" ||
    model === "gemini-pro" ||
    model === "pro"
  ) return DEFAULT_GEMINI_MODEL;
  if (model === "flash") return "gemini-3-flash-preview";
  if (model === "flash-lite") return "gemini-2.5-flash-lite";
  if (/^auto-gemini-2\.5$/i.test(model)) return DEFAULT_GEMINI_MODEL;
  if (/^auto-gemini-3$/i.test(model)) return DEFAULT_GEMINI_MODEL;
  return model;
}

function resolveGeminiRuntime(db: Database.Database, input: ExecutionInput): GeminiRuntimeRow | null {
  const rows = db
    .prepare(
      `SELECT command, display_name, runtime_slug, scope, workspace_root, metadata_json
       FROM agent_runtimes
       WHERE company_id = ?
         AND provider = 'gemini'
         AND status <> 'disabled'
         AND (agent_id = ? OR agent_id IS NULL)
       ORDER BY
         CASE WHEN agent_id = ? THEN 0 ELSE 1 END,
         CASE scope WHEN 'agent' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
         updated_at DESC
       LIMIT 1`,
    )
    .all(input.agent.company_id, input.agent.id, input.agent.id) as GeminiRuntimeRow[];

  return rows[0] ?? null;
}

function resolveWorkspaceRoot(
  db: Database.Database,
  input: ExecutionInput,
  runtime: GeminiRuntimeRow | null,
): WorkspaceResolution {
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
    fs.mkdirSync(resolved, { recursive: true });
    return {
      cwd: resolved,
      companyWorkspaceRoot,
      includeDirectories: uniqueIncludeDirectories(resolved, [
        companyWorkspaceRoot,
        resolved,
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
      includeDirectories: uniqueIncludeDirectories(companyWorkspaceRoot, [
        resolved,
        companyWorkspaceRoot,
        ...(exposeSourceWorkspace ? [agentSource.linkPath, agentSource.targetPath] : []),
      ]),
    };
  }

  return {
    cwd: companyWorkspaceRoot,
    companyWorkspaceRoot,
    includeDirectories: uniqueIncludeDirectories(companyWorkspaceRoot, [
      ...(exposeSourceWorkspace ? [companySource.linkPath, companySource.targetPath] : []),
    ]),
  };
}

function resolveCommand(runtime: GeminiRuntimeRow | null): string {
  const metadata = parseJson(runtime?.metadata_json);
  const metadataCommand = stringFrom(metadata.commandPath);
  return metadataCommand || runtime?.command?.trim() || "gemini";
}

function resolveModel(
  db: Database.Database,
  input: ExecutionInput,
  runtime: GeminiRuntimeRow | null,
): string {
  const metadata = parseJson(runtime?.metadata_json);
  const agentModel = db
    .prepare("SELECT model FROM agents WHERE id = ? LIMIT 1")
    .get(input.agent.id) as AgentModelRow | undefined;

  for (const candidate of [metadata.model, metadata.modelId, agentModel?.model]) {
    const model = normalizeGeminiModel(stringFrom(candidate));
    if (model) return model;
  }
  return DEFAULT_GEMINI_MODEL;
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

function runGemini(
  command: string,
  prompt: string,
  cwd: string,
  model: string,
  includeDirectories: string[],
  opts?: {
    onPidReady?: (pid: number | undefined) => void;
    onExit?: () => void;
    runId?: string;
  },
): Promise<GeminiExecResult> {
  const started = Date.now();
  const timeout = numberFromEnv("MC_GEMINI_EXEC_TIMEOUT_MS", DEFAULT_GEMINI_TIMEOUT_MS);
  const maxBuffer = numberFromEnv("MC_GEMINI_EXEC_MAX_BUFFER", DEFAULT_GEMINI_MAX_BUFFER);
  const args = ["--prompt", prompt, "--output-format", "text", "--approval-mode", "yolo"];
  for (const includeDirectory of includeDirectories) {
    args.push("--include-directories", includeDirectory);
  }
  if (model) {
    args.push("--model", model);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let killFallback: NodeJS.Timeout | null = null;
    const child = execFile(
      command,
      args,
      {
        cwd,
        env: buildEnv(command),
        maxBuffer,
      },
      (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        opts?.onExit?.();
        if (timer) clearTimeout(timer);
        if (killFallback) clearTimeout(killFallback);
        const err = error as (Error & { code?: number | string; signal?: string }) | null;
        const exitCode = typeof err?.code === "number" ? err.code : error ? null : 0;
        resolve({
          ok: !error,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          exitCode,
          signal: typeof err?.signal === "string" ? err.signal : null,
          errorMessage: error ? summarizeGeminiFailure(String(stderr ?? ""), exitCode) : null,
          durationMs: Date.now() - started,
        });
      },
    );
    opts?.onPidReady?.(child.pid);
    timer = setTimeout(() => {
      if (settled || child.killed) return;
      child.kill("SIGTERM");
      killFallback = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
        if (opts?.runId) cleanupRunArtifacts(opts.runId).catch(() => {});
      }, TIMEOUT_SIGKILL_GRACE_MS);
    }, timeout);
  });
}

function summarizeGeminiFailure(stderr: string, exitCode: number | null): string {
  const relevant = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^YOLO mode is enabled/i.test(line))
    .find((line) => /error|notfound|not found|unauthorized|auth|quota|permission|model/i.test(line));
  if (relevant) {
    return `Gemini CLI failed: ${trimForStorage(relevant, 800)}`;
  }
  return `Gemini CLI failed with exit code ${exitCode ?? "unknown"}`;
}

function collectText(value: unknown, texts: string[], keyHint?: string): void {
  if (typeof value === "string") {
    if (!keyHint || TEXT_KEYS.has(keyHint)) {
      const trimmed = value.trim();
      if (trimmed && !texts.includes(trimmed)) texts.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, texts, keyHint);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    collectText(nested, texts, key);
  }
}

function accumulateUsage(value: unknown, usage: GeminiUsage): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) accumulateUsage(item, usage);
    return;
  }
  const record = value as Record<string, unknown>;
  usage.inputTokens += numberFrom(record.promptTokenCount) + numberFrom(record.inputTokens);
  usage.outputTokens += numberFrom(record.candidatesTokenCount) + numberFrom(record.outputTokens);
  usage.totalTokens += numberFrom(record.totalTokenCount) + numberFrom(record.totalTokens);
  for (const nested of Object.values(record)) {
    accumulateUsage(nested, usage);
  }
}

function parseGeminiOutput(stdout: string): { assistantText: string; usage: GeminiUsage } {
  const texts: string[] = [];
  const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      collectText(parsed, texts);
      accumulateUsage(parsed, usage);
    } catch {
      texts.push(trimmed);
    }
  }

  const assistantText = texts
    .map((text) => text.trim())
    .filter(Boolean)
    .filter((text, index, arr) => arr.indexOf(text) === index)
    .join("\n\n")
    .trim();

  return {
    assistantText: stdout.trim() || assistantText,
    usage,
  };
}

async function execute(input: ExecutionInput): Promise<ExecutionResult> {
  const db = getDb();
  const runtime = resolveGeminiRuntime(db, input);
  const command = resolveCommand(runtime);
  const model = resolveModel(db, input, runtime);
  const workspace = resolveWorkspaceRoot(db, input, runtime);
  const workspaceRoot = workspace.cwd;
  const startedAt = new Date().toISOString();
  const { executionRunId } = input;
  const result = await runGemini(command, input.prompt, workspaceRoot, model, workspace.includeDirectories, executionRunId ? {
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
  const parsedOutput = parseGeminiOutput(result.stdout);
  const stdoutTranscript = transcriptText(result.stdout);
  const stderrTranscript = transcriptText(result.stderr, 6000);

  const usage = {
    provider: "gemini",
    runnerProvider: "gemini",
    runnerModel: model || null,
    source: "gemini-cli",
    integrationPath: "cli-batch",
    command: path.basename(command),
    model,
    runtimeSlug: runtime?.runtime_slug ?? null,
    runtimeScope: runtime?.scope ?? null,
    runtimeDisplayName: runtime?.display_name ?? null,
    workspaceRoot,
    companyWorkspaceRoot: workspace.companyWorkspaceRoot,
    includeDirectories: workspace.includeDirectories,
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    inputTokens: parsedOutput.usage.inputTokens,
    outputTokens: parsedOutput.usage.outputTokens,
    totalTokens: parsedOutput.usage.totalTokens,
    ...(result.ok ? { resultText: parsedOutput.assistantText } : {}),
    stdoutTail: trimForStorage(result.stdout, 4000),
    stderrTail: trimForStorage(result.stderr, 2000),
    transcriptEvents: [
      {
        kind: "run_start",
        role: "system",
        title: "Gemini CLI command",
        body: `${path.basename(command)} --prompt <heartbeat> --output-format text${workspace.includeDirectories.length ? " --include-directories <company-workspace>" : ""} --model ${model}`,
        occurredAt: startedAt,
        metadata: {
          command,
          model: model || null,
          workspaceRoot,
          companyWorkspaceRoot: workspace.companyWorkspaceRoot,
          includeDirectories: workspace.includeDirectories,
          runtimeSlug: runtime?.runtime_slug ?? null,
          runtimeScope: runtime?.scope ?? null,
        },
      },
      ...(stdoutTranscript.body
        ? [{
            kind: "assistant_text_final",
            role: "assistant",
            title: "stdout",
            body: stdoutTranscript.body,
            occurredAt: completedAt,
            metadata: {
              stream: "stdout",
              truncated: stdoutTranscript.truncated,
              rawLength: result.stdout.length,
            },
          }]
        : []),
      ...(stderrTranscript.body
        ? [{
            kind: result.ok ? "tool_result" : "error",
            role: result.ok ? "tool" : "error",
            title: "stderr",
            body: stderrTranscript.body,
            occurredAt: completedAt,
            metadata: {
              stream: "stderr",
              truncated: stderrTranscript.truncated,
              rawLength: result.stderr.length,
            },
          }]
        : []),
      {
        kind: result.ok ? "run_end" : "run_error",
        role: "system",
        title: result.ok ? "Gemini completed" : "Gemini failed",
        body: result.ok
          ? `Gemini completed in ${formatDuration(result.durationMs)}.`
          : result.errorMessage || `Gemini failed with exit code ${result.exitCode ?? "unknown"}.`,
        occurredAt: completedAt,
        metadata: {
          exitCode: result.exitCode,
          signal: result.signal,
          durationMs: result.durationMs,
        },
      },
    ],
    note: "Gemini CLI is batch execution. HiveRunner stores raw CLI output in execution history while task comments are created from parsed assistant text and mc-action blocks.",
  };

  if (!result.ok) {
    return {
      error: result.errorMessage || `gemini failed with exit code ${result.exitCode ?? "unknown"}`,
      runnerProvider: "gemini",
      runnerModel: model || null,
      usage,
    };
  }

  return {
    messageCountBefore: 0,
    runnerProvider: "gemini",
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
         AND adapter_type = 'gemini'
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
      `[engine:runtime] failed to clear Gemini task session for ${input.agentId}/${input.taskKey} (${input.reason}):`,
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

export const geminiExecutionAdapter: ExecutionAdapter = {
  adapterType: "gemini",
  execute,
  clearTaskSessionForSelfHeal,
  cancel: (_runId, pid, _sessionId) => cancelByPid(pid),
};
