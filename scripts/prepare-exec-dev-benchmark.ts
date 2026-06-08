import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

import { assertOrchestrationMigrationCompatible } from "./lib/orchestration-migration-compatibility";

type CliOptions = {
  sourceDbPath: string;
  targetDbPath: string;
  manifestPath: string;
  goalKey: string;
  fixtureId: string;
  expectedTaskCount: number;
  requiredRepeats: number;
  taskKeys: string[];
  resetSelectedTasksTo: "none" | "to-do";
  sourceWorkspaceRoot: string | null;
  companyWorkspaceRoot: string | null;
  allowedRunnerProviders: RunnerProvider[];
  sanitizeRunnerRoutes: boolean;
  preferredRunnerProvider: RunnerProvider;
};

type RunnerProvider = keyof typeof BUNDLED_RUNNER_SCRIPT_BY_PROVIDER;

const BUNDLED_RUNNER_SCRIPT_BY_PROVIDER = {
  anthropic: "hiverunner-claude-runner.mjs",
  gemini: "hiverunner-gemini-runner.mjs",
  hermes: "hiverunner-hermes-runner.mjs",
  openclaw: "hiverunner-openclaw-runner.mjs",
  codex: "hiverunner-symphony-runner.mjs",
} as const;

const DEFAULT_ALLOWED_RUNNER_PROVIDERS: RunnerProvider[] = ["codex", "anthropic"];
const DEFAULT_PREFERRED_RUNNER_PROVIDER: RunnerProvider = "codex";
const RUNNER_PROVIDER_LABELS: Record<RunnerProvider, string> = {
  anthropic: "Claude Code",
  gemini: "Gemini CLI",
  hermes: "Hermes",
  openclaw: "OpenClaw",
  codex: "Codex",
};
const BUNDLED_RUNNER_SCRIPT_NAMES: ReadonlySet<string> = new Set(Object.values(BUNDLED_RUNNER_SCRIPT_BY_PROVIDER));

function usage(): never {
  console.error([
    "Usage: node ./scripts/run-tsx.mjs scripts/prepare-exec-dev-benchmark.ts [--source-db data/orchestration.db] [--target-db data-exec-dev/orchestration.db] [--goal INS-G006]",
    "       [--fixture-id ins-g006-runtime-replay-v1] [--expected-tasks 10] [--required-repeats 3]",
    "       [--task-key INS-205] [--task-keys INS-205,INS-208,...] [--reset-selected-tasks-to to-do|none]",
    "       [--source-workspace-root /path/to/source-worktree] [--company-workspace-root /path/to/company-workspace]",
    "       [--sanitize-runner-routes] [--allowed-runner-providers codex,anthropic] [--preferred-runner-provider codex]",
  ].join("\n"));
  process.exit(1);
}

function normalizeRunnerProvider(value: string | null | undefined): RunnerProvider | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("claude") || normalized.includes("anthropic")) return "anthropic";
  if (normalized.includes("gemini") || normalized.includes("google")) return "gemini";
  if (normalized.includes("hermes")) return "hermes";
  if (normalized.includes("openclaw")) return "openclaw";
  if (normalized.includes("codex") || normalized.includes("openai")) return "codex";
  return null;
}

function parseProviderList(value: string | null | undefined): RunnerProvider[] {
  const providers = Array.from(new Set(String(value ?? "")
    .split(",")
    .map((provider) => normalizeRunnerProvider(provider))
    .filter((provider): provider is RunnerProvider => Boolean(provider))))
    .sort();
  if (providers.length === 0) usage();
  return providers;
}

function parseArgs(argv: string[]): CliOptions {
  const appDir = process.cwd();
  const options: CliOptions = {
    sourceDbPath: path.join(appDir, "data", "orchestration.db"),
    targetDbPath: path.join(appDir, "data-exec-dev", "orchestration.db"),
    manifestPath: path.join(appDir, "data-exec-dev", "benchmark-manifest.json"),
    goalKey: "INS-G006",
    fixtureId: "ins-g006-runtime-replay-v1",
    expectedTaskCount: 10,
    requiredRepeats: 3,
    taskKeys: [],
    resetSelectedTasksTo: "none",
    sourceWorkspaceRoot: null,
    companyWorkspaceRoot: null,
    allowedRunnerProviders: DEFAULT_ALLOWED_RUNNER_PROVIDERS,
    sanitizeRunnerRoutes: false,
    preferredRunnerProvider: DEFAULT_PREFERRED_RUNNER_PROVIDER,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--source-db" && next) {
      options.sourceDbPath = path.resolve(next);
      index += 1;
    } else if (arg === "--target-db" && next) {
      options.targetDbPath = path.resolve(next);
      options.manifestPath = path.join(path.dirname(options.targetDbPath), "benchmark-manifest.json");
      index += 1;
    } else if (arg === "--manifest" && next) {
      options.manifestPath = path.resolve(next);
      index += 1;
    } else if (arg === "--goal" && next) {
      options.goalKey = next;
      index += 1;
    } else if (arg === "--fixture-id" && next) {
      options.fixtureId = next;
      index += 1;
    } else if (arg === "--expected-tasks" && next) {
      const expectedTaskCount = Number(next);
      if (!Number.isInteger(expectedTaskCount) || expectedTaskCount < 1) usage();
      options.expectedTaskCount = expectedTaskCount;
      index += 1;
    } else if (arg === "--required-repeats" && next) {
      const requiredRepeats = Number(next);
      if (!Number.isInteger(requiredRepeats) || requiredRepeats < 1) usage();
      options.requiredRepeats = requiredRepeats;
      index += 1;
    } else if (arg === "--task-key" && next) {
      options.taskKeys.push(next);
      index += 1;
    } else if (arg === "--task-keys" && next) {
      options.taskKeys.push(...next.split(","));
      index += 1;
    } else if (arg === "--reset-selected-tasks-to" && next) {
      if (next !== "none" && next !== "to-do") usage();
      options.resetSelectedTasksTo = next;
      index += 1;
    } else if (arg === "--source-workspace-root" && next) {
      options.sourceWorkspaceRoot = path.resolve(next);
      index += 1;
    } else if (arg === "--company-workspace-root" && next) {
      options.companyWorkspaceRoot = path.resolve(next);
      index += 1;
    } else if (arg === "--allowed-runner-providers" && next) {
      options.allowedRunnerProviders = parseProviderList(next);
      index += 1;
    } else if (arg === "--preferred-runner-provider" && next) {
      const provider = normalizeRunnerProvider(next);
      if (!provider) usage();
      options.preferredRunnerProvider = provider;
      index += 1;
    } else if (arg === "--sanitize-runner-routes") {
      options.sanitizeRunnerRoutes = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage();
    }
  }

  if (!options.allowedRunnerProviders.includes(options.preferredRunnerProvider)) {
    throw new Error(`Preferred runner provider ${options.preferredRunnerProvider} is not included in --allowed-runner-providers.`);
  }
  return options;
}

