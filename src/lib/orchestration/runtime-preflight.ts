import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

import { readProjectSourceWorkspaceRoot } from "@/lib/orchestration/service/shared";
import {
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";

type RuntimePreflightFailureCode =
  | "missing_node_binary"
  | "missing_runner_script"
  | "missing_helper_import"
  | "missing_cwd";

type RuntimePreflightAdmissionResult =
  | {
      status: "allowed";
      classification: null;
      failureCode: null;
      circuitId: null;
      message: null;
    }
  | {
      status: "failed" | "blocked";
      classification: "deterministic_preflight";
      failureCode: RuntimePreflightFailureCode;
      circuitId: string;
      message: string;
      summary: Record<string, unknown>;
    };

type RuntimePreflightAdmissionInput = {
  laneKey?: string | null;
  provider?: string | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
  taskId?: string | null;
  heartbeatRunId?: string | null;
  executionRunId?: string | null;
  nodePath?: string | null;
  command?: string | null;
  commandArgs?: readonly string[];
  runnerScriptPath?: string | null;
  helperImportPaths?: readonly string[];
  cwd?: string | null;
  diagnosticText?: string | null;
};

type HeartbeatRuntimePreflightInput = {
  agentId: string;
  companyId: string;
  taskId: string;
  heartbeatRunId: string;
  executionRunId?: string | null;
  laneKey?: string | null;
  provider?: string | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
};

type RuntimePreflightFailure = {
  code: RuntimePreflightFailureCode;
  message: string;
  summary: Record<string, unknown>;
};

type SymphonyRuntimeRow = {
  command: string | null;
  metadata_json: string | null;
};

type WorkspaceRow = {
  company_id: string;
  company_workspace_slug: string | null;
  company_workspace_root: string | null;
  company_workspace_source: string | null;
  project_settings_json: string | null;
};

const SUMMARY_SCHEMA = "hiverunner.runtime_preflight_summary.v1";
const BUNDLED_RUNNER_SCRIPT_NAMES = new Set([
  "hiverunner-symphony-runner.mjs",
  "hiverunner-claude-runner.mjs",
  "hiverunner-gemini-runner.mjs",
  "hiverunner-hermes-runner.mjs",
  "hiverunner-openclaw-runner.mjs",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function normalizeRunnerProvider(value: string | null | undefined): string {
  const provider = value?.trim().toLowerCase() ?? "";
  if (provider === "anthropic" || provider === "claude" || provider === "claude-code") return "anthropic";
  if (provider === "google" || provider === "gemini" || provider === "gemini-cli") return "gemini";
  if (provider === "hermes" || provider === "hermes-agent" || provider === "hermes-acp") return "hermes";
  if (provider === "openclaw" || provider === "openclaw-gateway") return "openclaw";
  if (provider === "openai" || provider === "codex" || provider === "openai-codex") return "codex";
  return provider || "codex";
}

function defaultRunnerScriptPathForProvider(runnerProvider: string | null | undefined): string | null {
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
  return scriptName ? path.join(process.cwd(), "scripts", scriptName) : null;
}

function isBundledRunnerScript(value: string | null | undefined): boolean {
  const candidate = text(value);
  return Boolean(candidate && BUNDLED_RUNNER_SCRIPT_NAMES.has(path.basename(candidate)));
}

function commandLooksPathLike(command: string | null | undefined): boolean {
  const candidate = text(command);
  return Boolean(candidate && (path.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")));
}

function pathHash(value: string | null | undefined): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  return createHash("sha256").update(path.resolve(candidate)).digest("hex");
}

function basename(value: string | null | undefined): string | null {
  const candidate = text(value);
  return candidate ? path.basename(candidate) : null;
}

function statKind(value: string | null | undefined): "file" | "directory" | "missing" | "other" {
  const candidate = text(value);
  if (!candidate) return "missing";
  try {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "directory";
    return "other";
  } catch {
    return "missing";
  }
}

function existsFile(value: string | null | undefined): boolean {
  return statKind(value) === "file";
}

function existsDirectory(value: string | null | undefined): boolean {
  return statKind(value) === "directory";
}

function redactRuntimePreflightText(value: string | null | undefined, maxChars = 500): string {
  const input = text(value);
  if (!input) return "";
  return input
    .replace(/\b(PATH)=([^\s]+)/gi, "$1=[REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH)[A-Z0-9_]*)=([^\s]+)/gi, "$1=[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/(^|\s)(\/(?:[A-Za-z0-9._-]+\/?){2,})/g, "$1[PATH]")
    .replace(/\b[A-Za-z]:\\[^\s]+/g, "[PATH]")
    .replace(/\s+/g, " ")
    .slice(0, maxChars);
}

function buildRuntimeFingerprint(input: RuntimePreflightAdmissionInput): string {
  return createHash("sha256")
    .update(JSON.stringify({
      laneKey: text(input.laneKey),
      provider: text(input.provider),
      runnerProvider: text(input.runnerProvider),
      runnerModel: text(input.runnerModel),
      nodePathHash: pathHash(input.nodePath),
      commandHash: pathHash(input.command),
      commandBasename: basename(input.command),
      commandArgsHash: createHash("sha256").update(JSON.stringify(input.commandArgs ?? [])).digest("hex"),
      runnerScriptPathHash: pathHash(input.runnerScriptPath),
      cwdHash: pathHash(input.cwd),
      helperImportPathHashes: (input.helperImportPaths ?? []).map(pathHash),
    }))
    .digest("hex");
}

function buildBaseSummary(
  input: RuntimePreflightAdmissionInput,
  failureCode: RuntimePreflightFailureCode,
): Record<string, unknown> {
  const helperImportPaths = input.helperImportPaths ?? [];
  return {
    schema: SUMMARY_SCHEMA,
    classification: "deterministic_preflight",
    failureCode,
    redactionPolicy: "basenames_hashes_only",
    laneKey: text(input.laneKey) || null,
    provider: text(input.provider) || null,
    runnerProvider: text(input.runnerProvider) || null,
    runnerModel: text(input.runnerModel) || null,
    command: {
      basename: basename(input.command),
      pathSha256: pathHash(input.command),
      argCount: input.commandArgs?.length ?? 0,
    },
    node: {
      basename: basename(input.nodePath),
      pathSha256: pathHash(input.nodePath),
      kind: statKind(input.nodePath),
    },
    runnerScript: {
      basename: basename(input.runnerScriptPath),
      pathSha256: pathHash(input.runnerScriptPath),
      kind: statKind(input.runnerScriptPath),
    },
    cwd: {
      basename: basename(input.cwd),
      pathSha256: pathHash(input.cwd),
      kind: statKind(input.cwd),
    },
    helperImports: helperImportPaths.map((helperPath) => ({
      basename: basename(helperPath),
      pathSha256: pathHash(helperPath),
      kind: statKind(helperPath),
    })),
    diagnostic: redactRuntimePreflightText(input.diagnosticText),
  };
}

function detectPreflightFailure(input: RuntimePreflightAdmissionInput): RuntimePreflightFailure | null {
  const hasRunnerScript = Boolean(text(input.runnerScriptPath));
  const nodePath = text(input.nodePath) || process.execPath;
  if (hasRunnerScript && !existsFile(nodePath)) {
    const code = "missing_node_binary";
    return {
      code,
      message: "Runtime preflight failed: Node binary was not available for bundled runner launch.",
      summary: buildBaseSummary({ ...input, nodePath }, code),
    };
  }

  if (hasRunnerScript && !existsFile(input.runnerScriptPath)) {
    const code = "missing_runner_script";
    return {
      code,
      message: "Runtime preflight failed: bundled runner script was not found.",
      summary: buildBaseSummary({ ...input, nodePath }, code),
    };
  }

  const missingHelper = (input.helperImportPaths ?? []).find((helperPath) => !existsFile(helperPath));
  if (hasRunnerScript && missingHelper) {
    const code = "missing_helper_import";
    return {
      code,
      message: "Runtime preflight failed: bundled runner helper import was not found.",
      summary: {
        ...buildBaseSummary({ ...input, nodePath }, code),
        missingHelper: {
          basename: basename(missingHelper),
          pathSha256: pathHash(missingHelper),
        },
      },
    };
  }

  const command = text(input.command);
  if (!hasRunnerScript && commandLooksPathLike(command) && !existsFile(command)) {
    const code = "missing_runner_script";
    return {
      code,
      message: "Runtime preflight failed: configured runner command path was not found.",
      summary: buildBaseSummary({ ...input, nodePath }, code),
    };
  }

  if (!existsDirectory(input.cwd)) {
    const code = "missing_cwd";
    return {
      code,
      message: "Runtime preflight failed: execution working directory was not found.",
      summary: buildBaseSummary({ ...input, nodePath }, code),
    };
  }

  return null;
}

function openCircuitRow(
  db: Database.Database,
  input: RuntimePreflightAdmissionInput,
  failure: RuntimePreflightFailure,
  runtimeFingerprint: string,
): { id: string; existed: boolean } {
  const laneKey = text(input.laneKey) || null;
  const provider = text(input.provider) || null;
  const runnerProvider = text(input.runnerProvider) || null;
  const runnerModel = text(input.runnerModel) || null;
  const existing = db
    .prepare(
      `SELECT id
       FROM runtime_preflight_results
       WHERE classification = 'deterministic_preflight'
         AND cleared_at IS NULL
         AND COALESCE(lane_key, '') = COALESCE(?, '')
         AND COALESCE(provider, '') = COALESCE(?, '')
         AND COALESCE(runner_provider, '') = COALESCE(?, '')
         AND COALESCE(runner_model, '') = COALESCE(?, '')
         AND runtime_fingerprint = ?
         AND failure_code = ?
       LIMIT 1`,
    )
    .get(laneKey, provider, runnerProvider, runnerModel, runtimeFingerprint, failure.code) as { id: string } | undefined;
  if (existing) {
    return { id: existing.id, existed: true };
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO runtime_preflight_results (
         id, lane_key, provider, runner_provider, runner_model, runtime_fingerprint,
         classification, failure_code, summary_json, task_id, heartbeat_run_id,
         execution_run_id, opened_at, cleared_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, 'deterministic_preflight', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      id,
      laneKey,
      provider,
      runnerProvider,
      runnerModel,
      runtimeFingerprint,
      failure.code,
      JSON.stringify(failure.summary),
      text(input.taskId) || null,
      text(input.heartbeatRunId) || null,
      text(input.executionRunId) || null,
      now,
      now,
      now,
    );
    return { id, existed: false };
  } catch (error) {
    const raced = db
      .prepare(
        `SELECT id
         FROM runtime_preflight_results
         WHERE classification = 'deterministic_preflight'
           AND cleared_at IS NULL
           AND COALESCE(lane_key, '') = COALESCE(?, '')
           AND COALESCE(provider, '') = COALESCE(?, '')
           AND COALESCE(runner_provider, '') = COALESCE(?, '')
           AND COALESCE(runner_model, '') = COALESCE(?, '')
           AND runtime_fingerprint = ?
           AND failure_code = ?
         LIMIT 1`,
      )
      .get(laneKey, provider, runnerProvider, runnerModel, runtimeFingerprint, failure.code) as { id: string } | undefined;
    if (raced) {
      return { id: raced.id, existed: true };
    }
    throw error;
  }
}

export function admitRuntimePreflight(
  input: RuntimePreflightAdmissionInput,
  db: Database.Database,
): RuntimePreflightAdmissionResult {
  const failure = detectPreflightFailure(input);
  if (!failure) {
    return {
      status: "allowed",
      classification: null,
      failureCode: null,
      circuitId: null,
      message: null,
    };
  }

  const runtimeFingerprint = buildRuntimeFingerprint(input);
  const circuit = openCircuitRow(db, input, failure, runtimeFingerprint);
  return {
    status: circuit.existed ? "blocked" : "failed",
    classification: "deterministic_preflight",
    failureCode: failure.code,
    circuitId: circuit.id,
    message: circuit.existed
      ? `Runtime preflight circuit blocked duplicate admission (${failure.code}).`
      : failure.message,
    summary: failure.summary,
  };
}

function resolveSymphonyRuntime(db: Database.Database, input: HeartbeatRuntimePreflightInput): SymphonyRuntimeRow | null {
  const rows = db
    .prepare(
      `SELECT command, metadata_json
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
    .all(input.companyId, input.agentId, input.agentId) as SymphonyRuntimeRow[];
  return rows[0] ?? null;
}

function resolveWorkspace(db: Database.Database, input: HeartbeatRuntimePreflightInput): { cwd: string | null } {
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
    .get(input.taskId, input.taskId, input.companyId) as WorkspaceRow | undefined;
  if (!row) return { cwd: null };

  const companyWorkspaceRoot = row.company_workspace_source === "openclaw"
    ? resolveCanonicalCompanyWorkspaceRoot(row.company_id, row.company_workspace_slug)
    : resolveCompanyWorkspaceRoot({
        companyId: row.company_id,
        workspaceSlug: row.company_workspace_slug,
        workspaceRoot: row.company_workspace_root,
        workspaceSource: row.company_workspace_source,
      });
  const sourceWorkspaceRoot = readProjectSourceWorkspaceRoot(row.project_settings_json);
  return {
    cwd: sourceWorkspaceRoot ? path.resolve(sourceWorkspaceRoot) : companyWorkspaceRoot,
  };
}

function helperImportsForRunnerScript(runnerScriptPath: string | null): string[] {
  if (!runnerScriptPath || !isBundledRunnerScript(runnerScriptPath)) return [];
  return [path.join(path.dirname(runnerScriptPath), "lib", "external-runner-utils.mjs")];
}

function resolveHeartbeatRunnerLaunch(db: Database.Database, input: HeartbeatRuntimePreflightInput): {
  command: string | null;
  commandArgs: string[];
  runnerScriptPath: string | null;
  helperImportPaths: string[];
} {
  if (input.provider !== "symphony") {
    return { command: null, commandArgs: [], runnerScriptPath: null, helperImportPaths: [] };
  }

  const runtime = resolveSymphonyRuntime(db, input);
  const metadata = parseJson(runtime?.metadata_json);
  const runnerProvider = normalizeRunnerProvider(input.runnerProvider);
  const defaultRunner = defaultRunnerScriptPathForProvider(runnerProvider);
  const configuredCommand =
    text(metadata.commandPath) ||
    text(metadata.command) ||
    text(runtime?.command);
  const shouldUseProviderDefault =
    runnerProvider !== "codex" &&
    Boolean(defaultRunner) &&
    isBundledRunnerScript(splitCommandLine(configuredCommand)[0] ?? configuredCommand);
  const rawCommand =
    (shouldUseProviderDefault ? defaultRunner : configuredCommand) ||
    text(process.env.SYMPHONY_EXEC_COMMAND) ||
    defaultRunner ||
    "symphony";
  const commandParts = splitCommandLine(rawCommand);
  const command = commandParts[0] ?? rawCommand;
  const commandArgs = commandParts.slice(1);
  const runnerScriptPath = isBundledRunnerScript(command)
    ? (path.isAbsolute(command) ? command : path.resolve(process.cwd(), command))
    : null;
  return {
    command,
    commandArgs,
    runnerScriptPath,
    helperImportPaths: helperImportsForRunnerScript(runnerScriptPath),
  };
}

export function admitHeartbeatRuntimePreflight(
  db: Database.Database,
  input: HeartbeatRuntimePreflightInput,
): RuntimePreflightAdmissionResult {
  const launch = resolveHeartbeatRunnerLaunch(db, input);
  const workspace = resolveWorkspace(db, input);
  return admitRuntimePreflight({
    laneKey: input.laneKey,
    provider: input.provider,
    runnerProvider: input.runnerProvider,
    runnerModel: input.runnerModel,
    taskId: input.taskId,
    heartbeatRunId: input.heartbeatRunId,
    executionRunId: input.executionRunId,
    nodePath: launch.runnerScriptPath ? process.execPath : null,
    command: launch.command,
    commandArgs: launch.commandArgs,
    runnerScriptPath: launch.runnerScriptPath,
    helperImportPaths: launch.helperImportPaths,
    cwd: workspace.cwd,
  }, db);
}
