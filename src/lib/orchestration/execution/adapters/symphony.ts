/**
 * HiveRunner - Symphony Execution Adapter
 *
 * Dispatches a HiveRunner task to a configured Symphony-compatible command.
 * The command receives a JSON payload on stdin and may return either plain text
 * or JSON. This deliberately keeps HiveRunner's task routing independent from
 * Symphony's current reference Linear poller.
 */

import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

import {
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { listRuntimeAgentSkills } from "@/lib/orchestration/company-skills";
import { readProjectSourceWorkspaceRoot, resolveTaskExecutionRouting } from "@/lib/orchestration/service/shared";
import {
  mapTaskRowToSymphonyIssue,
  parseDependencyKeys,
  parseJsonArray,
  stringFrom,
  taskUrlFor,
  type HiveRunnerSymphonyIssueRow,
} from "@/lib/orchestration/symphony/issue";

import type {
  ExecutionAdapter,
  ExecutionInput,
  ExecutionResult,
} from "./types";
import {
  buildWorkspaceRunVisibility,
  captureWorkspaceGitSnapshots,
  detectReadOnlyIntent,
} from "../workspace-run-visibility";

type SymphonyRuntimeRow = {
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
  company_name: string;
  company_slug: string;
  company_workspace_slug: string | null;
  company_workspace_root: string | null;
  company_workspace_source: string | null;
  project_settings_json: string | null;
};

type MatrixExecutionDefaults = {
  runnerProvider?: string;
  runtimeLabel?: string;
  modelRouting?: string;
  modelRoutingLabel?: string;
  activeHiveId?: string;
  activeHiveName?: string;
  source: string;
};

type TaskPayloadRow = HiveRunnerSymphonyIssueRow;

type SymphonyExecConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
  runnerProvider: string;
  runnerModel: string | null;
  modelRouting: string | null;
  modelRoutingLabel: string | null;
  activeHiveId: string | null;
  activeHiveName: string | null;
  cwd: string;
  companyWorkspaceRoot: string;
  sourceWorkspaceRoot: string | null;
  additionalWritableDirs: string[];
  displayName: string;
  runtimeSlug: string | null;
  capabilities: Record<string, unknown>;
};

type WorkspaceResolution = Pick<
  SymphonyExecConfig,
  "cwd" | "companyWorkspaceRoot" | "sourceWorkspaceRoot" | "additionalWritableDirs"
>;

type SymphonyExecResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  stdoutTail: string;
  stderrTail: string;
  stdoutBytes: number;
  stderrBytes: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  killedForBuffer: boolean;
  terminationReason: string | null;
  failureClass: string | null;
  errorMessage: string | null;
  durationMs: number;
};

type SymphonyRunCommandOptions = {
  executionRunId?: string;
  heartbeatRunId?: string | null;
  db?: Database.Database;
};

const DEFAULT_SYMPHONY_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_SYMPHONY_MAX_BUFFER = 10 * 1024 * 1024;

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
    ? value as Record<string, unknown>
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

function stringArrayFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  const text = stringFrom(value);
  return text ? splitCommandLine(text) : [];
}

function optionalString(value: unknown): string | undefined {
  const text = stringFrom(value);
  return text || undefined;
}