function assertSafeTarget(sourceDbPath: string, targetDbPath: string): void {
  const appDir = process.cwd();
  const source = path.resolve(sourceDbPath);
  const target = path.resolve(targetDbPath);
  const stableDir = path.resolve(appDir, "data");
  const observerDevDir = path.resolve(appDir, "data-dev");

  if (source === target) {
    throw new Error("Refusing to copy benchmark DB onto itself.");
  }
  if (target.startsWith(`${stableDir}${path.sep}`) || target === stableDir) {
    throw new Error(`Refusing to write execution benchmark DB inside stable data dir: ${stableDir}`);
  }
  if (target.startsWith(`${observerDevDir}${path.sep}`) || target === observerDevDir) {
    throw new Error(`Refusing to write execution benchmark DB inside observer dev data dir: ${observerDevDir}`);
  }
}

type SprintRow = {
  id: string;
  parent_id: string | null;
};

type TaskFixtureRow = {
  id: string;
  task_key: string | null;
};

type WorkspaceRewriteContext = {
  sourceWorkspaceRoot: string | null;
  companyWorkspaceRoot: string | null;
  previousSourceWorkspaceRoots: string[];
  previousCompanyWorkspaceRoots: string[];
};

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function collectChildSprintIds(rows: SprintRow[], rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const current = childrenByParent.get(row.parent_id) ?? [];
    current.push(row.id);
    childrenByParent.set(row.parent_id, current);
  }

  const result: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (result.includes(id)) continue;
    result.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

function taskKeyFingerprint(taskKeys: string[]): string {
  return createHash("sha256").update(taskKeys.join("\n")).digest("hex");
}

function normalizeTaskKeys(taskKeys: string[]): string[] {
  return Array.from(new Set(taskKeys.map((key) => key.trim()).filter(Boolean))).sort();
}

function fixtureTaskKeys(db: Database.Database, rootSprintId: string): string[] {
  const sprintRows = db.prepare("SELECT id, parent_id FROM sprints").all() as SprintRow[];
  const sprintIds = collectChildSprintIds(sprintRows, rootSprintId);
  if (sprintIds.length === 0) return [];
  const taskRows = db
    .prepare(`SELECT id, task_key FROM tasks WHERE sprint_id IN (${placeholders(sprintIds.length)}) ORDER BY task_key, id`)
    .all(...sprintIds) as TaskFixtureRow[];
  return taskRows.map((task) => task.task_key ?? task.id).sort();
}

function selectedFixtureTaskKeys(db: Database.Database, rootSprintId: string, requestedTaskKeys: string[]): string[] {
  const availableTaskKeys = fixtureTaskKeys(db, rootSprintId);
  if (requestedTaskKeys.length === 0) return availableTaskKeys;
  const available = new Set(availableTaskKeys);
  const missing = requestedTaskKeys.filter((key) => !available.has(key));
  if (missing.length > 0) {
    throw new Error(`Requested fixture task key(s) are not under the source goal: ${missing.join(", ")}`);
  }
  return requestedTaskKeys;
}

function parseJsonStringList(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function resetSelectedTasks(db: Database.Database, taskKeys: string[], status: "to-do"): void {
  if (taskKeys.length === 0) return;
  const now = new Date().toISOString();
  db
    .prepare(
      `UPDATE tasks
          SET status = ?,
              started_at = NULL,
              completed_at = NULL,
              execution_session_id = NULL,
              consecutive_noop_wakes = 0,
              blocked_reason = NULL,
              updated_at = ?
        WHERE task_key IN (${placeholders(taskKeys.length)})`,
    )
    .run(status, now, ...taskKeys);

  if (!columnExists(db, "tasks", "eligible_assignee_ids")) return;
  const selected = db
    .prepare(
      `SELECT id, assignee_agent_id, eligible_assignee_ids
         FROM tasks
        WHERE task_key IN (${placeholders(taskKeys.length)})
        ORDER BY task_key`,
    )
    .all(...taskKeys) as Array<{ id: string; assignee_agent_id: string | null; eligible_assignee_ids: string | null }>;
  const updateAssignee = db.prepare("UPDATE tasks SET assignee_agent_id = ?, assigned_at = COALESCE(assigned_at, ?), updated_at = ? WHERE id = ?");
  for (const task of selected) {
    const eligible = parseJsonStringList(task.eligible_assignee_ids);
    const producerAssigneeId = eligible[0] ?? null;
    if (!producerAssigneeId || producerAssigneeId === task.assignee_agent_id) continue;
    updateAssignee.run(producerAssigneeId, now, now, task.id);
  }
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  if (!tableExists(db, tableName)) return false;
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some(
    (column) => column.name === columnName,
  );
}

function replaceWorkspacePrefix(value: string | null, fromRoot: string | null, toRoot: string): string {
  const fallback = toRoot;
  if (!value) return fallback;
  if (!fromRoot) return fallback;
  const relative = path.relative(fromRoot, value);
  if (relative === "") return toRoot;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return fallback;
  return path.join(toRoot, relative);
}

function normalizeRoot(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function uniqueRoots(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(normalizeRoot).filter((value): value is string => Boolean(value)))).sort();
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectJsonStrings);
  const record = asRecord(value);
  if (!record) return [];
  return Object.values(record).flatMap(collectJsonStrings);
}

function companyWorkspaceRootCandidateFromPath(value: string): string | null {
  if (!path.isAbsolute(value)) return null;
  const segments = path.resolve(value).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length - 2; index += 1) {
    if (segments[index] !== "workspaces" || segments[index + 1] !== "companies") continue;
    return path.join(path.parse(value).root, ...segments.slice(0, index + 3));
  }
  return null;
}

function companyWorkspaceRootCandidatesFromJson(metadataJson: string | null | undefined): string[] {
  if (!metadataJson) return [];
  try {
    const parsed = JSON.parse(metadataJson);
    return uniqueRoots(collectJsonStrings(parsed).map(companyWorkspaceRootCandidateFromPath));
  } catch {
    return [];
  }
}

function replaceAnyWorkspacePrefix(value: string, fromRoots: string[], toRoot: string | null): string {
  if (!toRoot) return value;
  if (!path.isAbsolute(value)) return value;
  for (const fromRoot of fromRoots) {
    const relative = path.relative(fromRoot, value);
    if (relative === "") return toRoot;
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return path.join(toRoot, relative);
    }
  }
  return value;
}

