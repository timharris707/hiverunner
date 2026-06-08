import { createHash, randomUUID } from "crypto";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type Database from "better-sqlite3";

import { readProjectSourceWorkspaceRoot } from "@/lib/orchestration/service/shared";
import {
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { isPathContained } from "@/lib/workspaces/delete-safety";

type RuntimePreflightFailureCode =
  | "missing_node_binary"
  | "missing_runner_script"
  | "missing_helper_import"
  | "missing_cwd"
  | "missing_workspace"
  | "unsafe_workspace"
  | "invalid_provider_identity"
  | "unavailable_model_identity"
  | "cli_not_ready"
  | "missing_cli_auth"
  | "quarantined_provider_model_fingerprint";

type RuntimeCliReadinessStatus =
  | "ready"
  | "missing"
  | "needs_login"
  | "api_key_forbidden"
  | "error";

type RuntimeCliReadiness = {
  status: RuntimeCliReadinessStatus;
  detail?: string | null;
  authMode?: "subscription" | "api_key" | "unknown" | "missing" | null;
  version?: string | null;
};

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
  companyId?: string | null;
  taskId?: string | null;
  heartbeatRunId?: string | null;
  executionRunId?: string | null;
  nodePath?: string | null;
  command?: string | null;
  commandArgs?: readonly string[];
  runnerScriptPath?: string | null;
  helperImportPaths?: readonly string[];
  cwd?: string | null;
  companyWorkspaceRoot?: string | null;
  sourceWorkspaceRoot?: string | null;
  allowedWorkspaceRoots?: readonly string[];
  cliCommand?: string | null;
  cliCommandArgs?: readonly string[];
  cliReadiness?: RuntimeCliReadiness | null;
  acceptanceChecks?: boolean;
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
  existingCircuitId?: string | null;
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
const ACCEPTANCE_PREFLIGHT_DISABLE_VALUES = new Set(["0", "false", "off", "disabled", "legacy"]);
const BUNDLED_RUNNER_SCRIPT_BY_PROVIDER = {
  codex: "hiverunner-symphony-runner.mjs",
  anthropic: "hiverunner-claude-runner.mjs",
  gemini: "hiverunner-gemini-runner.mjs",
  hermes: "hiverunner-hermes-runner.mjs",
  openclaw: "hiverunner-openclaw-runner.mjs",
} as const;

const BUNDLED_RUNNER_SCRIPT_NAMES: ReadonlySet<string> = new Set(Object.values(BUNDLED_RUNNER_SCRIPT_BY_PROVIDER));
const SUPPORTED_RUNNER_PROVIDERS: ReadonlySet<string> = new Set(Object.keys(BUNDLED_RUNNER_SCRIPT_BY_PROVIDER));
const RUNNER_MODEL_PROVIDER_BY_PROVIDER: Record<BundledRunnerProvider, string> = {
  codex: "openai",
  anthropic: "anthropic",
  gemini: "google",
  hermes: "hermes",
  openclaw: "openclaw",
};
const SUBSCRIPTION_CLI_ENV_DENYLIST = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_API_KEY",
  "OPENAI_API_BASE",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "OPENROUTER_API_KEY",
] as const;

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

type BundledRunnerProvider = keyof typeof BUNDLED_RUNNER_SCRIPT_BY_PROVIDER;

function bundledRunnerProvider(value: string | null | undefined): BundledRunnerProvider | null {
  const provider = normalizeRunnerProvider(value);
  return Object.prototype.hasOwnProperty.call(BUNDLED_RUNNER_SCRIPT_BY_PROVIDER, provider)
    ? provider as BundledRunnerProvider
    : null;
}

function explicitRunnerProviderInvalid(value: string | null | undefined): boolean {
  const candidate = text(value);
  if (!candidate) return false;
  return !SUPPORTED_RUNNER_PROVIDERS.has(normalizeRunnerProvider(candidate));
}

function acceptancePreflightEnabled(input: RuntimePreflightAdmissionInput): boolean {
  if (input.acceptanceChecks === false) return false;
  const explicit = text(process.env.HIVERUNNER_RUNTIME_PREFLIGHT_ACCEPTANCE);
  if (ACCEPTANCE_PREFLIGHT_DISABLE_VALUES.has(explicit.toLowerCase())) return false;
  const mode = text(process.env.HIVERUNNER_RUNTIME_PREFLIGHT_MODE);
  return !ACCEPTANCE_PREFLIGHT_DISABLE_VALUES.has(mode.toLowerCase());
}

