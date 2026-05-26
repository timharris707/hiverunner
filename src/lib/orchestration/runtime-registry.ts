import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { spawnSync } from "child_process";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { normalizeAgentRuntimeSlug } from "@/lib/orchestration/runtime-identifiers";
import { resolveCompanyId } from "@/lib/orchestration/service/shared";
import {
  ensureAgentSourceWorkspaceLink,
  ensureCompanySourceWorkspaceLink,
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyAgentWorkspacePath,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { recordCompanyAuditEvent } from "@/lib/orchestration/service/audit";

export type AgentRuntimeKind = "cli" | "daemon" | "api" | "manual" | "external";
export type AgentRuntimeScope = "company" | "agent" | "workspace" | "external";
export type AgentRuntimeStatus = "online" | "offline" | "unknown" | "error" | "disabled";
export type AgentRuntimeHealthStatus =
  | "ready"
  | "needs_login"
  | "missing_cli"
  | "failed_probe"
  | "disabled"
  | "unknown";

export type AgentRuntimeHealth = {
  status: AgentRuntimeHealthStatus;
  label: string;
  checkedAt: string | null;
  command?: string | null;
  commandPath?: string | null;
  version?: string | null;
  versionLatest?: boolean | null;
  latestVersion?: string | null;
  versionCheckSource?: string | null;
  versionCheckDetail?: string | null;
  workspaceRoot?: string | null;
  workspaceWritable?: boolean | null;
  authReady?: boolean | null;
  details: string[];
  error?: string | null;
};

export type AgentRuntimeRecord = {
  id: string;
  companyId: string;
  agentId?: string | null;
  provider: string;
  runtimeKind: AgentRuntimeKind;
  scope: AgentRuntimeScope;
  runtimeSlug: string;
  displayName: string;
  command?: string | null;
  version?: string | null;
  status: AgentRuntimeStatus;
  workspaceRoot?: string | null;
  metadata: Record<string, unknown>;
  health?: AgentRuntimeHealth | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DetectedLocalRuntime = {
  provider: string;
  displayName: string;
  command: string;
  commandPath: string;
  version?: string;
  status: AgentRuntimeStatus;
  metadata: Record<string, unknown>;
};

export type RuntimeDependencyOptionality =
  | "core_local_boot"
  | "optional_runtime"
  | "optional_provider_key"
  | "legacy_optional";

export type RuntimeDependencyStatus =
  | "ready"
  | "missing_optional"
  | "needs_login"
  | "not_configured"
  | "unknown";

export type RuntimeDependencyReadiness = {
  id: string;
  label: string;
  provider: string;
  kind: "cli" | "external-runner" | "provider-key" | "local-service";
  optionality: RuntimeDependencyOptionality;
  status: RuntimeDependencyStatus;
  command: string | null;
  commandPath: string | null;
  version: string | null;
  authReady: boolean | null;
  envVars: string[];
  note: string;
  setupHint: string;
};

export type RuntimeCliUpdateResult = {
  provider: string;
  packageName: string | null;
  command: string;
  args: string[];
  ok: boolean;
  status: number | null;
  currentVersion: string | null;
  latestVersion: string | null;
  beforeVersion: string | null;
  afterVersion: string | null;
  output: string;
  error: string | null;
};

type AgentRuntimeRow = {
  id: string;
  company_id: string;
  agent_id: string | null;
  provider: string;
  runtime_kind: AgentRuntimeKind;
  scope: AgentRuntimeScope;
  runtime_slug: string;
  display_name: string;
  command: string | null;
  version: string | null;
  status: AgentRuntimeStatus;
  workspace_root: string | null;
  metadata_json: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type RuntimeProbeCompanyRow = {
  id: string;
  slug: string;
  workspace_slug: string | null;
  workspace_root: string | null;
  workspace_source: string | null;
};

type RuntimeWorkspaceCompanyRow = RuntimeProbeCompanyRow;

type RuntimeWorkspaceAgentRow = {
  id: string;
  slug: string | null;
  runtime_slug: string | null;
  name: string;
};

type RuntimeWorkspaceResolution = {
  root: string | null;
  source:
    | "explicit"
    | "company"
    | "company-canonical"
    | "agent"
    | "external"
    | "openclaw";
};

const LOCAL_RUNTIME_PROBES = [
  { provider: "codex", displayName: "Codex", command: "codex", versionArgs: ["--version"] },
  { provider: "anthropic", displayName: "Claude Code", command: "claude", versionArgs: ["--version"] },
  { provider: "gemini", displayName: "Gemini", command: "gemini", versionArgs: ["--version"] },
  { provider: "hermes", displayName: "HERMES", command: "hermes", versionArgs: ["--version"] },
  { provider: "symphony", displayName: "External runner", command: "symphony", versionArgs: ["--version"] },
  { provider: "openclaw", displayName: "OpenClaw", command: "openclaw", versionArgs: ["--version"] },
  { provider: "multica", displayName: "Multica", command: "multica", versionArgs: ["--version"] },
] as const;

const RUNTIME_DEPENDENCY_CATALOG: Array<{
  id: string;
  provider: string;
  label: string;
  kind: RuntimeDependencyReadiness["kind"];
  optionality: RuntimeDependencyOptionality;
  command?: string;
  envVars?: string[];
  note: string;
  setupHint: string;
}> = [
  {
    id: "local-boot",
    provider: "hiverunner",
    label: "HiveRunner local boot",
    kind: "local-service",
    optionality: "core_local_boot",
    note: "Required for the app shell, local owner auth, SQLite data, and workspace setup.",
    setupHint: "Run npm install, copy .env.example to .env.local, then npm run dev.",
  },
  {
    id: "codex-cli",
    provider: "codex",
    label: "Codex CLI",
    kind: "cli",
    optionality: "optional_runtime",
    command: "codex",
    note: "Optional autonomous coding runtime. Missing Codex does not block boot or workspace setup.",
    setupHint: "Install and sign in to Codex only when you want Codex-backed agent runs.",
  },
  {
    id: "claude-code-cli",
    provider: "anthropic",
    label: "Claude Code CLI",
    kind: "cli",
    optionality: "optional_runtime",
    command: "claude",
    note: "Optional autonomous coding/review runtime. Direct Anthropic API keys are separate.",
    setupHint: "Install Claude Code and run its login flow only when you want Claude-backed agent runs.",
  },
  {
    id: "gemini-cli",
    provider: "gemini",
    label: "Gemini CLI",
    kind: "cli",
    optionality: "optional_runtime",
    command: "gemini",
    note: "Optional large-context and multimodal runtime. Gemini API keys are checked separately.",
    setupHint: "Install Gemini CLI only when you want Gemini-backed autonomous runtime work.",
  },
  {
    id: "openai-api-key",
    provider: "openai",
    label: "OpenAI API key",
    kind: "provider-key",
    optionality: "optional_provider_key",
    envVars: ["OPENAI_API_KEY"],
    note: "Optional direct OpenAI model-source key. It is not required for local boot or manual setup.",
    setupHint: "Set OPENAI_API_KEY only when you want direct OpenAI model-source routes or optional AI asset generation.",
  },
  {
    id: "anthropic-api-key",
    provider: "anthropic",
    label: "Anthropic API key",
    kind: "provider-key",
    optionality: "optional_provider_key",
    envVars: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    note: "Optional direct Anthropic model-source key. Claude Code CLI login is separate.",
    setupHint: "Set ANTHROPIC_API_KEY only when you want direct Anthropic model-source routes.",
  },
  {
    id: "gemini-api-key",
    provider: "gemini",
    label: "Gemini / Google API key",
    kind: "provider-key",
    optionality: "optional_provider_key",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    note: "Optional Gemini/Google key for direct model-source routes and voice-related features.",
    setupHint: "Set a Gemini or Google AI key only when you want Gemini-backed model-source, voice, or multimodal features.",
  },
  {
    id: "openrouter-api-key",
    provider: "openrouter",
    label: "OpenRouter API key",
    kind: "provider-key",
    optionality: "optional_provider_key",
    envVars: ["OPENROUTER_API_KEY"],
    note: "Optional broker model-source key.",
    setupHint: "Set OPENROUTER_API_KEY only when you want broker-backed model-source routing.",
  },
  {
    id: "ollama-host",
    provider: "ollama",
    label: "Ollama / LM Studio host",
    kind: "provider-key",
    optionality: "optional_provider_key",
    envVars: ["OLLAMA_HOST"],
    note: "Optional local model-source endpoint. The default local-first app does not require it.",
    setupHint: "Set OLLAMA_HOST when routing local/private lanes to a non-default local model server.",
  },
  {
    id: "vllm-endpoint",
    provider: "vllm",
    label: "vLLM endpoint",
    kind: "provider-key",
    optionality: "optional_provider_key",
    envVars: ["VLLM_BASE_URL", "VLLM_API_KEY"],
    note: "Optional self-hosted OpenAI-compatible model-source endpoint.",
    setupHint: "Set VLLM_BASE_URL and VLLM_API_KEY only when you operate a self-hosted vLLM endpoint.",
  },
  {
    id: "hermes-cli",
    provider: "hermes",
    label: "HERMES CLI",
    kind: "cli",
    optionality: "optional_runtime",
    command: "hermes",
    note: "Optional local runner for long-running tool tasks.",
    setupHint: "Install HERMES only if you use HERMES-backed local execution.",
  },
  {
    id: "openclaw-cli",
    provider: "openclaw",
    label: "OpenClaw CLI",
    kind: "cli",
    optionality: "optional_runtime",
    command: "openclaw",
    note: "Optional legacy/local runtime. It is gated and not required for the public local-first path.",
    setupHint: "Install OpenClaw only when working with preserved legacy/runtime workflows.",
  },
  {
    id: "symphony-runner",
    provider: "symphony",
    label: "External runner",
    kind: "external-runner",
    optionality: "optional_runtime",
    command: "symphony",
    envVars: ["SYMPHONY_EXEC_COMMAND", "HIVERUNNER_SYMPHONY_CODEX_COMMAND"],
    note: "Optional external runner adapter. It can be command-backed or configured through runner env vars.",
    setupHint: "Configure an external runner command only when you want Symphony-style execution.",
  },
];

const LATEST_VERSION_PROBES: Record<string, { source: "npm" | "github"; packageName?: string; repo?: string }> = {
  anthropic: { source: "npm", packageName: "@anthropic-ai/claude-code" },
  codex: { source: "npm", packageName: "@openai/codex" },
  gemini: { source: "npm", packageName: "@google/gemini-cli" },
  multica: { source: "github", repo: "multica-ai/multica" },
  openclaw: { source: "npm", packageName: "openclaw" },
  symphony: { source: "github", repo: "openai/symphony" },
};

const HEALTH_LABELS: Record<AgentRuntimeHealthStatus, string> = {
  ready: "Ready",
  needs_login: "Needs Login",
  missing_cli: "Missing CLI",
  failed_probe: "Failed Probe",
  disabled: "Disabled",
  unknown: "Unknown",
};

const DEFAULT_PATH_ENTRIES = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
const VERSION_CHECK_CACHE_TTL_MS = 60 * 1000;
const versionCheckCache = new Map<string, { expiresAt: number; result: LatestVersionProbeResult }>();

type LatestVersionProbeResult = {
  latestVersion: string | null;
  source: string | null;
  detail: string | null;
  error: string | null;
};

type VersionFreshness = {
  versionLatest: boolean | null;
  latestVersion: string | null;
  versionCheckSource: string | null;
  versionCheckDetail: string | null;
};

function homePathEntries(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME?.trim();
  if (!home) return [];
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, "bin"),
  ];
}

function healthLabel(status: AgentRuntimeHealthStatus): string {
  return HEALTH_LABELS[status] ?? "Unknown";
}

function normalizeProvider(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new OrchestrationApiError(400, "invalid_runtime_provider", "Runtime provider is required");
  }
  return normalized;
}