function rewriteBundledRunnerCommand(command: string | null, sourceWorkspaceRoot: string | null): string | null {
  const trimmed = command?.trim();
  if (!trimmed || !sourceWorkspaceRoot) return command;
  const parts = trimmed.split(/\s+/);
  const first = parts[0] ?? "";
  const scriptName = path.basename(first);
  if (!BUNDLED_RUNNER_SCRIPT_NAMES.has(scriptName)) return command;
  return [path.join(sourceWorkspaceRoot, "scripts", scriptName), ...parts.slice(1)].join(" ");
}

function readProjectSourceWorkspaceRoot(settingsJson: string | null | undefined): string | null {
  try {
    const settings = asRecord(JSON.parse(settingsJson ?? "{}")) ?? {};
    const workspace = asRecord(settings.workspace);
    const sourceRoot =
      typeof workspace?.sourceRoot === "string"
        ? workspace.sourceRoot
        : typeof settings.sourceWorkspaceRoot === "string"
          ? settings.sourceWorkspaceRoot
          : null;
    return normalizeRoot(sourceRoot);
  } catch {
    return null;
  }
}

function candidateBundledRunnerCommands(sourceWorkspaceRoot: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(BUNDLED_RUNNER_SCRIPT_BY_PROVIDER).map(([provider, scriptName]) => [
      provider,
      path.join(sourceWorkspaceRoot, "scripts", scriptName),
    ]),
  );
}