function bundledRunnerScriptNameForProvider(runnerProvider: string | null | undefined): string | null {
  const provider = bundledRunnerProvider(runnerProvider);
  return provider ? BUNDLED_RUNNER_SCRIPT_BY_PROVIDER[provider] : null;
}

function runnerConfig(metadata: Record<string, unknown>): Record<string, unknown> {
  return asRecord(metadata.hiverunnerSymphony) ?? asRecord(metadata.runnerConfig) ?? {};
}

function configuredCliCommandForRunnerProvider(
  runnerProvider: string | null | undefined,
  metadata: Record<string, unknown>,
): string | null {
  const provider = bundledRunnerProvider(runnerProvider);
  if (!provider) return null;
  const runner = runnerConfig(metadata);
  if (provider === "codex") {
    return text(runner.codexCommand) || text(process.env.HIVERUNNER_SYMPHONY_CODEX_COMMAND) || "codex";
  }
  if (provider === "anthropic") {
    return text(runner.claudeCommand) || text(process.env.HIVERUNNER_CLAUDE_COMMAND) || "claude";
  }
  if (provider === "gemini") {
    return text(runner.geminiCommand) || text(process.env.HIVERUNNER_GEMINI_COMMAND) || "gemini";
  }
  if (provider === "hermes") {
    return text(runner.hermesCommand) || text(process.env.HIVERUNNER_HERMES_COMMAND) || "hermes";
  }
  if (provider === "openclaw") {
    return text(runner.openclawCommand) || text(process.env.HIVERUNNER_OPENCLAW_COMMAND) || "openclaw";
  }
  return null;
}

function splitCommandPrefix(value: string | null | undefined): { command: string | null; args: string[] } {
  const commandParts = splitCommandLine(text(value));
  return {
    command: commandParts[0] ?? null,
    args: commandParts.slice(1),
  };
}

function benchmarkReplayBundledRunnerScriptPath(
  metadata: Record<string, unknown>,
  runnerProvider: string | null | undefined,
): string | null {
  const replay = asRecord(metadata.hiverunnerBenchmarkReplay);
  if (!replay) return null;

  const provider = bundledRunnerProvider(runnerProvider);
  const commands = asRecord(replay.bundledRunnerCommands);
  const explicitCommand = provider ? text(commands?.[provider]) : "";
  if (explicitCommand) return explicitCommand;

  const scriptRoot = text(replay.bundledRunnerScriptRoot);
  const scriptName = bundledRunnerScriptNameForProvider(runnerProvider);
  return scriptRoot && scriptName ? path.join(scriptRoot, "scripts", scriptName) : null;
}