function slugifyWorkspacePart(value: string): string {
  return (
    value
      .replace(/'/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "runtime"
  );
}

function normalizeRuntimeStatus(value?: string | null): AgentRuntimeStatus {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "online" ||
    normalized === "offline" ||
    normalized === "unknown" ||
    normalized === "error" ||
    normalized === "disabled"
  ) {
    return normalized;
  }
  return "unknown";
}

function normalizeRuntimeKind(value?: string | null): AgentRuntimeKind {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "cli" ||
    normalized === "daemon" ||
    normalized === "api" ||
    normalized === "manual" ||
    normalized === "external"
  ) {
    return normalized;
  }
  return "cli";
}

function normalizeScope(value?: string | null): AgentRuntimeScope {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "company" ||
    normalized === "agent" ||
    normalized === "workspace" ||
    normalized === "external"
  ) {
    return normalized;
  }
  return "agent";
}

function parseMetadata(value: string | null | undefined): Record<string, unknown> {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseRuntimeHealth(value: unknown): AgentRuntimeHealth | null {
  const record = asRecord(value);
  if (!record) return null;
  const statusRaw = asString(record.status) as AgentRuntimeHealthStatus;
  const status = Object.prototype.hasOwnProperty.call(HEALTH_LABELS, statusRaw)
    ? statusRaw
    : "unknown";
  const details = Array.isArray(record.details)
    ? record.details.map((detail) => String(detail)).filter(Boolean)
    : [];

  return {
    status,
    label: asString(record.label) || healthLabel(status),
    checkedAt: asString(record.checkedAt) || null,
    command: asString(record.command) || null,
    commandPath: asString(record.commandPath) || null,
    version: asString(record.version) || null,
    versionLatest:
      typeof record.versionLatest === "boolean" ? record.versionLatest : null,
    latestVersion: asString(record.latestVersion) || null,
    versionCheckSource: asString(record.versionCheckSource) || null,
    versionCheckDetail: asString(record.versionCheckDetail) || null,
    workspaceRoot: asString(record.workspaceRoot) || null,
    workspaceWritable:
      typeof record.workspaceWritable === "boolean" ? record.workspaceWritable : null,
    authReady: typeof record.authReady === "boolean" ? record.authReady : null,
    details,
    error: asString(record.error) || null,
  };
}

function mapRuntimeRow(row: AgentRuntimeRow): AgentRuntimeRecord {
  const metadata = parseMetadata(row.metadata_json);
  return {
    id: row.id,
    companyId: row.company_id,
    agentId: row.agent_id,
    provider: row.provider,
    runtimeKind: row.runtime_kind,
    scope: row.scope,
    runtimeSlug: row.runtime_slug,
    displayName: row.display_name,
    command: row.command,
    version: row.version,
    status: row.status,
    workspaceRoot: row.workspace_root,
    metadata,
    health: parseRuntimeHealth(metadata.health),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveCompanyOrThrow(companyIdOrSlug: string): string {
  const db = getOrchestrationDb();
  const companyId = resolveCompanyId(db, companyIdOrSlug);
  if (!companyId) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return companyId;
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const seen = new Set<string>();
  const entries = [
    ...(env.PATH ?? "").split(path.delimiter),
    ...homePathEntries(env),
    ...DEFAULT_PATH_ENTRIES,
  ];
  return entries.filter((entry) => {
    const trimmed = entry.trim().replace(/^~(?=$|\/)/, env.HOME?.trim() ?? "~");
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
}

function resolveExecutablePath(command: string, env: NodeJS.ProcessEnv): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  const candidatePaths = trimmed.includes(path.sep)
    ? [path.resolve(trimmed)]
    : pathEntries(env).map((dir) => path.join(dir, trimmed));

  for (const candidate of candidatePaths) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try next PATH entry.
    }
  }
  return null;
}

function readVersion(commandPath: string, args: readonly string[], env: NodeJS.ProcessEnv): {
  version?: string;
  rawOutput?: string;
  error?: string;
} {
  const result = spawnSync(commandPath, [...args], {
    env,
    encoding: "utf8",
    timeout: 2500,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error) {
    return { rawOutput: output, error: result.error.message };
  }
  if (result.status !== 0) {
    return { version: output.split(/\r?\n/)[0]?.trim(), rawOutput: output, error: `exit_${result.status}` };
  }
  return { version: output.split(/\r?\n/)[0]?.trim() || undefined, rawOutput: output };
}

function versionArgsForProvider(provider: string): readonly string[] {
  return LOCAL_RUNTIME_PROBES.find((probe) => probe.provider === provider)?.versionArgs ?? ["--version"];
}

function catalogVersionArgs(command: string): readonly string[] {
  return LOCAL_RUNTIME_PROBES.find((probe) => probe.command === command)?.versionArgs ?? ["--version"];
}

function extractVersion(value?: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\bv?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)\b/i);
  return match?.[1] ?? null;
}

function compareVersionLike(current: string, latest: string): number | null {
  const normalizedCurrent = extractVersion(current);
  const normalizedLatest = extractVersion(latest);
  if (!normalizedCurrent || !normalizedLatest) return null;
  const currentParts = normalizedCurrent.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  const latestParts = normalizedLatest.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  const length = Math.max(currentParts.length, latestParts.length);
  for (let index = 0; index < length; index += 1) {
    const left = Number.isFinite(currentParts[index]) ? currentParts[index] : 0;
    const right = Number.isFinite(latestParts[index]) ? latestParts[index] : 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

function runVersionCheckCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeout = 3000,
): { output: string; error: string | null } {
  const commandPath = resolveExecutablePath(command, env);
  if (!commandPath) {
    return { output: "", error: `${command} not found` };
  }
  const result = spawnSync(commandPath, [...args], {
    env,
    encoding: "utf8",
    timeout,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error) return { output, error: result.error.message };
  if (result.status !== 0) return { output, error: `exit_${result.status}` };
  return { output, error: null };
}

function latestVersionFromNpm(packageName: string, env: NodeJS.ProcessEnv): LatestVersionProbeResult {
  const result = runVersionCheckCommand("npm", ["view", packageName, "version"], env, 3500);
  const latestVersion = result.error ? null : result.output.split(/\r?\n/)[0]?.trim() || null;
  return {
    latestVersion,
    source: `npm:${packageName}`,
    detail: latestVersion ? `Latest npm version ${latestVersion}` : result.error,
    error: result.error,
  };
}

function latestVersionFromGithub(repo: string, env: NodeJS.ProcessEnv): LatestVersionProbeResult {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const result = runVersionCheckCommand("curl", ["-fsSL", "--max-time", "3", url], env, 4000);
  if (result.error) {
    return {
      latestVersion: null,
      source: `github:${repo}`,
      detail: result.error,
      error: result.error,
    };
  }
  try {
    const release = JSON.parse(result.output) as { tag_name?: unknown; name?: unknown };
    const latestVersion = asString(release.tag_name) || asString(release.name) || null;
    return {
      latestVersion,
      source: `github:${repo}`,
      detail: latestVersion ? `Latest release ${latestVersion}` : "Latest release did not include a version",
      error: latestVersion ? null : "missing_release_version",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      latestVersion: null,
      source: `github:${repo}`,
      detail: message,
      error: message,
    };
  }
}

function readLatestVersion(provider: string, env: NodeJS.ProcessEnv): LatestVersionProbeResult {
  const config = LATEST_VERSION_PROBES[provider];
  if (!config) {
    return {
      latestVersion: null,
      source: null,
      detail: null,
      error: "no_latest_probe",
    };
  }

  const cacheKey = `${config.source}:${config.packageName ?? config.repo ?? provider}`;
  const cached = versionCheckCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const result =
    config.source === "npm" && config.packageName
      ? latestVersionFromNpm(config.packageName, env)
      : config.source === "github" && config.repo
        ? latestVersionFromGithub(config.repo, env)
        : {
            latestVersion: null,
            source: null,
            detail: null,
            error: "invalid_latest_probe",
          };

  versionCheckCache.set(cacheKey, {
    expiresAt: Date.now() + VERSION_CHECK_CACHE_TTL_MS,
    result,
  });
  return result;
}

function packageNameForProvider(provider: string): string | null {
  const config = LATEST_VERSION_PROBES[provider];
  return config?.source === "npm" && config.packageName ? config.packageName : null;
}

function boundedOutput(value: string, maxChars = 12_000): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[truncated]` : value;
}

export function updateLocalRuntimeCli(
  providerValue: string,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeCliUpdateResult {
  const provider = normalizeProvider(providerValue);
  const packageName = packageNameForProvider(provider);
  const latest = readLatestVersion(provider, env);
  const command = "npm";
  const args = packageName ? ["install", "-g", `${packageName}@latest`] : [];

  if (!packageName) {
    return {
      provider,
      packageName: null,
      command,
      args,
      ok: false,
      status: null,
      currentVersion: null,
      latestVersion: latest.latestVersion,
      beforeVersion: null,
      afterVersion: null,
      output: "",
      error: "No npm package update strategy is configured for this runtime.",
    };
  }

  const probe = LOCAL_RUNTIME_PROBES.find((candidate) => candidate.provider === provider);
  const commandPath = probe ? resolveExecutablePath(probe.command, env) : null;
  const before = commandPath && probe ? readVersion(commandPath, probe.versionArgs, env).version ?? null : null;
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
    maxBuffer: 1024 * 1024,
  });
  const output = boundedOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
  const nextCommandPath = probe ? resolveExecutablePath(probe.command, env) : commandPath;
  const after = nextCommandPath && probe ? readVersion(nextCommandPath, probe.versionArgs, env).version ?? null : null;
  const error = result.error
    ? result.error.message
    : result.status === 0
      ? null
      : `npm exited with status ${result.status ?? "unknown"}`;

  versionCheckCache.clear();

  return {
    provider,
    packageName,
    command,
    args,
    ok: !error,
    status: result.status,
    currentVersion: after ?? before,
    latestVersion: latest.latestVersion,
    beforeVersion: before,
    afterVersion: after,
    output,
    error,
  };
}

function selfReportedVersionFreshness(
  provider: string,
  rawVersionOutput?: string | null,
): VersionFreshness | null {
  if (provider !== "hermes") return null;
  const updateLine = rawVersionOutput
    ?.split(/\r?\n/)
    .find((line) => /update available/i.test(line));
  if (updateLine) {
    return {
      versionLatest: false,
      latestVersion: null,
      versionCheckSource: "hermes --version",
      versionCheckDetail: updateLine.trim(),
    };
  }
  const latestLine = rawVersionOutput
    ?.split(/\r?\n/)
    .find((line) => /\b(up to date|latest)\b/i.test(line));
  if (latestLine) {
    return {
      versionLatest: true,
      latestVersion: null,
      versionCheckSource: "hermes --version",
      versionCheckDetail: latestLine.trim(),
    };
  }
  return null;
}

function checkVersionFreshness(
  provider: string,
  currentVersion: string | null | undefined,
  rawVersionOutput: string | null | undefined,
  env: NodeJS.ProcessEnv,
): VersionFreshness {
  const selfReported = selfReportedVersionFreshness(provider, rawVersionOutput);
  if (selfReported) return selfReported;

  const current = extractVersion(currentVersion);
  if (!current) {
    return {
      versionLatest: null,
      latestVersion: null,
      versionCheckSource: null,
      versionCheckDetail: "Current version unavailable",
    };
  }

  const latest = readLatestVersion(provider, env);
  if (!latest.latestVersion) {
    return {
      versionLatest: null,
      latestVersion: null,
      versionCheckSource: latest.source,
      versionCheckDetail: latest.detail ?? latest.error,
    };
  }

  const comparison = compareVersionLike(current, latest.latestVersion);
  return {
    versionLatest: comparison === 0 ? true : comparison === null ? null : comparison >= 0,
    latestVersion: latest.latestVersion,
    versionCheckSource: latest.source,
    versionCheckDetail: latest.detail,
  };
}

function runLightweightProbe(
  commandPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { ok: boolean; output: string; error?: string; status: number | null } {
  const result = spawnSync(commandPath, [...args], {
    env,
    encoding: "utf8",
    timeout: 3000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error) {
    return {
      ok: false,
      output,
      error: result.error.message,
      status: result.status,
    };
  }
  return {
    ok: result.status === 0,
    output,
    error: result.status === 0 ? undefined : `exit_${result.status}`,
    status: result.status,
  };
}

function resolveCommandForProbe(runtime: AgentRuntimeRecord): string {
  const metadataCommand = asString(runtime.metadata.commandPath);
  return metadataCommand || runtime.command?.trim() || "";
}

function authReadiness(
  provider: string,
  commandPath: string | null,
  env: NodeJS.ProcessEnv,
): { ready: boolean | null; detail: string | null } {
  if (provider === "codex" && commandPath) {
    const result = runLightweightProbe(commandPath, ["login", "status"], env);
    return {
      ready: result.ok,
      detail: result.output.split(/\r?\n/)[0]?.trim() || result.error || null,
    };
  }

  if (provider === "anthropic" && commandPath) {
    const result = runLightweightProbe(commandPath, ["auth", "status"], env);
    return {
      ready: result.ok,
      detail: result.output.split(/\r?\n/)[0]?.trim() || result.error || null,
    };
  }

  if (provider === "gemini") {
    const configured = Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
    return {
      ready: configured ? true : null,
      detail: configured ? "Gemini API key detected" : "Gemini auth not verified",
    };
  }

  if (provider === "openclaw") {
    return { ready: true, detail: "OpenClaw auth is managed by its local runtime" };
  }

  if (provider === "hermes") {
    return { ready: true, detail: "HERMES auth is managed by its local CLI runtime" };
  }

  if (provider === "symphony") {
    return { ready: true, detail: "External runner auth is managed by the configured runner" };
  }

  return { ready: null, detail: null };
}

function anyEnvConfigured(names: string[], env: NodeJS.ProcessEnv): boolean {
  return names.some((name) => Boolean(env[name]?.trim()));
}

export function listRuntimeDependencyReadiness(
  env: NodeJS.ProcessEnv = process.env,
  input: { fast?: boolean } = {},
): RuntimeDependencyReadiness[] {
  return RUNTIME_DEPENDENCY_CATALOG.map((dependency) => {
    if (dependency.optionality === "core_local_boot") {
      return {
        id: dependency.id,
        label: dependency.label,
        provider: dependency.provider,
        kind: dependency.kind,
        optionality: dependency.optionality,
        status: "ready",
        command: dependency.command ?? null,
        commandPath: null,
        version: null,
        authReady: true,
        envVars: dependency.envVars ?? [],
        note: dependency.note,
        setupHint: dependency.setupHint,
      };
    }

    const command = dependency.command ?? null;
    const commandPath = command ? resolveExecutablePath(command, env) : null;
    const envConfigured = anyEnvConfigured(dependency.envVars ?? [], env);
    let version: string | null = null;
    let authReady: boolean | null = null;
    let status: RuntimeDependencyStatus = commandPath || envConfigured ? "ready" : "missing_optional";

    if (commandPath && !input.fast) {
      const versionProbe = readVersion(commandPath, catalogVersionArgs(command ?? ""), env);
      version = versionProbe.version ?? null;
      const auth = authReadiness(dependency.provider, commandPath, env);
      authReady = auth.ready;
      if (auth.ready === false) status = "needs_login";
    } else if (envConfigured) {
      authReady = true;
    }

    if (dependency.kind === "external-runner" && !commandPath && !envConfigured) {
      status = "not_configured";
    }

    return {
      id: dependency.id,
      label: dependency.label,
      provider: dependency.provider,
      kind: dependency.kind,
      optionality: dependency.optionality,
      status,
      command,
      commandPath,
      version,
      authReady,
      envVars: dependency.envVars ?? [],
      note: dependency.note,
      setupHint: dependency.setupHint,
    };
  });
}

function resolveProbeWorkspaceRoot(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  runtimeWorkspaceRoot: string | null | undefined,
): string | null {
  if (runtimeWorkspaceRoot?.trim()) {
    return path.resolve(runtimeWorkspaceRoot.trim());
  }

  const company = db
    .prepare(
      `SELECT id, slug, workspace_slug, workspace_root, workspace_source
       FROM companies
       WHERE id = ?
       LIMIT 1`,
    )
    .get(companyId) as RuntimeProbeCompanyRow | undefined;
  if (!company) return null;

  const root = resolveCompanyWorkspaceRoot({
    companyId: company.id,
    workspaceSlug: company.workspace_slug,
    workspaceRoot: company.workspace_root,
    workspaceSource: company.workspace_source,
  });
  return ensureCompanyWorkspaceScaffold(root).root;
}

function probeWorkspaceWritable(workspaceRoot: string | null): {
  writable: boolean | null;
  detail: string | null;
  error?: string;
} {
  if (!workspaceRoot) {
    return { writable: null, detail: "No workspace root resolved" };
  }

  const probePath = path.join(workspaceRoot, ".hiverunner-runtime-probe");
  try {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(probePath, new Date().toISOString(), "utf8");
    fs.rmSync(probePath, { force: true });
    return { writable: true, detail: "Workspace writable" };
  } catch (error) {
    return {
      writable: false,
      detail: "Workspace is not writable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function statusFromHealth(health: AgentRuntimeHealth): AgentRuntimeStatus {
  if (health.status === "ready") return "online";
  if (health.status === "disabled") return "disabled";
  if (health.status === "missing_cli") return "offline";
  if (health.status === "needs_login" || health.status === "failed_probe") return "error";
  return "unknown";
}

export function probeRuntimeHealth(
  runtime: AgentRuntimeRecord,
  input: {
    companyWorkspaceRoot?: string | null;
    env?: NodeJS.ProcessEnv;
    checkedAt?: string;
  } = {},
): AgentRuntimeHealth {
  const env = input.env ?? process.env;
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const details: string[] = [];

  if (runtime.status === "disabled") {
    return {
      status: "disabled",
      label: healthLabel("disabled"),
      checkedAt,
      command: runtime.command ?? null,
      versionLatest: null,
      latestVersion: null,
      versionCheckSource: null,
      versionCheckDetail: "Runtime is disabled",
      workspaceRoot: runtime.workspaceRoot ?? input.companyWorkspaceRoot ?? null,
      workspaceWritable: null,
      authReady: null,
      details: ["Runtime is disabled"],
      error: null,
    };
  }

  const command = resolveCommandForProbe(runtime);
  const requiresCli = runtime.runtimeKind === "cli" || Boolean(command);
  let commandPath: string | null = null;
  let version = runtime.version ?? null;
  let versionError: string | null = null;
  let rawVersionOutput: string | null = null;

  if (requiresCli) {
    commandPath = command ? resolveExecutablePath(command, env) : null;
    if (!commandPath) {
      return {
        status: "missing_cli",
        label: healthLabel("missing_cli"),
        checkedAt,
        command: command || null,
        commandPath: null,
        version,
        versionLatest: null,
        latestVersion: null,
        versionCheckSource: null,
        versionCheckDetail: "CLI version was not checked because the command was not found",
        workspaceRoot: runtime.workspaceRoot ?? input.companyWorkspaceRoot ?? null,
        workspaceWritable: null,
        authReady: null,
        details: [`Command ${command || "(not set)"} was not found on PATH`],
        error: "missing_cli",
      };
    }

    const versionProbe = readVersion(commandPath, versionArgsForProvider(runtime.provider), env);
    version = versionProbe.version ?? version;
    versionError = versionProbe.error ?? null;
    rawVersionOutput = versionProbe.rawOutput ?? null;
    if (version) {
      details.push(`Version: ${version}`);
    }
    if (versionError) {
      details.push(`Version probe: ${versionError}`);
    }
  } else {
    details.push("No local CLI required for this runtime kind");
  }

  const versionFreshness = checkVersionFreshness(
    runtime.provider,
    version,
    rawVersionOutput,
    env,
  );
  if (versionFreshness.versionCheckDetail) {
    details.push(`Version check: ${versionFreshness.versionCheckDetail}`);
  }

  const workspaceRoot = runtime.workspaceRoot ?? input.companyWorkspaceRoot ?? null;
  const workspaceProbe = probeWorkspaceWritable(workspaceRoot);
  if (workspaceProbe.detail) details.push(workspaceProbe.detail);

  const auth = commandPath ? authReadiness(runtime.provider, commandPath, env) : { ready: null, detail: null };
  if (auth.detail) details.push(auth.detail);

  let status: AgentRuntimeHealthStatus = "ready";
  let error: string | null = null;
  if (workspaceProbe.writable === false) {
    status = "failed_probe";
    error = workspaceProbe.error ?? "workspace_not_writable";
  } else if (versionError && !version) {
    status = "failed_probe";
    error = versionError;
  } else if (auth.ready === false) {
    status = "needs_login";
    error = auth.detail ?? "auth_not_ready";
  }

  return {
    status,
    label: healthLabel(status),
    checkedAt,
    command: command || null,
    commandPath,
    version,
    versionLatest: versionFreshness.versionLatest,
    latestVersion: versionFreshness.latestVersion,
    versionCheckSource: versionFreshness.versionCheckSource,
    versionCheckDetail: versionFreshness.versionCheckDetail,
    workspaceRoot,
    workspaceWritable: workspaceProbe.writable,
    authReady: auth.ready,
    details,
    error,
  };
}

export function probeCompanyRuntimes(
  companyIdOrSlug: string,
  env: NodeJS.ProcessEnv = process.env,
): { runtimes: AgentRuntimeRecord[] } {
  const db = getOrchestrationDb();
  const companyId = resolveCompanyOrThrow(companyIdOrSlug);
  const current = listCompanyRuntimes(companyId).runtimes;
  const now = new Date().toISOString();
  const probed: AgentRuntimeRecord[] = [];

  for (const runtime of current) {
    const companyWorkspaceRoot = resolveProbeWorkspaceRoot(db, companyId, runtime.workspaceRoot);
    const health = probeRuntimeHealth(runtime, {
      companyWorkspaceRoot,
      env,
      checkedAt: now,
    });
    const metadata = {
      ...runtime.metadata,
      health,
    };
    const status = statusFromHealth(health);
    db.prepare(
      `UPDATE agent_runtimes
       SET status = ?,
           version = COALESCE(?, version),
           workspace_root = COALESCE(?, workspace_root),
           metadata_json = ?,
           last_seen_at = CASE WHEN ? = 'online' THEN ? ELSE last_seen_at END,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      status,
      health.version ?? null,
      health.workspaceRoot ?? null,
      JSON.stringify(metadata),
      status,
      now,
      now,
      runtime.id,
    );
    probed.push(getRuntimeById(runtime.id));
  }

  return { runtimes: probed };
}