function bundledRunnerCommandForProvider(provider: RunnerProvider, sourceWorkspaceRoot: string | null): string | null {
  return sourceWorkspaceRoot ? path.join(sourceWorkspaceRoot, "scripts", BUNDLED_RUNNER_SCRIPT_BY_PROVIDER[provider]) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function routeTargetProvider(target: unknown): RunnerProvider | null {
  const record = asRecord(target);
  if (!record) return null;
  return (
    normalizeRunnerProvider(typeof record.runtimeId === "string" ? record.runtimeId : null) ??
    normalizeRunnerProvider(typeof record.runtimeLabel === "string" ? record.runtimeLabel : null) ??
    normalizeRunnerProvider(typeof record.modelSourceId === "string" ? record.modelSourceId : null) ??
    normalizeRunnerProvider(typeof record.modelSourceLabel === "string" ? record.modelSourceLabel : null)
  );
}

function routeTargetForProvider(provider: RunnerProvider): Record<string, unknown> {
  return {
    mode: "runtime_managed",
    runtimeId: provider,
    runtimeLabel: RUNNER_PROVIDER_LABELS[provider],
    modelSourceId: "runtime-managed",
    modelSourceLabel: "Runtime managed",
    modelLabel: "Runtime default",
  };
}

function sanitizeLanesJson(
  lanesJson: string | null,
  input: { allowed: Set<RunnerProvider>; preferred: RunnerProvider },
): { lanesJson: string; changed: boolean; primaryRoutesRewritten: number; fallbacksDropped: number } {
  let lanes: unknown;
  try {
    lanes = JSON.parse(lanesJson ?? "[]");
  } catch {
    throw new Error("Cannot sanitize benchmark runner routes: active hive lanes_json is invalid JSON.");
  }
  if (!Array.isArray(lanes)) {
    throw new Error("Cannot sanitize benchmark runner routes: active hive lanes_json is not an array.");
  }

  let changed = false;
  let primaryRoutesRewritten = 0;
  let fallbacksDropped = 0;
  const nextLanes = lanes.map((lane) => {
    const laneRecord = asRecord(lane);
    if (!laneRecord) return lane;
    const nextLane = { ...laneRecord };
    const primaryProvider = routeTargetProvider(nextLane.primary);
    if (!primaryProvider || !input.allowed.has(primaryProvider)) {
      nextLane.primary = routeTargetForProvider(input.preferred);
      primaryRoutesRewritten += 1;
      changed = true;
    }

    const fallbacks = Array.isArray(nextLane.fallbacks) ? nextLane.fallbacks : [];
    const nextFallbacks = fallbacks.filter((fallback) => {
      const provider = routeTargetProvider(fallback);
      const keep = Boolean(provider && input.allowed.has(provider));
      if (!keep) fallbacksDropped += 1;
      return keep;
    });
    if (nextFallbacks.length !== fallbacks.length || !Array.isArray(nextLane.fallbacks)) {
      nextLane.fallbacks = nextFallbacks;
      changed = true;
    }
    return nextLane;
  });

  return {
    lanesJson: changed ? JSON.stringify(nextLanes) : lanesJson ?? "[]",
    changed,
    primaryRoutesRewritten,
    fallbacksDropped,
  };
}

function selectedFixtureCompanyIds(db: Database.Database, taskKeys: string[]): string[] {
  const companyExpr = columnExists(db, "tasks", "company_id") ? "COALESCE(t.company_id, p.company_id)" : "p.company_id";
  const rows = db
    .prepare(
      `SELECT DISTINCT ${companyExpr} AS company_id
         FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
        WHERE t.task_key IN (${placeholders(taskKeys.length)})
          AND ${companyExpr} IS NOT NULL
        ORDER BY company_id`,
    )
    .all(...taskKeys) as Array<{ company_id: string }>;
  return rows.map((row) => row.company_id);
}

function sanitizeBenchmarkHiveRoutes(
  db: Database.Database,
  companyIds: string[],
  input: { allowed: Set<RunnerProvider>; preferred: RunnerProvider },
): { hivesUpdated: number; primaryRoutesRewritten: number; fallbacksDropped: number } {
  if (companyIds.length === 0 || !tableExists(db, "company_execution_hives") || !columnExists(db, "company_execution_hives", "lanes_json")) {
    return { hivesUpdated: 0, primaryRoutesRewritten: 0, fallbacksDropped: 0 };
  }

  const rows = db
    .prepare(
      `SELECT id, lanes_json
         FROM company_execution_hives
        WHERE company_id IN (${placeholders(companyIds.length)})
          AND archived_at IS NULL
          AND is_active = 1`,
    )
    .all(...companyIds) as Array<{ id: string; lanes_json: string | null }>;
  const now = new Date().toISOString();
  const update = db.prepare("UPDATE company_execution_hives SET lanes_json = ?, updated_at = ? WHERE id = ?");
  let hivesUpdated = 0;
  let primaryRoutesRewritten = 0;
  let fallbacksDropped = 0;
  for (const row of rows) {
    const sanitized = sanitizeLanesJson(row.lanes_json, input);
    primaryRoutesRewritten += sanitized.primaryRoutesRewritten;
    fallbacksDropped += sanitized.fallbacksDropped;
    if (!sanitized.changed) continue;
    hivesUpdated += update.run(sanitized.lanesJson, now, row.id).changes;
  }
  return { hivesUpdated, primaryRoutesRewritten, fallbacksDropped };
}

function sanitizeRuntimeMetadataJson(
  metadataJson: string | null,
  input: { provider: RunnerProvider; command: string | null; companyWorkspaceRoot: string | null },
): { metadataJson: string; changed: boolean } {
  let metadata: Record<string, unknown>;
  try {
    metadata = asRecord(JSON.parse(metadataJson || "{}")) ?? {};
  } catch {
    metadata = {};
  }
  const before = JSON.stringify(metadata);
  metadata.requestedRuntimeProvider = input.provider;
  metadata.selectedRuntimeDisplayName = RUNNER_PROVIDER_LABELS[input.provider];
  delete metadata.model;
  if (input.command) {
    metadata.commandPath = input.command;
    metadata.command = input.command;
  }
  if (input.companyWorkspaceRoot) {
    metadata.workspaceRoot = input.companyWorkspaceRoot;
  }
  const health = asRecord(metadata.health) ? { ...(metadata.health as Record<string, unknown>) } : {};
  if (input.command) {
    health.command = input.command;
    health.commandPath = input.command;
  }
  if (input.companyWorkspaceRoot) {
    health.workspaceRoot = input.companyWorkspaceRoot;
  }
  if (Object.keys(health).length > 0) metadata.health = health;
  metadata.hiverunnerBenchmarkRouteSanitization = {
    schema: "hiverunner.benchmark_route_sanitization.v1",
    provider: input.provider,
    sanitizedAt: new Date().toISOString(),
  };
  const after = JSON.stringify(metadata);
  return { metadataJson: after, changed: before !== after || !metadataJson };
}

function sanitizeSelectedTaskAssigneeRoutes(
  db: Database.Database,
  taskKeys: string[],
  input: {
    allowed: Set<RunnerProvider>;
    preferred: RunnerProvider;
    sourceWorkspaceRoot: string | null;
    companyWorkspaceRoot: string | null;
  },
): {
  agentsUpdated: number;
  agentModelsCleared: number;
  runtimeRowsUpdated: number;
  runtimeRowsDeleted: number;
} {
  if (
    taskKeys.length === 0 ||
    !tableExists(db, "agents") ||
    !columnExists(db, "tasks", "assignee_agent_id") ||
    !columnExists(db, "agents", "adapter_type")
  ) {
    return { agentsUpdated: 0, agentModelsCleared: 0, runtimeRowsUpdated: 0, runtimeRowsDeleted: 0 };
  }

  const agentRows = db
    .prepare(
      `SELECT DISTINCT a.id, a.company_id, a.adapter_type, a.model
         FROM tasks t
         INNER JOIN agents a ON a.id = t.assignee_agent_id
        WHERE t.task_key IN (${placeholders(taskKeys.length)})
          AND t.assignee_agent_id IS NOT NULL
        ORDER BY a.id`,
    )
    .all(...taskKeys) as Array<{
      id: string;
      company_id: string;
      adapter_type: string | null;
      model: string | null;
    }>;
  if (agentRows.length === 0) return { agentsUpdated: 0, agentModelsCleared: 0, runtimeRowsUpdated: 0, runtimeRowsDeleted: 0 };

  const now = new Date().toISOString();
  const agentIds = agentRows.map((row) => row.id);
  const updateAgent = columnExists(db, "agents", "model")
    ? db.prepare("UPDATE agents SET adapter_type = ?, model = ?, updated_at = ? WHERE id = ?")
    : db.prepare("UPDATE agents SET adapter_type = ?, updated_at = ? WHERE id = ?");
  let agentsUpdated = 0;
  let agentModelsCleared = 0;
  for (const row of agentRows) {
    const adapterProvider = normalizeRunnerProvider(row.adapter_type);
    const modelProvider = normalizeRunnerProvider(row.model);
    const adapterAllowed = Boolean(adapterProvider && input.allowed.has(adapterProvider));
    const modelDisallowed = Boolean(modelProvider && !input.allowed.has(modelProvider));
    if (adapterAllowed && !modelDisallowed) continue;
    if (columnExists(db, "agents", "model")) {
      agentsUpdated += updateAgent.run(input.preferred, null, now, row.id).changes;
      if (row.model) agentModelsCleared += 1;
    } else {
      agentsUpdated += updateAgent.run(input.preferred, now, row.id).changes;
    }
  }

  if (!tableExists(db, "agent_runtimes") || !columnExists(db, "agent_runtimes", "agent_id")) {
    return { agentsUpdated, agentModelsCleared, runtimeRowsUpdated: 0, runtimeRowsDeleted: 0 };
  }

  const runtimeRows = db
    .prepare(
      `SELECT id, company_id, provider, runtime_slug, command, metadata_json, workspace_root
         FROM agent_runtimes
        WHERE agent_id IN (${placeholders(agentIds.length)})
        ORDER BY id`,
    )
    .all(...agentIds) as Array<{
      id: string;
      company_id: string;
      provider: string;
      runtime_slug: string;
      command: string | null;
      metadata_json: string | null;
      workspace_root: string | null;
    }>;
  const updateRuntime = db.prepare(
    "UPDATE agent_runtimes SET provider = ?, command = ?, status = 'online', metadata_json = ?, workspace_root = COALESCE(?, workspace_root), updated_at = ? WHERE id = ?",
  );
  const deleteRuntime = db.prepare("DELETE FROM agent_runtimes WHERE id = ?");
  const conflictRuntime = db.prepare(
    "SELECT id FROM agent_runtimes WHERE company_id = ? AND provider = ? AND runtime_slug = ? AND id != ? LIMIT 1",
  );
  let runtimeRowsUpdated = 0;
  let runtimeRowsDeleted = 0;
  for (const row of runtimeRows) {
    const provider = normalizeRunnerProvider(row.provider);
    if (provider && input.allowed.has(provider)) continue;
    const conflict = conflictRuntime.get(row.company_id, input.preferred, row.runtime_slug, row.id) as { id: string } | undefined;
    if (conflict) {
      runtimeRowsDeleted += deleteRuntime.run(row.id).changes;
      continue;
    }
    const command = bundledRunnerCommandForProvider(input.preferred, input.sourceWorkspaceRoot) ?? row.command;
    const metadata = sanitizeRuntimeMetadataJson(row.metadata_json, {
      provider: input.preferred,
      command,
      companyWorkspaceRoot: input.companyWorkspaceRoot,
    });
    runtimeRowsUpdated += updateRuntime.run(
      input.preferred,
      command,
      metadata.metadataJson,
      input.companyWorkspaceRoot,
      now,
      row.id,
    ).changes;
  }

  return { agentsUpdated, agentModelsCleared, runtimeRowsUpdated, runtimeRowsDeleted };
}

function sanitizeBenchmarkRunnerRoutes(
  db: Database.Database,
  taskKeys: string[],
  input: {
    allowedRunnerProviders: RunnerProvider[];
    preferredRunnerProvider: RunnerProvider;
    sourceWorkspaceRoot: string | null;
    companyWorkspaceRoot: string | null;
  },
) {
  if (taskKeys.length === 0) {
    throw new Error("Runner-route sanitization requires a non-empty frozen task-key list.");
  }
  const allowed = new Set(input.allowedRunnerProviders);
  const companyIds = selectedFixtureCompanyIds(db, taskKeys);
  const hiveSummary = sanitizeBenchmarkHiveRoutes(db, companyIds, {
    allowed,
    preferred: input.preferredRunnerProvider,
  });
  const assigneeSummary = sanitizeSelectedTaskAssigneeRoutes(db, taskKeys, {
    allowed,
    preferred: input.preferredRunnerProvider,
    sourceWorkspaceRoot: input.sourceWorkspaceRoot,
    companyWorkspaceRoot: input.companyWorkspaceRoot,
  });
  return {
    schema: "hiverunner.exec_dev_runner_route_sanitization.v1",
    allowedRunnerProviders: input.allowedRunnerProviders,
    preferredRunnerProvider: input.preferredRunnerProvider,
    companyIds,
    ...hiveSummary,
    ...assigneeSummary,
  };
}

function rewriteWorkspaceString(value: string, context: WorkspaceRewriteContext): string {
  const withSourceRoot = replaceAnyWorkspacePrefix(
    value,
    context.previousSourceWorkspaceRoots,
    context.sourceWorkspaceRoot,
  );
  const withCompanyRoot = replaceAnyWorkspacePrefix(
    withSourceRoot,
    context.previousCompanyWorkspaceRoots,
    context.companyWorkspaceRoot,
  );
  return rewriteBundledRunnerCommand(withCompanyRoot, context.sourceWorkspaceRoot) ?? withCompanyRoot;
}

function rewriteJsonArrayWorkspacePaths(
  values: unknown[],
  context: WorkspaceRewriteContext,
): { value: unknown[]; changed: boolean } {
  let changed = false;
  const next = values.map((item) => {
    const rewritten = rewriteJsonWorkspacePaths(item, context);
    changed = changed || rewritten.changed;
    return rewritten.value;
  });
  return { value: changed ? next : values, changed };
}

function rewriteJsonRecordWorkspacePaths(
  record: Record<string, unknown>,
  context: WorkspaceRewriteContext,
): { value: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    const rewritten = rewriteJsonWorkspacePaths(item, context);
    changed = changed || rewritten.changed;
    next[key] = rewritten.value;
  }
  return { value: changed ? next : record, changed };
}