function numberFrom(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRunnerProvider(value: string | null | undefined): string {
  const provider = value?.trim().toLowerCase() ?? "";
  if (provider === "anthropic" || provider === "claude" || provider === "claude-code") return "anthropic";
  if (provider === "google" || provider === "gemini" || provider === "gemini-cli") return "gemini";
  if (provider === "hermes" || provider === "hermes-agent" || provider === "hermes-acp") return "hermes";
  if (provider === "openclaw" || provider === "openclaw-gateway") return "openclaw";
  if (provider === "openai" || provider === "codex" || provider === "openai-codex") return "codex";
  return provider || "codex";
}

function normalizeCodexCliModel(value: unknown): string | null {
  const model = optionalString(value)
    ?.replace(/^openai-codex\//i, "")
    .replace(/^openai\//i, "")
    .replace(/^codex\//i, "")
    .trim();
  if (!model) return null;
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
    return null;
  }
  return model;
}

function modelForRunnerProvider(runnerProvider: string, model: unknown): string | null {
  if (runnerProvider !== "codex") return optionalString(model) ?? null;
  return normalizeCodexCliModel(model);
}

function modelForRunnerEnv(runnerProvider: string, model: string | undefined): string | undefined {
  return modelForRunnerProvider(runnerProvider, model) ?? undefined;
}

function resolveRunnerEnv(
  metadata: Record<string, unknown>,
  runnerProvider: string,
  runnerModel: string | null,
): Record<string, string> {
  const env: Record<string, string> = {};
  const runner = asRecord(metadata.hiverunnerSymphony) ?? asRecord(metadata.runnerConfig) ?? {};
  const trusted = asRecord(metadata.trustedLocalExecution) ?? {};
  const sandbox = optionalString(runner.sandbox) ?? optionalString(trusted.sandbox);
  const approvalPolicy = optionalString(runner.approvalPolicy) ?? optionalString(trusted.approvalPolicy);
  const codexCommand = optionalString(runner.codexCommand);
  const codexArgs = optionalString(runner.codexArgs);
  const model = runnerModel ?? undefined;
  const profile = optionalString(runner.profile);
  const timeoutMs = optionalString(runner.timeoutMs);
  const maxBuffer = optionalString(runner.maxBuffer);
  const claudeCommand = optionalString(runner.claudeCommand);
  const claudeArgs = optionalString(runner.claudeArgs);
  const claudePermissionMode = optionalString(runner.permissionMode) ?? optionalString(runner.claudePermissionMode);
  const geminiCommand = optionalString(runner.geminiCommand);
  const geminiArgs = optionalString(runner.geminiArgs);
  const geminiApprovalMode = optionalString(runner.approvalMode) ?? optionalString(runner.geminiApprovalMode);
  const hermesCommand = optionalString(runner.hermesCommand);
  const hermesArgs = optionalString(runner.hermesArgs);
  const openclawCommand = optionalString(runner.openclawCommand);
  const openclawAgentId = optionalString(runner.openclawAgentId);

  if (sandbox) env.HIVERUNNER_SYMPHONY_SANDBOX = sandbox;
  if (approvalPolicy) env.HIVERUNNER_SYMPHONY_APPROVAL_POLICY = approvalPolicy;
  if (codexCommand) env.HIVERUNNER_SYMPHONY_CODEX_COMMAND = codexCommand;
  if (codexArgs) env.HIVERUNNER_SYMPHONY_CODEX_ARGS = codexArgs;
  const envModel = modelForRunnerEnv(runnerProvider, model);
  if (envModel) env.HIVERUNNER_SYMPHONY_MODEL = envModel;
  if (profile) env.HIVERUNNER_SYMPHONY_PROFILE = profile;
  if (timeoutMs) env.HIVERUNNER_SYMPHONY_TIMEOUT_MS = timeoutMs;
  if (maxBuffer) env.HIVERUNNER_SYMPHONY_MAX_BUFFER = maxBuffer;
  if (runnerProvider === "anthropic") {
    if (claudeCommand) env.HIVERUNNER_CLAUDE_COMMAND = claudeCommand;
    if (claudeArgs) env.HIVERUNNER_CLAUDE_ARGS = claudeArgs;
    if (model) env.HIVERUNNER_CLAUDE_MODEL = model;
    if (claudePermissionMode) env.HIVERUNNER_CLAUDE_PERMISSION_MODE = claudePermissionMode;
    if (timeoutMs) env.HIVERUNNER_CLAUDE_TIMEOUT_MS = timeoutMs;
    if (maxBuffer) env.HIVERUNNER_CLAUDE_MAX_BUFFER = maxBuffer;
  }
  if (runnerProvider === "gemini") {
    if (geminiCommand) env.HIVERUNNER_GEMINI_COMMAND = geminiCommand;
    if (geminiArgs) env.HIVERUNNER_GEMINI_ARGS = geminiArgs;
    if (model) env.HIVERUNNER_GEMINI_MODEL = model;
    if (geminiApprovalMode) env.HIVERUNNER_GEMINI_APPROVAL_MODE = geminiApprovalMode;
    if (timeoutMs) env.HIVERUNNER_GEMINI_TIMEOUT_MS = timeoutMs;
    if (maxBuffer) env.HIVERUNNER_GEMINI_MAX_BUFFER = maxBuffer;
  }
  if (runnerProvider === "hermes") {
    if (hermesCommand) env.HIVERUNNER_HERMES_COMMAND = hermesCommand;
    if (hermesArgs) env.HIVERUNNER_HERMES_ARGS = hermesArgs;
    if (model) env.HIVERUNNER_HERMES_MODEL = model;
    if (timeoutMs) env.HIVERUNNER_HERMES_TIMEOUT_MS = timeoutMs;
  }
  if (runnerProvider === "openclaw") {
    if (openclawCommand) env.HIVERUNNER_OPENCLAW_COMMAND = openclawCommand;
    if (openclawAgentId) env.HIVERUNNER_OPENCLAW_AGENT_ID = openclawAgentId;
    if (timeoutMs) env.HIVERUNNER_OPENCLAW_TIMEOUT_MS = timeoutMs;
    if (maxBuffer) env.HIVERUNNER_OPENCLAW_MAX_BUFFER = maxBuffer;
  }

  return env;
}

function resolveRuntimeCapabilities(metadata: Record<string, unknown>): Record<string, unknown> {
  const trusted = asRecord(metadata.trustedLocalExecution) ?? {};
  const runner = asRecord(metadata.hiverunnerSymphony) ?? asRecord(metadata.runnerConfig) ?? {};
  return {
    trustedLocalExecution: Boolean(trusted.enabled),
    sandbox: optionalString(runner.sandbox) ?? optionalString(trusted.sandbox) ?? null,
    approvalPolicy: optionalString(runner.approvalPolicy) ?? optionalString(trusted.approvalPolicy) ?? null,
    capabilities: Array.isArray(trusted.capabilities) ? trusted.capabilities : [],
    notes: optionalString(trusted.notes) ?? null,
  };
}

function resolveRunnerProvider(metadata: Record<string, unknown>): string {
  const runner = asRecord(metadata.hiverunnerSymphony) ?? asRecord(metadata.runnerConfig) ?? {};
  return normalizeRunnerProvider(
    optionalString(runner.provider) ??
    optionalString(runner.defaultProvider) ??
    optionalString(metadata.runnerProvider) ??
    optionalString(metadata.defaultProvider) ??
    "codex",
  );
}

function resolveMatrixExecutionDefaults(db: Database.Database, input: ExecutionInput): MatrixExecutionDefaults {
  const row = db
    .prepare(
      `SELECT
         t.execution_runtime_provider,
         t.execution_runtime_label,
         t.execution_model_routing,
         t.execution_model_routing_label,
         p.settings_json AS project_settings_json,
         c.settings_json AS company_settings_json
       FROM companies c
       LEFT JOIN tasks t ON (t.id = ? OR t.task_key = ?) AND t.archived_at IS NULL
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(input.session.taskKey, input.session.taskKey, input.agent.company_id) as
      | {
          execution_runtime_provider: string | null;
          execution_runtime_label: string | null;
          execution_model_routing: string | null;
          execution_model_routing_label: string | null;
          project_settings_json: string | null;
          company_settings_json: string | null;
        }
      | undefined;
  const defaults = resolveTaskExecutionRouting({
    taskRuntimeProvider: row?.execution_runtime_provider,
    taskRuntimeLabel: row?.execution_runtime_label,
    taskModelRouting: row?.execution_model_routing,
    taskModelRoutingLabel: row?.execution_model_routing_label,
    projectSettingsJson: row?.project_settings_json,
    companySettingsJson: row?.company_settings_json,
  });
  return {
    runnerProvider: defaults.runtimeProvider,
    runtimeLabel: defaults.runtimeLabel,
    modelRouting: defaults.modelRouting,
    modelRoutingLabel: defaults.modelRoutingLabel,
    activeHiveId: defaults.activeHiveId,
    activeHiveName: defaults.activeHiveName,
    source: defaults.source,
  };
}

function resolveRunnerModel(
  metadata: Record<string, unknown>,
  selectedRunnerProvider?: string,
  includeLegacyModelFields = true,
): string | null {
  const runner = asRecord(metadata.hiverunnerSymphony) ?? asRecord(metadata.runnerConfig) ?? {};
  const metadataRunnerProvider = resolveRunnerProvider(metadata);
  const runnerProvider = normalizeRunnerProvider(selectedRunnerProvider ?? metadataRunnerProvider);
  if (selectedRunnerProvider && metadataRunnerProvider !== runnerProvider) {
    return null;
  }
  const candidates = [runner.model, runner.modelId];
  if (includeLegacyModelFields) {
    candidates.push(metadata.model, metadata.modelId);
  }
  for (const candidate of candidates) {
    const model = modelForRunnerProvider(runnerProvider, candidate);
    if (model) return model;
    if (runnerProvider === "codex" && optionalString(candidate)) return null;
  }
  return null;
}

function trimForStorage(value: string, maxChars = 4000): string {
  if (value.length <= maxChars) return value;
  return value.slice(-maxChars);
}

function processGroupId(pid: number | undefined): number | null {
  if (!pid || process.platform === "win32") return null;
  try {
    const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], {
      encoding: "utf8",
    });
    if (result.status !== 0) return null;
    const parsed = Number.parseInt(result.stdout.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function mergeExecutionRunnerMetadata(
  db: Database.Database,
  executionRunId: string,
  patch: Record<string, unknown>,
): void {
  try {
    const row = db
      .prepare("SELECT metadata_json FROM execution_runs WHERE id = ? LIMIT 1")
      .get(executionRunId) as { metadata_json: string | null } | undefined;
    const metadata = parseJson(row?.metadata_json);
    const currentRunner = asRecord(metadata.externalRunner) ?? {};
    db.prepare(
      `UPDATE execution_runs
       SET metadata_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify({
        ...metadata,
        heartbeatRunId: patch.heartbeatRunId ?? metadata.heartbeatRunId ?? null,
        externalRunner: {
          ...currentRunner,
          ...patch,
        },
      }),
      new Date().toISOString(),
      executionRunId,
    );
  } catch {
    // Diagnostics are non-fatal; execution state still flows through the run.
  }
}

function appendTail(current: string, chunk: Buffer, maxChars = 4000): string {
  const next = current + chunk.toString("utf8");
  return next.length <= maxChars ? next : next.slice(-maxChars);
}

function terminationReason(input: {
  spawnError: string | null;
  timedOut: boolean;
  killedForBuffer: boolean;
  exitCode: number | null;
  signal: string | null;
}): string | null {
  if (input.spawnError) return "spawn_error";
  if (input.timedOut) return "adapter_timeout";
  if (input.killedForBuffer) return "stdout_buffer_exceeded";
  if (input.signal) return "external_signal";
  if (input.exitCode !== 0) return "exit_code";
  return null;
}

function failureClassForTermination(reason: string | null): string | null {
  switch (reason) {
    case "adapter_timeout":
      return "adapter_timeout";
    case "stdout_buffer_exceeded":
      return "buffer_limit";
    case "external_signal":
      return "external_signal";
    case "spawn_error":
    case "exit_code":
      return "runtime_error";
    default:
      return null;
  }
}

function transcriptText(value: string, maxChars = 12000): { body: string; truncated: boolean } {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return { body: trimmed, truncated: false };
  return { body: trimmed.slice(-maxChars), truncated: true };
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function splitCommandLine(value: string): string[] {
  const parts: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;
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

function defaultRunnerCommandForProvider(runnerProvider: string): string | null {
  const provider = normalizeRunnerProvider(runnerProvider);
  const scriptName = provider === "anthropic"
    ? "hiverunner-claude-runner.mjs"
    : provider === "gemini"
      ? "hiverunner-gemini-runner.mjs"
      : provider === "hermes"
        ? "hiverunner-hermes-runner.mjs"
        : provider === "openclaw"
          ? "hiverunner-openclaw-runner.mjs"
          : provider === "codex"
            ? "hiverunner-symphony-runner.mjs"
            : null;
  if (!scriptName) return null;
  const command = path.join(process.cwd(), "scripts", scriptName);
  return fs.existsSync(command) ? command : null;
}

function isBundledCodexRunnerCommand(value: string | null | undefined): boolean {
  const text = stringFrom(value);
  if (!text) return false;
  const command = splitCommandLine(text)[0] ?? text;
  return path.basename(command) === "hiverunner-symphony-runner.mjs";
}

function resolveSymphonyRuntime(db: Database.Database, input: ExecutionInput): SymphonyRuntimeRow | null {
  const rows = db
    .prepare(
      `SELECT command, display_name, runtime_slug, scope, workspace_root, metadata_json
       FROM agent_runtimes
       WHERE company_id = ?
         AND provider = 'symphony'
         AND status <> 'disabled'
         AND (agent_id = ? OR agent_id IS NULL)
       ORDER BY
         CASE WHEN agent_id = ? THEN 0 ELSE 1 END,
         CASE scope WHEN 'agent' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
         updated_at DESC
       LIMIT 1`,
    )
    .all(input.agent.company_id, input.agent.id, input.agent.id) as SymphonyRuntimeRow[];

  return rows[0] ?? null;
}

function resolveWorkspaceRoot(
  db: Database.Database,
  input: ExecutionInput,
): WorkspaceResolution {
  const row = db
    .prepare(
      `SELECT
         c.id AS company_id,
         c.company_code AS company_code,
         c.name AS company_name,
         c.slug AS company_slug,
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

  const root = row?.company_workspace_source === "openclaw"
    ? resolveCanonicalCompanyWorkspaceRoot(row.company_id, row.company_workspace_slug)
    : resolveCompanyWorkspaceRoot({
        companyId: row?.company_id ?? input.agent.company_id,
        workspaceSlug: row?.company_workspace_slug,
        workspaceRoot: row?.company_workspace_root,
        workspaceSource: row?.company_workspace_source,
      });
  const companyWorkspaceRoot = ensureCompanyWorkspaceScaffold(root).root;
  const sourceWorkspaceRoot = readProjectSourceWorkspaceRoot(row?.project_settings_json);
  const resolvedSourceWorkspaceRoot = sourceWorkspaceRoot ? path.resolve(sourceWorkspaceRoot) : null;
  const cwd = resolvedSourceWorkspaceRoot ?? companyWorkspaceRoot;
  return {
    cwd,
    companyWorkspaceRoot,
    sourceWorkspaceRoot: resolvedSourceWorkspaceRoot,
    additionalWritableDirs: resolvedSourceWorkspaceRoot ? [companyWorkspaceRoot] : [],
  };
}

function resolveCommandConfig(
  db: Database.Database,
  input: ExecutionInput,
  runtime: SymphonyRuntimeRow | null,
): SymphonyExecConfig {
  const metadata = parseJson(runtime?.metadata_json);
  const matrixDefaults = resolveMatrixExecutionDefaults(db, input);
  const routeAttempt = input.executionRouteAttempt;
  const runnerProvider = normalizeRunnerProvider(
    routeAttempt?.target.runtimeProvider ?? matrixDefaults.runnerProvider ?? resolveRunnerProvider(metadata),
  );
  const envCommand = stringFrom(process.env.SYMPHONY_EXEC_COMMAND);
  const defaultRunner = defaultRunnerCommandForProvider(runnerProvider);
  const configuredCommand =
    stringFrom(metadata.commandPath) ||
    stringFrom(metadata.command) ||
    stringFrom(runtime?.command);
  const shouldUseProviderDefault =
    runnerProvider !== "codex" &&
    Boolean(defaultRunner) &&
    isBundledCodexRunnerCommand(configuredCommand);
  const rawCommand =
    (shouldUseProviderDefault ? defaultRunner : configuredCommand) ||
    envCommand ||
    defaultRunner ||
    "symphony";
  const commandParts = splitCommandLine(rawCommand);
  const command = commandParts[0] ?? "symphony";
  const commandArgs = commandParts.slice(1);
  const metadataArgs = shouldUseProviderDefault ? [] : stringArrayFrom(metadata.commandArgs ?? metadata.args);
  const envArgs = stringArrayFrom(process.env.SYMPHONY_EXEC_ARGS);
  const workspace = resolveWorkspaceRoot(db, input);
  const routeModel = routeAttempt?.target.model;
  const runnerModel = routeModel ?? resolveRunnerModel(metadata, runnerProvider, !Boolean(routeAttempt));

  return {
    command,
    args: [...commandArgs, ...metadataArgs, ...envArgs],
    env: resolveRunnerEnv(metadata, runnerProvider, runnerModel),
    runnerProvider,
    runnerModel,
    modelRouting: matrixDefaults.modelRouting ?? null,
    modelRoutingLabel: matrixDefaults.modelRoutingLabel ?? null,
    activeHiveId: input.executionRoute?.activeHiveId ?? matrixDefaults.activeHiveId ?? null,
    activeHiveName: input.executionRoute?.activeHiveName ?? matrixDefaults.activeHiveName ?? null,
    ...workspace,
    displayName: matrixDefaults.runtimeLabel ?? runtime?.display_name ?? "External runner",
    runtimeSlug: runtime?.runtime_slug ?? null,
    capabilities: resolveRuntimeCapabilities(metadata),
  };
}

function loadTaskPayload(db: Database.Database, taskKey: string): Record<string, unknown> | null {
  if (taskKey === "__heartbeat__") return null;
  const row = db
    .prepare(
      `SELECT
         t.id,
         t.task_key,
         t.title,
         t.description,
         t.priority,
         t.type,
         t.status,
         t.labels_json,
         t.depends_on_json,
         t.due_date,
         t.assignee_agent_id,
         t.blocked_reason,
         t.created_at,
         t.updated_at,
         p.id AS project_id,
         p.slug AS project_slug,
         p.name AS project_name,
         c.id AS company_id,
         c.slug AS company_slug,
         c.company_code AS company_code,
         c.name AS company_name
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       INNER JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       WHERE (t.id = ? OR t.task_key = ?)
         AND t.archived_at IS NULL
       LIMIT 1`,
    )
    .get(taskKey, taskKey) as TaskPayloadRow | undefined;
  if (!row) return null;
  const dependencyKeys = parseDependencyKeys(row.depends_on_json);
  return {
    id: row.id,
    key: row.task_key,
    title: row.title,
    description: row.description,
    priority: row.priority,
    type: row.type,
    status: row.status,
    labels: parseJsonArray(row.labels_json),
    dependsOn: dependencyKeys,
    dueDate: row.due_date,
    url: taskUrlFor(row),
    project: {
      id: row.project_id,
      slug: row.project_slug,
      name: row.project_name,
    },
    company: {
      id: row.company_id,
      slug: row.company_slug,
      code: row.company_code,
      name: row.company_name,
    },
    symphonyIssue: mapTaskRowToSymphonyIssue(row),
  };
}

function buildPayload(input: ExecutionInput, config: SymphonyExecConfig, db: Database.Database): Record<string, unknown> {
  const task = loadTaskPayload(db, input.session.taskKey);
  const runtimeSkills = listRuntimeAgentSkills(input.agent.company_id, input.agent.id).skills;
  return {
    schema: "hiverunner.symphony.execution.v1",
    runId: input.runId ?? null,
    createdAt: new Date().toISOString(),
    executionEngine: "symphony",
    runnerProvider: config.runnerProvider,
    runnerModel: config.runnerModel,
    modelLane: input.executionRoute?.laneId ?? input.taskModelRouting?.lane ?? "default",
    modelRouting: config.modelRouting,
    modelRoutingLabel: config.modelRoutingLabel,
    activeHiveId: config.activeHiveId,
    activeHiveName: config.activeHiveName,
    execution: {
      engine: "symphony",
      runnerProvider: config.runnerProvider,
      runnerModel: config.runnerModel,
      modelLane: input.executionRoute?.laneId ?? input.taskModelRouting?.lane ?? "default",
      modelRoutingMode: config.modelRouting,
      modelRoutingLabel: config.modelRoutingLabel,
      activeHiveId: config.activeHiveId,
      activeHiveName: config.activeHiveName,
      modelRouting: {
        label: input.taskModelRouting?.label ?? "Default",
        model: input.taskModelRouting?.model ?? null,
        reasoningEffort: input.taskModelRouting?.reasoningEffort ?? null,
        speedPreference: input.taskModelRouting?.speedPreference ?? null,
      },
    },
    task,
    issue: asRecord(task)?.symphonyIssue ?? null,
    agent: {
      id: input.agent.id,
      name: input.agent.name,
      role: input.agent.role,
      companyId: input.agent.company_id,
      openclawAgentId: input.agent.openclaw_agent_id ?? null,
      runtimeSkillContract: {
        schema: "hiverunner.runtime_skills.v1",
        trackingAction: "use_skill",
        trackingRule: "When an assigned active skill is materially applied during the run, emit one use_skill mc-action with the skill slug and a short evidence note.",
      },
      runtimeSkills: runtimeSkills.map((skill) => ({
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        assignmentId: skill.assignmentId,
      })),
    },
    session: {
      id: input.session.id,
      taskKey: input.session.taskKey,
      adapterType: "symphony",
    },
    workspace: {
      cwd: config.cwd,
      companyWorkspaceRoot: config.companyWorkspaceRoot,
      sourceWorkspaceRoot: config.sourceWorkspaceRoot,
      additionalWritableDirs: config.additionalWritableDirs,
      runtimeCapabilities: config.capabilities,
    },
    prompt: input.prompt,
  };
}

function runCommand(
  config: SymphonyExecConfig,
  payload: Record<string, unknown>,
  options?: SymphonyRunCommandOptions,
): Promise<SymphonyExecResult> {
  const timeoutMs = numberFromEnv("SYMPHONY_EXEC_TIMEOUT_MS", DEFAULT_SYMPHONY_TIMEOUT_MS);
  const maxBufferBytes = numberFromEnv("SYMPHONY_EXEC_MAX_BUFFER", DEFAULT_SYMPHONY_MAX_BUFFER);
  const startedAt = Date.now();
  const stdinPayload = `${JSON.stringify(payload, null, 2)}\n`;

  return new Promise((resolve) => {
    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      env: {
        ...process.env,
        ...config.env,
        HIVERUNNER_SYMPHONY_PAYLOAD: "stdin-json",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pid = child.pid;
    const pgid = processGroupId(pid);
    if (options?.executionRunId && options.db) {
      try {
        if (pid) {
          options.db.prepare("UPDATE execution_runs SET process_pid = ?, updated_at = ? WHERE id = ?")
            .run(pid, new Date().toISOString(), options.executionRunId);
        }
        mergeExecutionRunnerMetadata(options.db, options.executionRunId, {
          heartbeatRunId: options.heartbeatRunId ?? null,
          command: config.command,
          args: config.args,
          cwd: config.cwd,
          runnerProvider: config.runnerProvider,
          runnerModel: config.runnerModel,
          pid: pid ?? null,
          pgid,
          startedAt: new Date(startedAt).toISOString(),
          status: "running",
          timeoutMs,
          maxBufferBytes,
        });
      } catch {}
    }
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTail = "";
    let stderrTail = "";
    let killedForBuffer = false;
    let timedOut = false;
    let spawnError: string | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      stdoutTail = appendTail(stdoutTail, chunk);
      if (stdoutBytes <= maxBufferBytes) stdoutChunks.push(chunk);
      if (stdoutBytes > maxBufferBytes && !killedForBuffer) {
        killedForBuffer = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      stderrTail = appendTail(stderrTail, chunk);
      if (stderrBytes <= maxBufferBytes) stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const compactStderrTail = stderrTail.trim().replace(/\s+/g, " ").slice(-500);
      const reason = terminationReason({ spawnError, timedOut, killedForBuffer, exitCode, signal });
      const failureClass = failureClassForTermination(reason);
      const errorMessage = spawnError
        ?? (timedOut ? `External runner command timed out after ${timeoutMs}ms` : null)
        ?? (killedForBuffer ? `External runner command exceeded ${maxBufferBytes} bytes of stdout` : null)
        ?? (signal ? `External runner command terminated by signal ${signal}` : null)
        ?? (exitCode === 0
          ? null
          : `External runner command exited with code ${exitCode}${signal ? ` (${signal})` : ""}${compactStderrTail ? `: ${compactStderrTail}` : ""}`);
      if (options?.executionRunId && options.db) {
        try {
          options.db.prepare("UPDATE execution_runs SET process_pid = NULL, failure_class = COALESCE(?, failure_class), updated_at = ? WHERE id = ?")
            .run(failureClass, new Date().toISOString(), options.executionRunId);
          mergeExecutionRunnerMetadata(options.db, options.executionRunId, {
            heartbeatRunId: options.heartbeatRunId ?? null,
            status: "exited",
            finishedAt: new Date().toISOString(),
            exitCode,
            signal,
            timedOut,
            killedForBuffer,
            terminationReason: reason,
            failureClass,
            stdoutBytes,
            stderrBytes,
            stdoutTail: trimForStorage(stdoutTail),
            stderrTail: trimForStorage(stderrTail),
          });
        } catch {}
      }
      resolve({
        ok: !errorMessage,
        stdout,
        stderr,
        stdoutTail: trimForStorage(stdoutTail),
        stderrTail: trimForStorage(stderrTail),
        stdoutBytes,
        stderrBytes,
        exitCode,
        signal,
        timedOut,
        killedForBuffer,
        terminationReason: reason,
        failureClass,
        errorMessage,
        durationMs: Date.now() - startedAt,
      });
    });

    child.stdin.end(stdinPayload);
  });
}

function parseResultObject(stdout: string): Record<string, unknown> {
  const direct = parseJson(stdout);
  if (Object.keys(direct).length > 0) return direct;
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of [...lines].reverse()) {
    const parsed = parseJson(line);
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return {};
}

function resultTextFromOutput(result: SymphonyExecResult, parsed: Record<string, unknown>): string {
  const explicit = stringFrom(parsed.resultText) || stringFrom(parsed.assistantSummary) || stringFrom(parsed.summary);
  const output = explicit || result.stdout.trim() || result.stderr.trim();
  if (output.includes("```mc-action")) return output;
  const summary = output
    ? `External runner execution completed: ${output.replace(/\s+/g, " ").slice(0, 600)}`
    : "External runner execution completed.";
  return [
    "```mc-action",
    JSON.stringify({ action: "report", summary }),
    "```",
  ].join("\n");
}

async function execute(input: ExecutionInput): Promise<ExecutionResult> {
  const db = getDb();
  const runtime = resolveSymphonyRuntime(db, input);
  const config = resolveCommandConfig(db, input, runtime);
  input.emitEvent?.("provider_event", `Starting ${config.displayName} command: ${config.command}`);
  const payload = buildPayload(input, config, db);
  const trackedRoots = [config.cwd, config.companyWorkspaceRoot, config.sourceWorkspaceRoot, ...config.additionalWritableDirs];
  const workspaceBefore = captureWorkspaceGitSnapshots(trackedRoots);
  const readOnlyIntent = detectReadOnlyIntent(`${input.prompt}\n${JSON.stringify(asRecord(payload.task) ?? {})}`);
  const result = await runCommand(config, payload, input.executionRunId ? {
    db,
    executionRunId: input.executionRunId,
    heartbeatRunId: input.runId ?? null,
  } : undefined);
  const workspaceAfter = captureWorkspaceGitSnapshots(trackedRoots);
  const workspaceRunVisibility = buildWorkspaceRunVisibility({
    before: workspaceBefore,
    after: workspaceAfter,
    readOnlyIntent,
  });
  const parsed = parseResultObject(result.stdout);
  const parsedError = stringFrom(parsed.error);
  const error = result.errorMessage ?? (parsedError || null);
  const sessionId = stringFrom(parsed.sessionId) || stringFrom(parsed.runId);
  const parsedUsage = asRecord(parsed.usage) ?? parsed;
  const resultRunnerProvider = stringFrom(parsed.runnerProvider) || config.runnerProvider;
  const resultRunnerModel =
    stringFrom(parsed.runnerModel) ||
    stringFrom(parsedUsage.runnerModel) ||
    stringFrom(parsedUsage.model) ||
    config.runnerModel;
  const runtimeSkills = asRecord(payload.agent)?.runtimeSkills;
  const resultText = error ? "" : resultTextFromOutput(result, parsed);
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n");
  const transcript = transcriptText(output || resultText);

  input.emitEvent?.(
    error ? "provider_error" : "provider_event",
    error ? `External runner failed after ${formatDuration(result.durationMs)}: ${error}` : `External runner completed in ${formatDuration(result.durationMs)}`,
  );

  return {
    error: error ?? undefined,
    runnerProvider: resultRunnerProvider,
    runnerModel: resultRunnerModel,
    usage: {
      provider: "symphony",
      executionEngine: "symphony",
      runnerProvider: resultRunnerProvider,
      runnerModel: resultRunnerModel,
      modelRouting: config.modelRouting,
      modelRoutingLabel: config.modelRoutingLabel,
      activeHiveId: config.activeHiveId,
      activeHiveName: config.activeHiveName,
      integrationPath: "hiverunner-symphony-command",
      command: config.command,
      args: config.args,
      runnerEnv: config.env,
      runtimeSlug: config.runtimeSlug,
      runtimeCapabilities: config.capabilities,
      runtimeSkillCount: Array.isArray(runtimeSkills) ? runtimeSkills.length : 0,
      runtimeSkillContract: asRecord(payload.agent)?.runtimeSkillContract ?? null,
      runtimeSkills: Array.isArray(runtimeSkills) ? runtimeSkills : [],
      sessionId,
      inputTokens: numberFrom(parsedUsage.inputTokens),
      outputTokens: numberFrom(parsedUsage.outputTokens),
      cacheReadInputTokens: numberFrom(parsedUsage.cacheReadInputTokens),
      cacheCreationInputTokens: numberFrom(parsedUsage.cacheCreationInputTokens),
      totalTokens: numberFrom(parsedUsage.totalTokens),
      totalCostUsd: numberFrom(parsedUsage.totalCostUsd),
      totalCostCents: numberFrom(parsedUsage.totalCostCents),
      cwd: config.cwd,
      companyWorkspaceRoot: config.companyWorkspaceRoot,
      sourceWorkspaceRoot: config.sourceWorkspaceRoot,
      additionalWritableDirs: config.additionalWritableDirs,
      workspaceRunVisibility,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      killedForBuffer: result.killedForBuffer,
      terminationReason: result.terminationReason,
      failureClass: result.failureClass,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      stdoutTail: result.stdoutTail || trimForStorage(result.stdout),
      stderrTail: result.stderrTail || trimForStorage(result.stderr),
      resultText,
      assistantSummary: resultText,
      transcriptEvents: [
        {
          kind: "run_start",
          title: "External runner handoff started",
          body: `${config.command} ${config.args.join(" ")}`.trim(),
          metadata: {
            cwd: config.cwd,
            companyWorkspaceRoot: config.companyWorkspaceRoot,
            sourceWorkspaceRoot: config.sourceWorkspaceRoot,
            additionalWritableDirs: config.additionalWritableDirs,
            runnerEnv: config.env,
            runtimeCapabilities: config.capabilities,
            runtimeSkillCount: Array.isArray(runtimeSkills) ? runtimeSkills.length : 0,
          },
        },
        {
          kind: "provider_event",
          title: "Workspace visibility snapshot",
          body: `${workspaceRunVisibility.totals.changedDuringRunCount} file status change(s) during run; ${workspaceRunVisibility.totals.beforeDirtyCount} dirty before, ${workspaceRunVisibility.totals.afterDirtyCount} dirty after.`,
          metadata: {
            readOnlyIntent: workspaceRunVisibility.readOnlyIntent,
            warnings: workspaceRunVisibility.warnings,
            totals: workspaceRunVisibility.totals,
          },
        },
        {
          kind: error ? "provider_error" : "assistant_text_final",
          role: error ? null : "assistant",
          title: error ? "External runner command failed" : "External runner result",
          body: transcript.body || error || "No external runner output captured.",
          metadata: { truncated: transcript.truncated },
        },
        {
          kind: "run_end",
          title: error ? "External runner handoff failed" : "External runner handoff completed",
          body: error ?? `Completed in ${formatDuration(result.durationMs)}`,
          metadata: { exitCode: result.exitCode, signal: result.signal },
        },
      ],
    },
  };
}

function clearTaskSessionForSelfHeal(): void {
  // Stateless command handoff: there is no persistent Symphony session to clear.
}

export const symphonyExecutionAdapter: ExecutionAdapter = {
  adapterType: "symphony",
  execute,
  clearTaskSessionForSelfHeal,
};