function loadRuntimeWorkspaceCompany(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
): RuntimeWorkspaceCompanyRow {
  const company = db
    .prepare(
      `SELECT id, slug, workspace_slug, workspace_root, workspace_source
       FROM companies
       WHERE id = ?
       LIMIT 1`,
    )
    .get(companyId) as RuntimeWorkspaceCompanyRow | undefined;
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return company;
}

function resolveDefaultCompanyRuntimeWorkspaceRoot(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  provider: string,
): RuntimeWorkspaceResolution {
  const company = loadRuntimeWorkspaceCompany(db, companyId);

  if (provider !== "openclaw" && company.workspace_source === "openclaw") {
    const root = resolveCanonicalCompanyWorkspaceRoot(
      company.id,
      company.workspace_slug || company.slug,
    );
    return {
      root: ensureCompanyWorkspaceScaffold(root).root,
      source: "company-canonical",
    };
  }

  const root = resolveCompanyWorkspaceRoot({
    companyId: company.id,
    workspaceSlug: company.workspace_slug || company.slug,
    workspaceRoot: company.workspace_root,
    workspaceSource: company.workspace_source,
  });

  return {
    root: ensureCompanyWorkspaceScaffold(root).root,
    source: provider === "openclaw" && company.workspace_source === "openclaw" ? "openclaw" : "company",
  };
}