function rewriteJsonWorkspacePaths(value: unknown, context: WorkspaceRewriteContext): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const rewritten = rewriteWorkspaceString(value, context);
    return { value: rewritten, changed: rewritten !== value };
  }
  if (Array.isArray(value)) {
    return rewriteJsonArrayWorkspacePaths(value, context);
  }
  const record = asRecord(value);
  return record ? rewriteJsonRecordWorkspacePaths(record, context) : { value, changed: false };
}

function rewriteProjectSettingsJson(
  settingsJson: string | null,
  context: WorkspaceRewriteContext,
): { settingsJson: string; changed: boolean } {
  let settings: Record<string, unknown>;
  try {
    settings = asRecord(JSON.parse(settingsJson ?? "{}")) ?? {};
  } catch {
    settings = {};
  }

  const rewritten = rewriteJsonWorkspacePaths(settings, context);
  settings = asRecord(rewritten.value) ?? {};
  let changed = rewritten.changed || !settingsJson;

  if (context.sourceWorkspaceRoot) {
    const workspace = asRecord(settings.workspace) ? { ...(settings.workspace as Record<string, unknown>) } : {};
    if (workspace.sourceRoot !== context.sourceWorkspaceRoot) {
      workspace.sourceRoot = context.sourceWorkspaceRoot;
      changed = true;
    }
    if (settings.sourceWorkspaceRoot !== context.sourceWorkspaceRoot) {
      settings.sourceWorkspaceRoot = context.sourceWorkspaceRoot;
      changed = true;
    }
    settings.workspace = workspace;
  }

  const next = JSON.stringify(settings);
  return { settingsJson: next, changed: changed || next !== settingsJson };
}

function rewriteBenchmarkReplayBundledRunnerMetadata(
  metadata: Record<string, unknown>,
  sourceWorkspaceRoot: string,
): boolean {
  const existing = asRecord(metadata.hiverunnerBenchmarkReplay) ?? {};
  const next = {
    ...existing,
    schema: "hiverunner.benchmark_replay_runtime_paths.v1",
    bundledRunnerScriptRoot: sourceWorkspaceRoot,
    bundledRunnerCommands: candidateBundledRunnerCommands(sourceWorkspaceRoot),
  };
  if (JSON.stringify(existing) === JSON.stringify(next)) return false;
  metadata.hiverunnerBenchmarkReplay = next;
  return true;
}

function rewriteMetadataBundledRunnerCommands(
  metadataJson: string | null,
  context: WorkspaceRewriteContext,
  options: { stampBenchmarkReplayBundledRunners?: boolean } = {},
): { metadataJson: string | null; changed: boolean; benchmarkReplayMetadataChanged: boolean } {
  if (!context.sourceWorkspaceRoot && !context.companyWorkspaceRoot && (!metadataJson && !options.stampBenchmarkReplayBundledRunners)) {
    return { metadataJson, changed: false, benchmarkReplayMetadataChanged: false };
  }
  let metadata: Record<string, unknown>;
  try {
    metadata = asRecord(JSON.parse(metadataJson || "{}")) ?? {};
  } catch {
    return { metadataJson, changed: false, benchmarkReplayMetadataChanged: false };
  }

  let changed = false;
  let benchmarkReplayMetadataChanged = false;
  const rewrittenMetadata = rewriteJsonWorkspacePaths(metadata, context);
  if (rewrittenMetadata.changed) {
    metadata = asRecord(rewrittenMetadata.value) ?? metadata;
    changed = true;
  }
  const rewriteStringKey = (target: Record<string, unknown>, key: string) => {
    if (typeof target[key] !== "string") return;
    const rewritten = rewriteBundledRunnerCommand(target[key], context.sourceWorkspaceRoot);
    if (rewritten === target[key]) return;
    target[key] = rewritten;
    changed = true;
  };

  rewriteStringKey(metadata, "command");
  rewriteStringKey(metadata, "commandPath");

  if (metadata.health && typeof metadata.health === "object" && !Array.isArray(metadata.health)) {
    const health = { ...(metadata.health as Record<string, unknown>) };
    rewriteStringKey(health, "command");
    rewriteStringKey(health, "commandPath");
    if (changed) metadata.health = health;
  }

  if (options.stampBenchmarkReplayBundledRunners && context.sourceWorkspaceRoot) {
    benchmarkReplayMetadataChanged = rewriteBenchmarkReplayBundledRunnerMetadata(metadata, context.sourceWorkspaceRoot);
    changed = changed || benchmarkReplayMetadataChanged;
  }

  return {
    metadataJson: changed ? JSON.stringify(metadata) : metadataJson,
    changed,
    benchmarkReplayMetadataChanged,
  };
}