function defaultRunnerScriptPathForProvider(
  runnerProvider: string | null | undefined,
  metadata: Record<string, unknown> = {},
): string | null {
  const replayCommand = benchmarkReplayBundledRunnerScriptPath(metadata, runnerProvider);
  if (replayCommand) return replayCommand;

  const scriptName = bundledRunnerScriptNameForProvider(runnerProvider);
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
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
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

function normalizedRunnerModelForProvider(
  runnerProvider: string | null | undefined,
  runnerModel: string | null | undefined,
): string | null {
  const provider = bundledRunnerProvider(runnerProvider);
  const model = text(runnerModel);
  if (!model) return null;
  if (provider === "codex") {
    const codexModel = model
      .replace(/^openai-codex\//i, "")
      .replace(/^openai\//i, "")
      .replace(/^codex\//i, "")
      .trim();
    const normalized = codexModel.toLowerCase();
    if (
      !normalized ||
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
    return codexModel;
  }
  if (provider === "anthropic") {
    const anthropicModel = model.replace(/^anthropic\//i, "").trim();
    const normalized = anthropicModel.toLowerCase();
    if (
      !normalized ||
      normalized === "auto" ||
      normalized === "default" ||
      normalized === "claude" ||
      normalized === "sonnet" ||
      normalized === "claude-sonnet"
    ) {
      return "claude-sonnet-4-6";
    }
    if (normalized === "opus" || normalized === "claude-opus") return "claude-opus-4-8";
    return anthropicModel;
  }
  if (provider === "gemini") {
    const geminiModel = model
      .replace(/^google\/gemini[-/\s]?/i, "gemini-")
      .replace(/^google\//i, "")
      .replace(/^gemini\//i, "")
      .replace(/^models\//i, "")
      .trim();
    const normalized = geminiModel.toLowerCase();
    if (
      !normalized ||
      normalized === "auto" ||
      normalized === "default" ||
      normalized === "google-default" ||
      normalized === "gemini-default" ||
      normalized === "gemini-pro" ||
      normalized === "pro"
    ) {
      return "gemini-3-pro-preview";
    }
    if (normalized === "flash") return "gemini-3-flash-preview";
    if (normalized === "flash-lite") return "gemini-2.5-flash-lite";
    return geminiModel;
  }
  return model;
}

function buildProviderModelFingerprint(input: RuntimePreflightAdmissionInput): string {
  return createHash("sha256")
    .update(JSON.stringify({
      laneKey: text(input.laneKey),
      provider: text(input.provider),
      runnerProvider: bundledRunnerProvider(input.runnerProvider) ?? normalizeRunnerProvider(input.runnerProvider),
      runnerModel: normalizedRunnerModelForProvider(input.runnerProvider, input.runnerModel),
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
    providerModelFingerprint: buildProviderModelFingerprint(input),
    laneKey: text(input.laneKey) || null,
    provider: text(input.provider) || null,
    runnerProvider: text(input.runnerProvider) || null,
    runnerModel: text(input.runnerModel) || null,
    companyId: text(input.companyId) || null,
    command: {
      basename: basename(input.command),
      pathSha256: pathHash(input.command),
      argCount: input.commandArgs?.length ?? 0,
    },
    cliCommand: {
      basename: basename(input.cliCommand),
      pathSha256: pathHash(input.cliCommand),
      prefixArgCount: input.cliCommandArgs?.length ?? 0,
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
    companyWorkspaceRoot: {
      basename: basename(input.companyWorkspaceRoot),
      pathSha256: pathHash(input.companyWorkspaceRoot),
      kind: statKind(input.companyWorkspaceRoot),
    },
    sourceWorkspaceRoot: {
      basename: basename(input.sourceWorkspaceRoot),
      pathSha256: pathHash(input.sourceWorkspaceRoot),
      kind: statKind(input.sourceWorkspaceRoot),
    },
    helperImports: helperImportPaths.map((helperPath) => ({
      basename: basename(helperPath),
      pathSha256: pathHash(helperPath),
      kind: statKind(helperPath),
    })),
    diagnostic: redactRuntimePreflightText(input.diagnosticText),
  };
}

function unsafeWorkspacePathReason(value: string | null | undefined): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  const root = path.parse(resolved).root;
  if (resolved === root) return "filesystem_root";

  const home = path.resolve(os.homedir());
  if (resolved === home) return "home_directory";
  for (const sensitive of [".ssh", ".codex", ".config"]) {
    const sensitiveRoot = path.join(home, sensitive);
    if (resolved === sensitiveRoot || isPathContained(sensitiveRoot, resolved)) {
      return `sensitive_home_directory:${sensitive}`;
    }
  }
  return null;
}

function uniqueResolvedPaths(values: readonly (string | null | undefined)[]): string[] {
  const paths = new Set<string>();
  for (const value of values) {
    const candidate = text(value);
    if (candidate) paths.add(path.resolve(candidate));
  }
  return [...paths];
}

function detectWorkspaceFailure(input: RuntimePreflightAdmissionInput): RuntimePreflightFailure | null {
  const cwd = text(input.cwd);
  if (!cwd || !existsDirectory(cwd)) {
    const code = "missing_workspace";
    return {
      code,
      message: "Runtime preflight failed: execution workspace was not available.",
      summary: buildBaseSummary(input, code),
    };
  }

  const cwdUnsafeReason = unsafeWorkspacePathReason(cwd);
  if (cwdUnsafeReason) {
    const code = "unsafe_workspace";
    return {
      code,
      message: "Runtime preflight failed: execution workspace resolved to an unsafe filesystem location.",
      summary: {
        ...buildBaseSummary(input, code),
        workspaceSafety: {
          reason: cwdUnsafeReason,
        },
      },
    };
  }

  const allowedRoots = uniqueResolvedPaths([
    input.companyWorkspaceRoot,
    input.sourceWorkspaceRoot,
    ...(input.allowedWorkspaceRoots ?? []),
  ]);
  for (const allowedRoot of allowedRoots) {
    const rootUnsafeReason = unsafeWorkspacePathReason(allowedRoot);
    if (rootUnsafeReason) {
      const code = "unsafe_workspace";
      return {
        code,
        message: "Runtime preflight failed: configured workspace root was unsafe.",
        summary: {
          ...buildBaseSummary(input, code),
          workspaceSafety: {
            reason: rootUnsafeReason,
            rootBasename: basename(allowedRoot),
            rootPathSha256: pathHash(allowedRoot),
          },
        },
      };
    }
  }

  if (allowedRoots.length > 0 && !allowedRoots.some((allowedRoot) => isPathContained(allowedRoot, cwd))) {
    const code = "unsafe_workspace";
    return {
      code,
      message: "Runtime preflight failed: execution workspace was outside the resolved company or project workspace roots.",
      summary: {
        ...buildBaseSummary(input, code),
        workspaceSafety: {
          reason: "outside_allowed_workspace_roots",
          allowedRootCount: allowedRoots.length,
        },
      },
    };
  }

  return null;
}

function modelProviderForRunner(input: RuntimePreflightAdmissionInput): string | null {
  const provider = bundledRunnerProvider(input.runnerProvider);
  return provider ? RUNNER_MODEL_PROVIDER_BY_PROVIDER[provider] : null;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName) as { name: string } | undefined;
    return row?.name === tableName;
  } catch {
    return false;
  }
}

function detectProviderModelFailure(
  input: RuntimePreflightAdmissionInput,
  db: Database.Database,
): RuntimePreflightFailure | null {
  if (explicitRunnerProviderInvalid(input.runnerProvider)) {
    const code = "invalid_provider_identity";
    return {
      code,
      message: "Runtime preflight failed: runner provider identity is not executable.",
      summary: {
        ...buildBaseSummary(input, code),
        providerIdentity: {
          normalizedRunnerProvider: normalizeRunnerProvider(input.runnerProvider),
          supportedRunnerProviders: [...SUPPORTED_RUNNER_PROVIDERS],
        },
      },
    };
  }

  const expectedModelProvider = modelProviderForRunner(input);
  const normalizedModel = normalizedRunnerModelForProvider(input.runnerProvider, input.runnerModel);
  if (!expectedModelProvider || !normalizedModel || !tableExists(db, "available_models")) {
    return null;
  }

  type ModelRow = { id: string; runtime_provider: string; is_active: number };
  const exact = db
    .prepare(
      `SELECT id, runtime_provider, is_active
       FROM available_models
       WHERE LOWER(id) = LOWER(?)
       LIMIT 1`,
    )
    .get(normalizedModel) as ModelRow | undefined;

  if (exact?.is_active === 1 && exact.runtime_provider === expectedModelProvider) return null;

  const providerCount = db
    .prepare("SELECT COUNT(*) AS count FROM available_models WHERE runtime_provider = ? AND is_active = 1")
    .get(expectedModelProvider) as { count: number } | undefined;
  if (!exact && Number(providerCount?.count ?? 0) === 0) {
    return null;
  }

  const code = exact && exact.runtime_provider !== expectedModelProvider
    ? "invalid_provider_identity"
    : "unavailable_model_identity";
  return {
    code,
    message: exact && exact.runtime_provider !== expectedModelProvider
      ? "Runtime preflight failed: requested model belongs to a different provider than the selected runner."
      : "Runtime preflight failed: requested model is not active in the runtime catalog.",
    summary: {
      ...buildBaseSummary(input, code),
      modelIdentity: {
        normalizedModel,
        expectedModelProvider,
        catalogProvider: exact?.runtime_provider ?? null,
        catalogActive: exact ? exact.is_active === 1 : null,
        activeProviderModelCount: Number(providerCount?.count ?? 0),
      },
    },
  };
}

function runtimeProbeEnv(baseEnv: NodeJS.ProcessEnv = process.env, command?: string | null): NodeJS.ProcessEnv {
  const pathEntries = ["/opt/homebrew/bin", "/usr/local/bin", baseEnv.PATH ?? ""];
  if (command && path.isAbsolute(command)) {
    pathEntries.unshift(path.dirname(command));
  }
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  env.PATH = pathEntries.filter(Boolean).join(":");
  for (const key of SUBSCRIPTION_CLI_ENV_DENYLIST) {
    delete env[key];
  }
  return env;
}

function firstLine(value: string | null | undefined): string {
  return text(value).split(/\r?\n/)[0]?.trim() ?? "";
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
  const input = text(value);
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function claudeAuthDetail(output: string): string {
  const parsed = parseJsonRecord(output);
  if (!parsed) return firstLine(output);
  const authMethod = text(parsed.authMethod) || "unknown";
  const apiProvider = text(parsed.apiProvider) || "unknown";
  const subscriptionType = text(parsed.subscriptionType) || "unknown";
  return `Claude Code auth method ${authMethod}; provider ${apiProvider}; subscription ${subscriptionType}`;
}

function classifyClaudeAuth(output: string): "subscription" | "api_key" | "missing" {
  const parsed = parseJsonRecord(output);
  if (parsed) {
    const loggedIn = parsed.loggedIn === true;
    const authMethod = text(parsed.authMethod).toLowerCase();
    const apiProvider = text(parsed.apiProvider).toLowerCase();
    if (loggedIn && authMethod === "claude.ai" && (apiProvider === "firstparty" || apiProvider === "first_party")) {
      return "subscription";
    }
    if (authMethod.includes("api") || authMethod.includes("key") || apiProvider === "anthropic") {
      return "api_key";
    }
    return "missing";
  }

  const lower = output.toLowerCase();
  if (lower.includes("api key") || lower.includes("api-key") || lower.includes("anthropic api")) return "api_key";
  if (lower.includes("claude.ai") || lower.includes("firstparty") || lower.includes("logged in")) return "subscription";
  return "missing";
}

function cliReadinessFromOverride(
  input: RuntimePreflightAdmissionInput,
): RuntimeCliReadiness | null {
  return input.cliReadiness ?? null;
}

function probeSubscriptionCliReadiness(
  provider: BundledRunnerProvider,
  commandLine: { command: string | null; args: string[] },
): RuntimeCliReadiness {
  const command = commandLine.command;
  if (!command) {
    return { status: "missing", detail: "No CLI command resolved", authMode: "missing" };
  }

  const env = runtimeProbeEnv(process.env, command);
  const version = spawnSync(command, [...commandLine.args, "--version"], {
    env,
    encoding: "utf8",
    timeout: 3000,
  });
  if (version.error || version.status !== 0) {
    return {
      status: version.error ? "missing" : "error",
      detail: firstLine(`${version.stdout ?? ""}\n${version.stderr ?? ""}`) || version.error?.message || `exit_${version.status}`,
      authMode: "missing",
    };
  }

  if (provider === "codex") {
    const login = spawnSync(command, [...commandLine.args, "login", "status"], {
      env,
      encoding: "utf8",
      timeout: 3000,
    });
    const output = `${login.stdout ?? ""}\n${login.stderr ?? ""}`.trim();
    const lower = output.toLowerCase();
    const apiKey = lower.includes("api key") || lower.includes("api-key") || lower.includes("openai api");
    const subscription = lower.includes("chatgpt") || lower.includes("logged in");
    if (login.status === 0 && !apiKey && subscription) {
      return {
        status: "ready",
        detail: firstLine(output) || "Codex CLI subscription auth ready",
        authMode: "subscription",
        version: firstLine(`${version.stdout ?? ""}\n${version.stderr ?? ""}`) || null,
      };
    }
    return {
      status: apiKey ? "api_key_forbidden" : "needs_login",
      detail: firstLine(output) || (login.error ? login.error.message : `exit_${login.status}`),
      authMode: apiKey ? "api_key" : "missing",
      version: firstLine(`${version.stdout ?? ""}\n${version.stderr ?? ""}`) || null,
    };
  }

  if (provider === "anthropic") {
    const auth = spawnSync(command, [...commandLine.args, "auth", "status"], {
      env,
      encoding: "utf8",
      timeout: 3000,
    });
    const output = `${auth.stdout ?? ""}\n${auth.stderr ?? ""}`.trim();
    const authClassification = auth.status === 0 ? classifyClaudeAuth(output) : "missing";
    if (auth.status === 0 && authClassification === "subscription") {
      return {
        status: "ready",
        detail: claudeAuthDetail(output) || "Claude Code subscription auth ready",
        authMode: "subscription",
        version: firstLine(`${version.stdout ?? ""}\n${version.stderr ?? ""}`) || null,
      };
    }
    return {
      status: authClassification === "api_key" ? "api_key_forbidden" : "needs_login",
      detail: claudeAuthDetail(output) || (auth.error ? auth.error.message : `exit_${auth.status}`),
      authMode: authClassification === "api_key" ? "api_key" : "missing",
      version: firstLine(`${version.stdout ?? ""}\n${version.stderr ?? ""}`) || null,
    };
  }

  return {
    status: "ready",
    detail: firstLine(`${version.stdout ?? ""}\n${version.stderr ?? ""}`) || "CLI version probe succeeded",
    authMode: null,
    version: firstLine(`${version.stdout ?? ""}\n${version.stderr ?? ""}`) || null,
  };
}

function detectCliReadinessFailure(input: RuntimePreflightAdmissionInput): RuntimePreflightFailure | null {
  const provider = bundledRunnerProvider(input.runnerProvider);
  if (provider !== "codex" && provider !== "anthropic") return null;

  const commandLine = {
    command: text(input.cliCommand) || (provider === "codex" ? "codex" : "claude"),
    args: [...(input.cliCommandArgs ?? [])],
  };
  const readiness = cliReadinessFromOverride(input) ?? probeSubscriptionCliReadiness(provider, commandLine);
  if (readiness.status === "ready") return null;

  const code = readiness.status === "missing" || readiness.status === "error"
    ? "cli_not_ready"
    : "missing_cli_auth";
  return {
    code,
    message: readiness.status === "api_key_forbidden"
      ? "Runtime preflight failed: subscription-local CLI auth is required; API-key auth is not allowed for this runner."
      : readiness.status === "missing" || readiness.status === "error"
        ? "Runtime preflight failed: local CLI was not ready for execution."
        : "Runtime preflight failed: local CLI login/auth status was not ready.",
    summary: {
      ...buildBaseSummary(input, code),
      cliReadiness: {
        provider,
        status: readiness.status,
        authMode: readiness.authMode ?? null,
        detail: redactRuntimePreflightText(readiness.detail, 240) || null,
        version: redactRuntimePreflightText(readiness.version, 120) || null,
        subscriptionLocalBoundary: true,
        apiEnvironmentIgnored: SUBSCRIPTION_CLI_ENV_DENYLIST.some((name) => Boolean(process.env[name]?.trim())),
      },
    },
  };
}

function openProviderModelCircuit(
  db: Database.Database,
  input: RuntimePreflightAdmissionInput,
): { id: string; failure_code: string; opened_at: string; summary_json: string } | null {
  try {
    const laneKey = text(input.laneKey) || null;
    const provider = text(input.provider) || null;
    const runnerProvider = text(input.runnerProvider) || null;
    const runnerModel = text(input.runnerModel) || null;
    const row = db
      .prepare(
        `SELECT id, failure_code, opened_at, summary_json
         FROM runtime_preflight_results
         WHERE classification = 'deterministic_preflight'
           AND cleared_at IS NULL
           AND COALESCE(lane_key, '') = COALESCE(?, '')
           AND COALESCE(provider, '') = COALESCE(?, '')
           AND COALESCE(runner_provider, '') = COALESCE(?, '')
           AND COALESCE(runner_model, '') = COALESCE(?, '')
           AND failure_code <> 'quarantined_provider_model_fingerprint'
         ORDER BY opened_at DESC
         LIMIT 1`,
      )
      .get(laneKey, provider, runnerProvider, runnerModel) as
        | { id: string; failure_code: string; opened_at: string; summary_json: string }
        | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function detectProviderModelQuarantine(
  input: RuntimePreflightAdmissionInput,
  db: Database.Database,
): RuntimePreflightFailure | null {
  const openCircuit = openProviderModelCircuit(db, input);
  if (!openCircuit) return null;
  const code = "quarantined_provider_model_fingerprint";
  return {
    code,
    existingCircuitId: openCircuit.id,
    message: "Runtime preflight circuit blocked admission for a quarantined provider/model fingerprint.",
    summary: {
      ...buildBaseSummary(input, code),
      quarantine: {
        originalCircuitId: openCircuit.id,
        originalFailureCode: openCircuit.failure_code,
        openedAt: openCircuit.opened_at,
      },
    },
  };
}

function detectPreflightFailure(
  input: RuntimePreflightAdmissionInput,
  db: Database.Database,
): RuntimePreflightFailure | null {
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
    const code = acceptancePreflightEnabled(input) ? "missing_workspace" : "missing_cwd";
    return {
      code,
      message: code === "missing_workspace"
        ? "Runtime preflight failed: execution workspace was not available."
        : "Runtime preflight failed: execution working directory was not found.",
      summary: buildBaseSummary({ ...input, nodePath }, code),
    };
  }

  if (!acceptancePreflightEnabled(input)) return null;

  return (
    detectWorkspaceFailure({ ...input, nodePath }) ??
    detectProviderModelFailure({ ...input, nodePath }, db) ??
    detectCliReadinessFailure({ ...input, nodePath }) ??
    detectProviderModelQuarantine({ ...input, nodePath }, db)
  );
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
  const failure = detectPreflightFailure(input, db);
  if (!failure) {
    return {
      status: "allowed",
      classification: null,
      failureCode: null,
      circuitId: null,
      message: null,
    };
  }

  if (failure.existingCircuitId) {
    return {
      status: "blocked",
      classification: "deterministic_preflight",
      failureCode: failure.code,
      circuitId: failure.existingCircuitId,
      message: failure.message,
      summary: failure.summary,
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

function resolveWorkspace(db: Database.Database, input: HeartbeatRuntimePreflightInput): {
  cwd: string | null;
  companyWorkspaceRoot: string | null;
  sourceWorkspaceRoot: string | null;
  allowedWorkspaceRoots: string[];
} {
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
  if (!row) {
    return {
      cwd: null,
      companyWorkspaceRoot: null,
      sourceWorkspaceRoot: null,
      allowedWorkspaceRoots: [],
    };
  }

  const companyWorkspaceRoot = row.company_workspace_source === "openclaw"
    ? resolveCanonicalCompanyWorkspaceRoot(row.company_id, row.company_workspace_slug)
    : resolveCompanyWorkspaceRoot({
        companyId: row.company_id,
        workspaceSlug: row.company_workspace_slug,
        workspaceRoot: row.company_workspace_root,
        workspaceSource: row.company_workspace_source,
      });
  const sourceWorkspaceRoot = readProjectSourceWorkspaceRoot(row.project_settings_json);
  const resolvedSourceWorkspaceRoot = sourceWorkspaceRoot ? path.resolve(sourceWorkspaceRoot) : null;
  return {
    cwd: resolvedSourceWorkspaceRoot ?? companyWorkspaceRoot,
    companyWorkspaceRoot,
    sourceWorkspaceRoot: resolvedSourceWorkspaceRoot,
    allowedWorkspaceRoots: uniqueResolvedPaths([companyWorkspaceRoot, resolvedSourceWorkspaceRoot]),
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
  cliCommand: string | null;
  cliCommandArgs: string[];
} {
  if (input.provider !== "symphony") {
    const cli = splitCommandPrefix(configuredCliCommandForRunnerProvider(input.runnerProvider, {}));
    return {
      command: null,
      commandArgs: [],
      runnerScriptPath: null,
      helperImportPaths: [],
      cliCommand: cli.command,
      cliCommandArgs: cli.args,
    };
  }

  const runtime = resolveSymphonyRuntime(db, input);
  const metadata = parseJson(runtime?.metadata_json);
  const runnerProvider = normalizeRunnerProvider(input.runnerProvider);
  const cli = splitCommandPrefix(configuredCliCommandForRunnerProvider(runnerProvider, metadata));
  const defaultRunner = defaultRunnerScriptPathForProvider(runnerProvider, metadata);
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
    cliCommand: cli.command,
    cliCommandArgs: cli.args,
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
    companyId: input.companyId,
    taskId: input.taskId,
    heartbeatRunId: input.heartbeatRunId,
    executionRunId: input.executionRunId,
    nodePath: launch.runnerScriptPath ? process.execPath : null,
    command: launch.command,
    commandArgs: launch.commandArgs,
    runnerScriptPath: launch.runnerScriptPath,
    helperImportPaths: launch.helperImportPaths,
    cwd: workspace.cwd,
    companyWorkspaceRoot: workspace.companyWorkspaceRoot,
    sourceWorkspaceRoot: workspace.sourceWorkspaceRoot,
    allowedWorkspaceRoots: workspace.allowedWorkspaceRoots,
    cliCommand: launch.cliCommand,
    cliCommandArgs: launch.cliCommandArgs,
  }, db);
}