function resolveAgentRuntimeWorkspaceRoot(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  agentId: string,
  companyWorkspaceRoot: string | null,
): string {
  if (!companyWorkspaceRoot) {
    throw new OrchestrationApiError(
      400,
      "runtime_workspace_unresolved",
      "Agent runtime workspace could not be resolved",
    );
  }

  const agent = db
    .prepare(
      `SELECT id, slug, runtime_slug, name
       FROM agents
       WHERE id = ? AND company_id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(agentId, companyId) as RuntimeWorkspaceAgentRow | undefined;

  if (!agent) {
    throw new OrchestrationApiError(
      400,
      "runtime_agent_not_found",
      "Runtime agentId must reference an active agent in the same company",
    );
  }

  const agentSlug = slugifyWorkspacePart(agent.runtime_slug || agent.slug || agent.name || agent.id);
  const root = resolveCompanyAgentWorkspacePath(companyWorkspaceRoot, agentSlug);
  if (!root) {
    throw new OrchestrationApiError(
      400,
      "runtime_workspace_unresolved",
      "Agent runtime workspace could not be resolved",
    );
  }

  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "memory"), { recursive: true });
  fs.mkdirSync(path.join(root, "scratch"), { recursive: true });
  ensureCompanySourceWorkspaceLink(companyWorkspaceRoot);
  ensureAgentSourceWorkspaceLink(root, companyWorkspaceRoot);
  return root;
}

function resolveRuntimeWorkspaceForUpsert(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  companyId: string;
  agentId: string | null;
  provider: string;
  scope: AgentRuntimeScope;
  explicitWorkspaceRoot: string | null;
}): RuntimeWorkspaceResolution {
  if (input.scope === "external") {
    return {
      root: input.explicitWorkspaceRoot ? path.resolve(input.explicitWorkspaceRoot) : null,
      source: input.explicitWorkspaceRoot ? "explicit" : "external",
    };
  }

  if (input.explicitWorkspaceRoot && input.provider === "openclaw") {
    return {
      root: ensureCompanyWorkspaceScaffold(path.resolve(input.explicitWorkspaceRoot)).root,
      source: "explicit",
    };
  }

  const companyWorkspace = resolveDefaultCompanyRuntimeWorkspaceRoot(
    input.db,
    input.companyId,
    input.provider,
  );

  if (input.agentId && input.scope === "agent" && input.provider !== "openclaw") {
    return {
      root: resolveAgentRuntimeWorkspaceRoot(
        input.db,
        input.companyId,
        input.agentId,
        companyWorkspace.root,
      ),
      source: "agent",
    };
  }

  if (input.explicitWorkspaceRoot) {
    return {
      root: ensureCompanyWorkspaceScaffold(path.resolve(input.explicitWorkspaceRoot)).root,
      source: "explicit",
    };
  }

  return companyWorkspace;
}

export function detectLocalRuntimeCandidates(
  env: NodeJS.ProcessEnv = process.env,
): DetectedLocalRuntime[] {
  const detected: DetectedLocalRuntime[] = [];

  for (const probe of LOCAL_RUNTIME_PROBES) {
    const commandPath = resolveExecutablePath(probe.command, env);
    if (!commandPath) continue;

    const version = readVersion(commandPath, probe.versionArgs, env);
    const versionFreshness = checkVersionFreshness(
      probe.provider,
      version.version,
      version.rawOutput,
      env,
    );
    detected.push({
      provider: probe.provider,
      displayName: probe.displayName,
      command: probe.command,
      commandPath,
      version: version.version,
      status: "online",
      metadata: {
        detectedBy: "hiverunner-local-path",
        versionError: version.error ?? null,
        latestVersion: versionFreshness.latestVersion,
        versionLatest: versionFreshness.versionLatest,
        versionCheckSource: versionFreshness.versionCheckSource,
        versionCheckDetail: versionFreshness.versionCheckDetail,
      },
    });
  }

  return detected;
}

export function detectLocalRuntimeCandidatesFast(
  env: NodeJS.ProcessEnv = process.env,
): DetectedLocalRuntime[] {
  const detected: DetectedLocalRuntime[] = [];

  for (const probe of LOCAL_RUNTIME_PROBES) {
    const commandPath = resolveExecutablePath(probe.command, env);
    if (!commandPath) continue;

    detected.push({
      provider: probe.provider,
      displayName: probe.displayName,
      command: probe.command,
      commandPath,
      status: "online",
      metadata: {
        detectedBy: "hiverunner-local-path-fast",
      },
    });
  }

  return detected;
}

export function listCompanyRuntimes(
  companyIdOrSlug: string,
): { runtimes: AgentRuntimeRecord[] } {
  const db = getOrchestrationDb();
  const companyId = resolveCompanyOrThrow(companyIdOrSlug);
  disableArchivedAgentRuntimes({ companyIdOrSlug: companyId, reason: "runtime_inventory_cleanup" });
  const rows = db
    .prepare(
      `SELECT
         ar.id, ar.company_id, ar.agent_id, ar.provider, ar.runtime_kind, ar.scope,
         ar.runtime_slug, ar.display_name, ar.command, ar.version, ar.status,
         ar.workspace_root, ar.metadata_json, ar.last_seen_at, ar.created_at, ar.updated_at
       FROM agent_runtimes ar
       LEFT JOIN agents a ON a.id = ar.agent_id
       WHERE ar.company_id = ?
         AND (
           ar.agent_id IS NULL
           OR (a.id IS NOT NULL AND a.archived_at IS NULL)
         )
       ORDER BY
         CASE ar.status WHEN 'online' THEN 0 WHEN 'unknown' THEN 1 WHEN 'offline' THEN 2 ELSE 3 END,
         ar.provider ASC,
         ar.display_name ASC`,
    )
    .all(companyId) as AgentRuntimeRow[];

  return { runtimes: rows.map(mapRuntimeRow) };
}

function disableRuntimeRows(
  rows: Array<{ id: string; metadata_json: string | null; disabled_at?: string | null }>,
  fallbackDisabledAt: string,
  reason: string,
): number {
  const db = getOrchestrationDb();
  const update = db.prepare(
    `UPDATE agent_runtimes
     SET status = 'disabled',
         metadata_json = ?,
         updated_at = ?
     WHERE id = ?`,
  );

  const tx = db.transaction(() => {
    for (const row of rows) {
      const disabledAt = row.disabled_at ?? fallbackDisabledAt;
      const metadata = parseMetadata(row.metadata_json);
      update.run(
        JSON.stringify({
          ...metadata,
          disabledBecause: reason,
          disabledAt,
        }),
        disabledAt,
        row.id,
      );
    }
  });

  tx();
  return rows.length;
}

export function disableArchivedAgentRuntimes(input: {
  companyIdOrSlug?: string;
  reason?: string;
} = {}): { disabledCount: number } {
  const db = getOrchestrationDb();
  const now = new Date().toISOString();
  const reason = input.reason?.trim() || "agent_archived";
  const where = [
    "ar.agent_id IS NOT NULL",
    "ar.status != 'disabled'",
    "(a.id IS NULL OR a.archived_at IS NOT NULL)",
  ];
  const params: unknown[] = [];
  if (input.companyIdOrSlug?.trim()) {
    where.push("ar.company_id = ?");
    params.push(resolveCompanyOrThrow(input.companyIdOrSlug));
  }
  const rows = db
    .prepare(
      `SELECT ar.id, ar.metadata_json, a.archived_at AS disabled_at
       FROM agent_runtimes ar
       LEFT JOIN agents a ON a.id = ar.agent_id
       WHERE ${where.join(" AND ")}`,
    )
    .all(...params) as Array<{ id: string; metadata_json: string | null; disabled_at: string | null }>;

  return { disabledCount: disableRuntimeRows(rows, now, reason) };
}

export function disableAgentRuntimesForArchivedAgent(input: {
  agentId: string;
  archivedAt?: string;
  reason?: string;
}): { disabledCount: number } {
  const db = getOrchestrationDb();
  const archivedAt = input.archivedAt ?? new Date().toISOString();
  const reason = input.reason?.trim() || "agent_archived";
  const rows = db
    .prepare(
      `SELECT id, metadata_json
       FROM agent_runtimes
       WHERE agent_id = ?`,
    )
    .all(input.agentId) as Array<{ id: string; metadata_json: string | null }>;

  return { disabledCount: disableRuntimeRows(rows, archivedAt, reason) };
}

export function upsertCompanyRuntime(input: {
  companyIdOrSlug: string;
  agentId?: string | null;
  provider: string;
  runtimeSlug?: string | null;
  displayName?: string | null;
  runtimeKind?: string | null;
  scope?: string | null;
  command?: string | null;
  version?: string | null;
  status?: string | null;
  workspaceRoot?: string | null;
  metadata?: Record<string, unknown>;
  lastSeenAt?: string | null;
}): { runtime: AgentRuntimeRecord; created: boolean } {
  const db = getOrchestrationDb();
  const companyId = resolveCompanyOrThrow(input.companyIdOrSlug);
  const provider = normalizeProvider(input.provider);
  const runtimeSlug = normalizeAgentRuntimeSlug(
    input.runtimeSlug?.trim() || input.displayName?.trim() || provider,
  );
  const runtimeKind = normalizeRuntimeKind(input.runtimeKind);
  const scope = normalizeScope(input.scope ?? (input.agentId ? "agent" : "company"));
  const status = normalizeRuntimeStatus(input.status);
  const displayName = input.displayName?.trim() || `${provider} runtime`;
  const now = new Date().toISOString();
  const agentId = input.agentId?.trim() || null;

  if (agentId) {
    const agent = db
      .prepare(
        `SELECT id FROM agents
         WHERE id = ? AND company_id = ? AND archived_at IS NULL
         LIMIT 1`,
      )
      .get(agentId, companyId) as { id: string } | undefined;
    if (!agent) {
      throw new OrchestrationApiError(
        400,
        "runtime_agent_not_found",
        "Runtime agentId must reference an active agent in the same company",
      );
    }
  }

  const workspace = resolveRuntimeWorkspaceForUpsert({
    db,
    companyId,
    agentId,
    provider,
    scope,
    explicitWorkspaceRoot: input.workspaceRoot?.trim() || null,
  });
  const metadata = {
    ...(input.metadata ?? {}),
    workspaceIsolation: {
      source: workspace.source,
      enforcedAt: now,
      agentScoped: Boolean(agentId && scope === "agent"),
    },
  };

  const existing = db
    .prepare(
      `SELECT id FROM agent_runtimes
       WHERE company_id = ? AND provider = ? AND runtime_slug = ?
       LIMIT 1`,
    )
    .get(companyId, provider, runtimeSlug) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE agent_runtimes
       SET agent_id = ?,
           runtime_kind = ?,
           scope = ?,
           display_name = ?,
           command = ?,
           version = ?,
           status = ?,
           workspace_root = ?,
           metadata_json = ?,
           last_seen_at = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      agentId,
      runtimeKind,
      scope,
      displayName,
      input.command?.trim() || null,
      input.version?.trim() || null,
      status,
      workspace.root,
      JSON.stringify(metadata),
      input.lastSeenAt ?? (status === "online" ? now : null),
      now,
      existing.id,
    );

    recordCompanyAuditEvent({
      companyId,
      agentId,
      runtimeId: existing.id,
      eventType: "runtime.updated",
      actorUserId: "operator",
      metadata: {
        provider,
        runtimeSlug,
        scope,
        workspaceRoot: workspace.root,
        workspaceSource: workspace.source,
        status,
      },
    });

    return { runtime: getRuntimeById(existing.id), created: false };
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_runtimes
      (id, company_id, agent_id, provider, runtime_kind, scope, runtime_slug,
       display_name, command, version, status, workspace_root, metadata_json,
       last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    companyId,
    agentId,
    provider,
    runtimeKind,
    scope,
    runtimeSlug,
    displayName,
    input.command?.trim() || null,
    input.version?.trim() || null,
    status,
    workspace.root,
    JSON.stringify(metadata),
    input.lastSeenAt ?? (status === "online" ? now : null),
    now,
    now,
  );

  recordCompanyAuditEvent({
    companyId,
    agentId,
    runtimeId: id,
    eventType: "runtime.attached",
    actorUserId: "operator",
    metadata: {
      provider,
      runtimeSlug,
      scope,
      workspaceRoot: workspace.root,
      workspaceSource: workspace.source,
      status,
    },
  });

  return { runtime: getRuntimeById(id), created: true };
}

function getRuntimeById(id: string): AgentRuntimeRecord {
  const row = getOrchestrationDb()
    .prepare(
      `SELECT
         id, company_id, agent_id, provider, runtime_kind, scope,
         runtime_slug, display_name, command, version, status,
         workspace_root, metadata_json, last_seen_at, created_at, updated_at
       FROM agent_runtimes
       WHERE id = ?
       LIMIT 1`,
    )
    .get(id) as AgentRuntimeRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "runtime_not_found", "Runtime not found");
  }
  return mapRuntimeRow(row);
}