function rewriteWorkspaceRoots(
  db: Database.Database,
  taskKeys: string[],
  input: {
    sourceWorkspaceRoot: string | null;
    companyWorkspaceRoot: string | null;
  },
): {
  sourceWorkspaceRoot: string | null;
  companyWorkspaceRoot: string | null;
  previousSourceWorkspaceRoots: string[];
  previousCompanyWorkspaceRoots: string[];
  companyIds: string[];
  projectIds: string[];
  agentRuntimeRowsUpdated: number;
  agentRuntimeCommandRowsUpdated: number;
  agentRuntimeMetadataRowsUpdated: number;
  agentRuntimeBenchmarkReplayMetadataRowsUpdated: number;
  projectSettingsRowsUpdated: number;
  companySettingsRowsUpdated: number;
} {
  if (!input.sourceWorkspaceRoot && !input.companyWorkspaceRoot) {
    return {
      sourceWorkspaceRoot: null,
      companyWorkspaceRoot: null,
      previousSourceWorkspaceRoots: [],
      previousCompanyWorkspaceRoots: [],
      companyIds: [],
      projectIds: [],
      agentRuntimeRowsUpdated: 0,
      agentRuntimeCommandRowsUpdated: 0,
      agentRuntimeMetadataRowsUpdated: 0,
      agentRuntimeBenchmarkReplayMetadataRowsUpdated: 0,
      projectSettingsRowsUpdated: 0,
      companySettingsRowsUpdated: 0,
    };
  }
  if (taskKeys.length === 0) {
    throw new Error("Workspace rewrite requires a non-empty frozen task-key list.");
  }

  const projectRows = db
    .prepare(
      `SELECT DISTINCT p.id AS project_id, p.settings_json, p.company_id,
              c.workspace_root AS company_workspace_root
         FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
         INNER JOIN companies c ON c.id = p.company_id
        WHERE t.task_key IN (${placeholders(taskKeys.length)})`,
    )
    .all(...taskKeys) as Array<{
      project_id: string;
      settings_json: string | null;
      company_id: string;
      company_workspace_root: string | null;
    }>;

  const projectIds = Array.from(new Set(projectRows.map((row) => row.project_id))).sort();
  const companyIds = Array.from(new Set(projectRows.map((row) => row.company_id))).sort();
  if (projectIds.length === 0 || companyIds.length === 0) {
    throw new Error("Workspace rewrite could not resolve fixture projects or companies.");
  }
  if (companyIds.length !== 1 && input.companyWorkspaceRoot) {
    throw new Error(`Workspace rewrite supports one fixture company at a time; found ${companyIds.length}.`);
  }

  const now = new Date().toISOString();
  const runtimeRowsForFixtureCompanies = columnExists(db, "agent_runtimes", "company_id")
    ? db
      .prepare(`SELECT id, company_id, workspace_root, metadata_json FROM agent_runtimes WHERE company_id IN (${placeholders(companyIds.length)})`)
      .all(...companyIds) as Array<{
        id: string;
        company_id: string;
        workspace_root: string | null;
        metadata_json: string | null;
      }>
    : [];
  const nextSourceRoot = normalizeRoot(input.sourceWorkspaceRoot);
  const nextCompanyRoot = normalizeRoot(input.companyWorkspaceRoot);
  const previousSourceWorkspaceRoots = uniqueRoots(projectRows.map((row) => readProjectSourceWorkspaceRoot(row.settings_json)))
    .filter((root) => root !== nextSourceRoot);
  const previousCompanyWorkspaceRoots = uniqueRoots([
    ...projectRows.map((row) => row.company_workspace_root),
    ...runtimeRowsForFixtureCompanies.map((row) => row.workspace_root),
    ...runtimeRowsForFixtureCompanies.flatMap((row) => companyWorkspaceRootCandidatesFromJson(row.metadata_json)),
  ])
    .filter((root) => root !== nextCompanyRoot);
  const rewriteContext: WorkspaceRewriteContext = {
    sourceWorkspaceRoot: input.sourceWorkspaceRoot,
    companyWorkspaceRoot: input.companyWorkspaceRoot,
    previousSourceWorkspaceRoots,
    previousCompanyWorkspaceRoots,
  };

  let projectSettingsRowsUpdated = 0;
  for (const row of projectRows) {
    const rewritten = rewriteProjectSettingsJson(row.settings_json, rewriteContext);
    if (!rewritten.changed) continue;
    projectSettingsRowsUpdated += db
      .prepare("UPDATE projects SET settings_json = ?, updated_at = ? WHERE id = ?")
      .run(rewritten.settingsJson, now, row.project_id).changes;
  }

  let companySettingsRowsUpdated = 0;
  if (columnExists(db, "companies", "settings_json")) {
    const companySettingsRows = db
      .prepare(`SELECT id, settings_json FROM companies WHERE id IN (${placeholders(companyIds.length)})`)
      .all(...companyIds) as Array<{ id: string; settings_json: string | null }>;
    const updateCompanySettings = db.prepare("UPDATE companies SET settings_json = ?, updated_at = ? WHERE id = ?");
    for (const row of companySettingsRows) {
      if (!row.settings_json) continue;
      let settings: unknown;
      try {
        settings = JSON.parse(row.settings_json);
      } catch {
        continue;
      }
      const rewritten = rewriteJsonWorkspacePaths(settings, rewriteContext);
      if (!rewritten.changed) continue;
      companySettingsRowsUpdated += updateCompanySettings.run(JSON.stringify(rewritten.value), now, row.id).changes;
    }
  }

  let agentRuntimeRowsUpdated = 0;
  let agentRuntimeCommandRowsUpdated = 0;
  let agentRuntimeMetadataRowsUpdated = 0;
  let agentRuntimeBenchmarkReplayMetadataRowsUpdated = 0;
  if (input.companyWorkspaceRoot) {
    const companyId = companyIds[0];
    const oldCompanyRoot = projectRows.find((row) => row.company_id === companyId)?.company_workspace_root?.trim() || null;
    db.prepare("UPDATE companies SET workspace_root = ?, workspace_source = 'manual', updated_at = ? WHERE id = ?")
      .run(input.companyWorkspaceRoot, now, companyId);

    if (columnExists(db, "agent_runtimes", "workspace_root")) {
      const runtimeRows = db
        .prepare("SELECT id, workspace_root FROM agent_runtimes WHERE company_id = ? AND workspace_root IS NOT NULL")
        .all(companyId) as Array<{ id: string; workspace_root: string | null }>;
      const updateRuntime = db.prepare("UPDATE agent_runtimes SET workspace_root = ?, updated_at = ? WHERE id = ?");
      for (const row of runtimeRows) {
        const rewritten = replaceWorkspacePrefix(row.workspace_root, oldCompanyRoot, input.companyWorkspaceRoot);
        agentRuntimeRowsUpdated += updateRuntime.run(rewritten, now, row.id).changes;
      }
    }
  }

  if ((input.sourceWorkspaceRoot || input.companyWorkspaceRoot) && columnExists(db, "agent_runtimes", "command")) {
    const scopedByCompany = columnExists(db, "agent_runtimes", "company_id");
    const runtimeRows = scopedByCompany
      ? db
        .prepare(
          `SELECT id, provider, command, metadata_json
             FROM agent_runtimes
            WHERE company_id IN (${placeholders(companyIds.length)})
              AND (command IS NOT NULL OR metadata_json IS NOT NULL OR provider = 'symphony')`,
        )
        .all(...companyIds) as Array<{ id: string; provider: string; command: string | null; metadata_json: string | null }>
      : db
        .prepare("SELECT id, provider, command, metadata_json FROM agent_runtimes WHERE command IS NOT NULL OR metadata_json IS NOT NULL OR provider = 'symphony'")
        .all() as Array<{ id: string; provider: string; command: string | null; metadata_json: string | null }>;
    const updateCommand = db.prepare("UPDATE agent_runtimes SET command = ?, metadata_json = ?, updated_at = ? WHERE id = ?");
    for (const row of runtimeRows) {
      const rewritten = rewriteBundledRunnerCommand(row.command, input.sourceWorkspaceRoot);
      const metadata = rewriteMetadataBundledRunnerCommands(row.metadata_json, rewriteContext, {
        stampBenchmarkReplayBundledRunners: row.provider === "symphony",
      });
      if (rewritten === row.command && !metadata.changed) continue;
      const changes = updateCommand.run(rewritten, metadata.metadataJson, now, row.id).changes;
      if (rewritten !== row.command) agentRuntimeCommandRowsUpdated += changes;
      if (metadata.changed) agentRuntimeMetadataRowsUpdated += changes;
      if (metadata.benchmarkReplayMetadataChanged) agentRuntimeBenchmarkReplayMetadataRowsUpdated += changes;
    }
  }

  return {
    sourceWorkspaceRoot: input.sourceWorkspaceRoot,
    companyWorkspaceRoot: input.companyWorkspaceRoot,
    previousSourceWorkspaceRoots,
    previousCompanyWorkspaceRoots,
    companyIds,
    projectIds,
    agentRuntimeRowsUpdated,
    agentRuntimeCommandRowsUpdated,
    agentRuntimeMetadataRowsUpdated,
    agentRuntimeBenchmarkReplayMetadataRowsUpdated,
    projectSettingsRowsUpdated,
    companySettingsRowsUpdated,
  };
}

function assertNoPreviousRoots(
  label: string,
  value: string | null | undefined,
  previousRoots: string[],
): void {
  if (!value) return;
  for (const root of previousRoots) {
    if (value.includes(root)) {
      throw new Error(`Workspace rewrite left stale ${label} root ${root}`);
    }
  }
}

function assertWorkspaceRewriteApplied(
  db: Database.Database,
  taskKeys: string[],
  rewrite: ReturnType<typeof rewriteWorkspaceRoots> | null,
): void {
  if (!rewrite || taskKeys.length === 0) return;
  const rows = db
    .prepare(
      `SELECT DISTINCT p.id AS project_id, p.settings_json, c.id AS company_id, c.workspace_root
         FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
         INNER JOIN companies c ON c.id = p.company_id
        WHERE t.task_key IN (${placeholders(taskKeys.length)})`,
    )
    .all(...taskKeys) as Array<{
      project_id: string;
      settings_json: string | null;
      company_id: string;
      workspace_root: string | null;
    }>;

  for (const row of rows) {
    if (rewrite.sourceWorkspaceRoot) {
      const sourceRoot = readProjectSourceWorkspaceRoot(row.settings_json);
      if (sourceRoot !== rewrite.sourceWorkspaceRoot) {
        throw new Error(`Workspace rewrite failed for project ${row.project_id}: expected sourceRoot ${rewrite.sourceWorkspaceRoot}, got ${sourceRoot ?? "null"}`);
      }
      assertNoPreviousRoots(`project ${row.project_id} settings`, row.settings_json, rewrite.previousSourceWorkspaceRoots);
    }
    if (rewrite.companyWorkspaceRoot && normalizeRoot(row.workspace_root) !== rewrite.companyWorkspaceRoot) {
      throw new Error(`Workspace rewrite failed for company ${row.company_id}: expected workspace_root ${rewrite.companyWorkspaceRoot}, got ${row.workspace_root ?? "null"}`);
    }
    assertNoPreviousRoots(`project ${row.project_id} settings`, row.settings_json, rewrite.previousCompanyWorkspaceRoots);
  }

  if (rewrite.companyIds.length === 0) return;
  const runtimeRows = db
    .prepare(
      `SELECT id, command, workspace_root, metadata_json
         FROM agent_runtimes
        WHERE company_id IN (${placeholders(rewrite.companyIds.length)})`,
    )
    .all(...rewrite.companyIds) as Array<{
      id: string;
      command: string | null;
      workspace_root: string | null;
      metadata_json: string | null;
    }>;

  for (const row of runtimeRows) {
    assertNoPreviousRoots(`runtime ${row.id} command`, row.command, rewrite.previousSourceWorkspaceRoots);
    assertNoPreviousRoots(`runtime ${row.id} metadata`, row.metadata_json, rewrite.previousSourceWorkspaceRoots);
    assertNoPreviousRoots(`runtime ${row.id} workspace`, row.workspace_root, rewrite.previousCompanyWorkspaceRoots);
    assertNoPreviousRoots(`runtime ${row.id} metadata`, row.metadata_json, rewrite.previousCompanyWorkspaceRoots);
  }
}

function replaySummaryCommands(input: {
  dbPath: string;
  goalKey: string;
  fixtureId: string;
  requiredRepeats: number;
  expectedTaskCount: number;
  taskKeys: string[];
  allowedRunnerProviders: RunnerProvider[];
}): string[] {
  const commands: string[] = [];
  const taskKeyArgs = input.taskKeys.map((taskKey) => `--task-key ${taskKey}`).join(" ");
  for (const arm of ["baseline", "candidate"] as const) {
    for (let repeat = 1; repeat <= input.requiredRepeats; repeat += 1) {
      commands.push([
        "node ./scripts/run-tsx.mjs scripts/runtime-benchmark.ts",
        `--db ${input.dbPath}`,
        `--goal ${input.goalKey}`,
        `--fixture-id ${input.fixtureId}`,
        `--arm ${arm}`,
        `--repeat ${repeat}`,
        `--required-repeats ${input.requiredRepeats}`,
        `--expected-tasks ${input.expectedTaskCount}`,
        taskKeyArgs,
        "--run-started-after <repeat-start-iso>",
        "--run-started-before <repeat-end-iso>",
        "--format json",
        `--out output/runtime-benchmark/${arm}-repeat-${repeat}.json`,
      ].filter(Boolean).join(" "));
    }
  }
  return commands;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertSafeTarget(options.sourceDbPath, options.targetDbPath);

  const source = new Database(options.sourceDbPath, { readonly: true, fileMustExist: true });
  try {
    source.pragma("query_only = ON");
    assertOrchestrationMigrationCompatible({
      db: source,
      dbPath: options.sourceDbPath,
      label: "benchmark fixture preparation with migration-incompatible source DB",
    });

    const goal = source
      .prepare("SELECT id, goal_key, name, status FROM sprints WHERE goal_key = ? LIMIT 1")
      .get(options.goalKey) as { id: string; goal_key: string; name: string; status: string } | undefined;
    if (!goal) {
      throw new Error(`Goal ${options.goalKey} not found in source DB.`);
    }
    const requestedTaskKeys = normalizeTaskKeys(options.taskKeys);
    const taskKeys = selectedFixtureTaskKeys(source, goal.id, requestedTaskKeys);
    if (taskKeys.length !== options.expectedTaskCount) {
      throw new Error(
        `Goal ${options.goalKey} has ${taskKeys.length} tasks, but the frozen replay fixture requires ${options.expectedTaskCount}. ` +
        "Create or select the 10-task fixture goal before preparing execution-dev benchmark data.",
      );
    }

    fs.mkdirSync(path.dirname(options.targetDbPath), { recursive: true });

    if (fs.existsSync(options.targetDbPath)) {
      fs.rmSync(options.targetDbPath);
    }
    await source.backup(options.targetDbPath);

    if (options.resetSelectedTasksTo === "to-do") {
      const writable = new Database(options.targetDbPath, { fileMustExist: true });
      try {
        resetSelectedTasks(writable, taskKeys, "to-do");
      } finally {
        writable.close();
      }
    }

    let workspaceRewrite: ReturnType<typeof rewriteWorkspaceRoots> | null = null;
    let routeSanitization: ReturnType<typeof sanitizeBenchmarkRunnerRoutes> | null = null;
    if (options.sourceWorkspaceRoot || options.companyWorkspaceRoot) {
      const writable = new Database(options.targetDbPath, { fileMustExist: true });
      try {
        workspaceRewrite = rewriteWorkspaceRoots(writable, taskKeys, {
          sourceWorkspaceRoot: options.sourceWorkspaceRoot,
          companyWorkspaceRoot: options.companyWorkspaceRoot,
        });
      } finally {
        writable.close();
      }
    }

    if (options.sanitizeRunnerRoutes) {
      const writable = new Database(options.targetDbPath, { fileMustExist: true });
      try {
        routeSanitization = sanitizeBenchmarkRunnerRoutes(writable, taskKeys, {
          allowedRunnerProviders: options.allowedRunnerProviders,
          preferredRunnerProvider: options.preferredRunnerProvider,
          sourceWorkspaceRoot: options.sourceWorkspaceRoot,
          companyWorkspaceRoot: options.companyWorkspaceRoot,
        });
      } finally {
        writable.close();
      }
    }

    const copied = new Database(options.targetDbPath, { readonly: true, fileMustExist: true });
    try {
      copied.pragma("query_only = ON");
      const copiedGoal = copied.prepare("SELECT id FROM sprints WHERE goal_key = ? LIMIT 1").get(options.goalKey);
      if (!copiedGoal) {
        throw new Error(`Copied DB is missing goal ${options.goalKey}.`);
      }
      assertWorkspaceRewriteApplied(copied, taskKeys, workspaceRewrite);
    } finally {
      copied.close();
    }

    const manifest = {
      schema: "hiverunner.exec-dev-benchmark-manifest.v2",
      createdAt: new Date().toISOString(),
      goalKey: options.goalKey,
      sourceDbPath: path.resolve(options.sourceDbPath),
      targetDbPath: path.resolve(options.targetDbPath),
      targetDataDir: path.dirname(path.resolve(options.targetDbPath)),
      goal,
      fixture: {
        fixtureId: options.fixtureId,
        expectedTaskCount: options.expectedTaskCount,
        taskCount: taskKeys.length,
        taskKeys,
        taskKeyFingerprint: taskKeyFingerprint(taskKeys),
      },
      protocol: {
        arms: ["baseline", "candidate"],
        requiredRepeats: options.requiredRepeats,
        resetSelectedTasksTo: options.resetSelectedTasksTo,
        workspaceRewrite,
        allowedRunnerProviders: options.allowedRunnerProviders,
        routeSanitization,
        report: "Run each arm against the same frozen fixture DB in an isolated execution-dev lane, then pass all repeat summary JSON files to scripts/runtime-promotion-gate.ts.",
        summaryCommands: replaySummaryCommands({
          dbPath: path.resolve(options.targetDbPath),
          goalKey: options.goalKey,
          fixtureId: options.fixtureId,
          requiredRepeats: options.requiredRepeats,
          expectedTaskCount: options.expectedTaskCount,
          taskKeys,
          allowedRunnerProviders: options.allowedRunnerProviders,
        }),
      },
      notes: [
        "Copied with better-sqlite3 backup from a readonly/query_only source handle.",
        "Target is intended for an execution-dev lane only, not stable 3001 or observer-only 3010.",
        "If routeSanitization is present, selected benchmark tasks were restricted to the manifest's allowedRunnerProviders before replay.",
        "Promotion requires baseline and candidate arms, at least three repeats per arm, UI consistency proof, and untracked-action proof.",
      ],
    };
    fs.writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Prepared execution-dev benchmark DB: ${options.targetDbPath}`);
    console.log(`Manifest: ${options.manifestPath}`);
  } finally {
    source.close();
  }
}

main().catch((error) => {
  console.error(`[prepare-exec-dev-benchmark] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
