import fs from "node:fs";
import path from "node:path";

import {
  getOrchestrationDb,
  getOrchestrationDbPath,
} from "@/lib/orchestration/db";
import { tick } from "@/lib/orchestration/engine/engine";
import {
  executionRouteAttempts,
  resolveExecutionRoute,
} from "@/lib/orchestration/execution-route-resolver";
import { assertOrchestrationDbPathMigrationCompatible } from "./lib/orchestration-migration-compatibility";

type CliOptions = {
  goalKey: string;
  taskKeys: string[];
  outPath: string | null;
  maxMinutes: number;
  pollMs: number;
  requireIsolatedWorkspace: boolean;
  checkOnly: boolean;
  allowGeneratedTasks: boolean;
  allowedRunnerProviders: string[];
};

const TERMINAL_TASK_STATUSES = new Set(["done", "blocked", "cancelled", "backlog"]);
const DEFAULT_ALLOWED_RUNNER_PROVIDERS = ["codex", "anthropic"];

function usage(): never {
  console.error([
    "Usage: node ./scripts/run-tsx.mjs scripts/runtime-benchmark-repeat.ts --task-keys INS-205,INS-208 [options]",
    "       [--goal INS-G006] [--out output/runtime-benchmark/repeat-window.json]",
    "       [--max-minutes 30] [--poll-ms 5000] [--allow-live-workspace] [--allow-generated-tasks] [--allowed-runner-providers codex,anthropic] [--check-only]",
  ].join("\n"));
  process.exit(1);
}

function normalizeRunnerProvider(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code" || normalized === "anthropic") return "anthropic";
  if (normalized === "openai" || normalized === "openai-codex" || normalized === "codex") return "codex";
  if (normalized === "google" || normalized === "gemini" || normalized === "gemini-cli") return "gemini";
  return normalized;
}

function parseProviderList(value: string | null | undefined): string[] {
  return Array.from(new Set(String(value ?? "")
    .split(",")
    .map((provider) => normalizeRunnerProvider(provider))
    .filter(Boolean)))
    .sort();
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    goalKey: "INS-G006",
    taskKeys: [],
    outPath: null,
    maxMinutes: 30,
    pollMs: 5_000,
    requireIsolatedWorkspace: true,
    checkOnly: false,
    allowGeneratedTasks: false,
    allowedRunnerProviders: DEFAULT_ALLOWED_RUNNER_PROVIDERS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--goal" && next) {
      options.goalKey = next;
      index += 1;
    } else if (arg === "--task-key" && next) {
      options.taskKeys.push(next);
      index += 1;
    } else if (arg === "--task-keys" && next) {
      options.taskKeys.push(...next.split(","));
      index += 1;
    } else if (arg === "--out" && next) {
      options.outPath = next;
      index += 1;
    } else if (arg === "--max-minutes" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) usage();
      options.maxMinutes = parsed;
      index += 1;
    } else if (arg === "--poll-ms" && next) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 1000) usage();
      options.pollMs = parsed;
      index += 1;
    } else if (arg === "--allow-live-workspace") {
      options.requireIsolatedWorkspace = false;
    } else if (arg === "--allow-generated-tasks") {
      options.allowGeneratedTasks = true;
    } else if (arg === "--allowed-runner-providers" && next) {
      const providers = parseProviderList(next);
      if (providers.length === 0) usage();
      options.allowedRunnerProviders = providers;
      index += 1;
    } else if (arg === "--check-only") {
      options.checkOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage();
    }
  }

  options.taskKeys = Array.from(new Set(options.taskKeys.map((key) => key.trim()).filter(Boolean))).sort();
  if (options.taskKeys.length === 0) usage();
  return options;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertConfiguredDbMigrationCompatible(label: string): void {
  const dbPath = getOrchestrationDbPath();
  assertOrchestrationDbPathMigrationCompatible({
    dbPath,
    label: `${label} with migration-incompatible orchestration DB`,
  });
}

function readProjectSourceRoot(settingsJson: string | null): string | null {
  try {
    const settings = JSON.parse(settingsJson ?? "{}") as {
      workspace?: { sourceRoot?: unknown };
    };
    return typeof settings.workspace?.sourceRoot === "string" && settings.workspace.sourceRoot.trim()
      ? path.resolve(settings.workspace.sourceRoot)
      : null;
  } catch {
    return null;
  }
}

function isDangerousWorkspace(workspaceRoot: string | null): boolean {
  if (!workspaceRoot) return false;
  const resolved = path.resolve(workspaceRoot);
  const dangerousRoots = [
    "/Users/timharris/.mission-control/app",
    "/Users/timharris/.mission-control/app/.stable",
    "/Users/timharris/.mission-control/stable/workspaces",
  ];
  return dangerousRoots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function assertIsolatedWorkspace(db: ReturnType<typeof getOrchestrationDb>, taskKeys: string[]): void {
  const rows = db
    .prepare(
      `SELECT DISTINCT
              p.id AS project_id,
              p.settings_json,
              c.id AS company_id,
              c.workspace_root
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

  if (rows.length === 0) {
    throw new Error("No fixture tasks matched the requested task keys.");
  }

  const unsafe = new Set<string>();
  for (const row of rows) {
    const sourceRoot = readProjectSourceRoot(row.settings_json);
    if (isDangerousWorkspace(sourceRoot)) unsafe.add(`project sourceRoot ${sourceRoot}`);
    if (isDangerousWorkspace(row.workspace_root)) unsafe.add(`company workspace_root ${row.workspace_root}`);
  }

  if (unsafe.size > 0) {
    throw new Error(`Refusing live replay against non-isolated workspace(s): ${Array.from(unsafe).join("; ")}`);
  }

  const companyIds = Array.from(new Set(rows.map((row) => row.company_id)));
  if (companyIds.length > 0) {
    const runtimeRows = db
      .prepare(
        `SELECT workspace_root
           FROM agent_runtimes
          WHERE company_id IN (${placeholders(companyIds.length)})
            AND workspace_root IS NOT NULL`,
      )
      .all(...companyIds) as Array<{ workspace_root: string | null }>;
    for (const row of runtimeRows) {
      if (isDangerousWorkspace(row.workspace_root)) {
        unsafe.add(`agent runtime workspace_root ${row.workspace_root}`);
      }
    }
  }

  if (unsafe.size > 0) {
    throw new Error(`Refusing live replay against non-isolated runtime workspace(s): ${Array.from(unsafe).join("; ")}`);
  }
}

function readTaskStatuses(db: ReturnType<typeof getOrchestrationDb>, taskKeys: string[]) {
  return db
    .prepare(
      `SELECT task_key, status, assignee_agent_id, updated_at
         FROM tasks
        WHERE task_key IN (${placeholders(taskKeys.length)})
        ORDER BY task_key`,
    )
    .all(...taskKeys) as Array<{
      task_key: string;
      status: string;
      assignee_agent_id: string | null;
      updated_at: string;
    }>;
}

function readSelectedTaskProjectIds(db: ReturnType<typeof getOrchestrationDb>, taskKeys: string[]): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT project_id
         FROM tasks
        WHERE task_key IN (${placeholders(taskKeys.length)})
        ORDER BY project_id`,
    )
    .all(...taskKeys) as Array<{ project_id: string }>;
  return rows.map((row) => row.project_id);
}

function readGeneratedTasksInFixtureProjects(
  db: ReturnType<typeof getOrchestrationDb>,
  input: { projectIds: string[]; taskKeys: string[]; startedAt: string },
) {
  if (input.projectIds.length === 0) return [];
  return db
    .prepare(
      `SELECT task_key, title, status, created_at
         FROM tasks
        WHERE project_id IN (${placeholders(input.projectIds.length)})
          AND task_key NOT IN (${placeholders(input.taskKeys.length)})
          AND created_at >= ?
        ORDER BY created_at ASC, task_key ASC`,
    )
    .all(...input.projectIds, ...input.taskKeys, input.startedAt) as Array<{
      task_key: string;
      title: string;
      status: string;
      created_at: string;
	    }>;
}

type RuntimeRouteProviderViolation = {
  taskKey: string;
  lane: string;
  executionEngine: string;
  runnerProvider: string;
  fallbackUsed: boolean;
  fallbackIndex: number | null;
};

type RuntimeRunProviderViolation = {
  taskKey: string;
  executionRunId: string;
  provider: string;
  runnerProvider: string | null;
  concreteRunnerProvider: string;
  status: string;
  startedAt: string | null;
};

type ReplayScopeViolation =
  | {
      reason: "fixture_generated_tasks";
      generatedTasks: ReturnType<typeof readGeneratedTasksInFixtureProjects>;
    }
  | {
      reason: "disallowed_route_provider";
      allowedRunnerProviders: string[];
      routeViolations: RuntimeRouteProviderViolation[];
    }
  | {
      reason: "disallowed_execution_run_provider";
      allowedRunnerProviders: string[];
      runViolations: RuntimeRunProviderViolation[];
    };

function readRouteProviderViolations(
  db: ReturnType<typeof getOrchestrationDb>,
  input: { taskKeys: string[]; allowedRunnerProviders: Set<string> },
): RuntimeRouteProviderViolation[] {
  const rows = db
    .prepare(
      `SELECT
         t.task_key,
         t.model_lane,
         t.execution_engine,
         COALESCE(t.company_id, p.company_id) AS company_id,
         a.adapter_type AS assignee_adapter_type,
         a.model AS assignee_model
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE t.task_key IN (${placeholders(input.taskKeys.length)})
         AND t.archived_at IS NULL
       ORDER BY t.task_key`,
    )
    .all(...input.taskKeys) as Array<{
      task_key: string;
      model_lane: string | null;
      execution_engine: string | null;
      company_id: string;
      assignee_adapter_type: string | null;
      assignee_model: string | null;
    }>;

  const violations: RuntimeRouteProviderViolation[] = [];
  for (const row of rows) {
    const route = resolveExecutionRoute({
      companyId: row.company_id,
      task: {
        modelLane: row.model_lane,
        executionEngine: row.execution_engine,
        assigneeAdapterType: row.assignee_adapter_type,
        assigneeModel: row.assignee_model,
      },
      agent: {
        adapterType: row.assignee_adapter_type,
        model: row.assignee_model,
      },
    }, db);
    for (const attempt of executionRouteAttempts(route)) {
      const runnerProvider = normalizeRunnerProvider(attempt.target.runtimeProvider);
      if (input.allowedRunnerProviders.has(runnerProvider)) continue;
      violations.push({
        taskKey: row.task_key,
        lane: route.laneId,
        executionEngine: route.executionEngine,
        runnerProvider,
        fallbackUsed: attempt.fallbackUsed,
        fallbackIndex: attempt.fallbackIndex,
      });
    }
  }
  return violations;
}

function readRunProviderViolations(
  db: ReturnType<typeof getOrchestrationDb>,
  input: { taskKeys: string[]; allowedRunnerProviders: Set<string>; startedAt: string },
): RuntimeRunProviderViolation[] {
  const rows = db
    .prepare(
      `SELECT
         t.task_key,
         er.id,
         er.provider,
         er.runner_provider,
         er.status,
         er.started_at,
         er.created_at
       FROM execution_runs er
       INNER JOIN tasks t ON t.id = er.task_id
       WHERE t.task_key IN (${placeholders(input.taskKeys.length)})
         AND COALESCE(er.started_at, er.created_at) >= ?
       ORDER BY COALESCE(er.started_at, er.created_at), er.id`,
    )
    .all(...input.taskKeys, input.startedAt) as Array<{
      task_key: string;
      id: string;
      provider: string;
      runner_provider: string | null;
      status: string;
      started_at: string | null;
      created_at: string | null;
    }>;

  return rows.flatMap((row) => {
    const provider = normalizeRunnerProvider(row.provider);
    const runnerProvider = normalizeRunnerProvider(row.runner_provider);
    const concreteRunnerProvider = provider === "symphony" ? runnerProvider : runnerProvider || provider;
    if (input.allowedRunnerProviders.has(concreteRunnerProvider)) return [];
    return [{
      taskKey: row.task_key,
      executionRunId: row.id,
      provider,
      runnerProvider: runnerProvider || null,
      concreteRunnerProvider,
      status: row.status,
      startedAt: row.started_at ?? row.created_at,
    }];
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertConfiguredDbMigrationCompatible(options.checkOnly ? "benchmark replay check-only" : "benchmark replay");

  const db = getOrchestrationDb();
  if (options.requireIsolatedWorkspace) {
    assertIsolatedWorkspace(db, options.taskKeys);
  }
  const allowedRunnerProviderSet = new Set(options.allowedRunnerProviders);
  if (options.checkOnly) {
    const statuses = readTaskStatuses(db, options.taskKeys);
    const routeProviderViolations = readRouteProviderViolations(db, {
      taskKeys: options.taskKeys,
      allowedRunnerProviders: allowedRunnerProviderSet,
    });
    const output = {
      schema: "hiverunner.runtime-benchmark-repeat-check.v1",
      goalKey: options.goalKey,
      checkedAt: new Date().toISOString(),
      taskKeys: options.taskKeys,
      allowedRunnerProviders: options.allowedRunnerProviders,
      routeProviderClean: routeProviderViolations.length === 0,
      routeProviderViolations,
      finalStatuses: statuses,
    };
    if (options.outPath) {
      fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
      fs.writeFileSync(options.outPath, `${JSON.stringify(output, null, 2)}\n`);
    }
    console.log(JSON.stringify(output, null, 2));
    if (routeProviderViolations.length > 0) {
      console.error(
        `[repeat] provider route violation: ${routeProviderViolations.length} disallowed route attempt(s): ${routeProviderViolations
          .map((violation) => `${violation.taskKey}:${violation.runnerProvider}`)
          .join(", ")}`,
      );
      process.exitCode = 2;
    }
    return;
  }

  const startedAt = new Date().toISOString();
  const fixtureProjectIds = readSelectedTaskProjectIds(db, options.taskKeys);
  const deadline = Date.now() + options.maxMinutes * 60_000;
  let tickCount = 0;
  let scopeViolation: ReplayScopeViolation | null = null;
  const tickResults: Array<{
    tickedAt: string;
    status: string;
    claimedCount: number;
    durationMs: number;
    staleRunsRecovered: number;
    staleExecutionRunsRecovered: number;
  }> = [];

  const routeViolations = readRouteProviderViolations(db, {
    taskKeys: options.taskKeys,
    allowedRunnerProviders: allowedRunnerProviderSet,
  });
  if (routeViolations.length > 0) {
    scopeViolation = {
      reason: "disallowed_route_provider",
      allowedRunnerProviders: options.allowedRunnerProviders,
      routeViolations,
    };
    console.error(
      `[repeat] provider route violation: ${routeViolations.length} disallowed route attempt(s): ${routeViolations
        .map((violation) => `${violation.taskKey}:${violation.runnerProvider}`)
        .join(", ")}`,
    );
  }

  while (Date.now() < deadline) {
    if (scopeViolation) break;
    const statuses = readTaskStatuses(db, options.taskKeys);
    if (statuses.length !== options.taskKeys.length) {
      const found = new Set(statuses.map((status) => status.task_key));
      const missing = options.taskKeys.filter((key) => !found.has(key));
      throw new Error(`Missing fixture task key(s): ${missing.join(", ")}`);
    }
    if (statuses.every((row) => TERMINAL_TASK_STATUSES.has(row.status))) {
      break;
    }

    const result = await tick(db);
    tickCount += 1;
    tickResults.push({
      tickedAt: result.tickedAt,
      status: result.status,
      claimedCount: result.claimedCount,
      durationMs: result.durationMs,
      staleRunsRecovered: result.staleRunsRecovered,
      staleExecutionRunsRecovered: result.staleExecutionRunsRecovered,
    });
    console.log(`[repeat] tick ${tickCount}: status=${result.status} claimed=${result.claimedCount} durationMs=${result.durationMs}`);

    if (!options.allowGeneratedTasks) {
      const generatedTasks = readGeneratedTasksInFixtureProjects(db, {
        projectIds: fixtureProjectIds,
        taskKeys: options.taskKeys,
        startedAt,
      });
      if (generatedTasks.length > 0) {
        scopeViolation = {
          reason: "fixture_generated_tasks",
          generatedTasks,
        };
        console.error(
          `[repeat] scope violation: ${generatedTasks.length} generated task(s): ${generatedTasks.map((task) => task.task_key).join(", ")}`,
        );
        break;
      }
    }

    const runViolations = readRunProviderViolations(db, {
      taskKeys: options.taskKeys,
      allowedRunnerProviders: allowedRunnerProviderSet,
      startedAt,
    });
    if (runViolations.length > 0) {
      scopeViolation = {
        reason: "disallowed_execution_run_provider",
        allowedRunnerProviders: options.allowedRunnerProviders,
        runViolations,
      };
      console.error(
        `[repeat] provider run violation: ${runViolations.length} disallowed execution run(s): ${runViolations
          .map((violation) => `${violation.taskKey}:${violation.concreteRunnerProvider}`)
          .join(", ")}`,
      );
      break;
    }

    if (result.claimedCount === 0) {
      await sleep(options.pollMs);
    }
  }

  const completedAt = new Date().toISOString();
  const finalStatuses = readTaskStatuses(db, options.taskKeys);
  const generatedTasks = readGeneratedTasksInFixtureProjects(db, {
    projectIds: fixtureProjectIds,
    taskKeys: options.taskKeys,
    startedAt,
  });
  if (!scopeViolation && !options.allowGeneratedTasks && generatedTasks.length > 0) {
    scopeViolation = {
      reason: "fixture_generated_tasks",
      generatedTasks,
    };
  }
  const terminal = finalStatuses.every((row) => TERMINAL_TASK_STATUSES.has(row.status));
  const output = {
    schema: "hiverunner.runtime-benchmark-repeat.v1",
    goalKey: options.goalKey,
    startedAt,
    completedAt,
    maxMinutes: options.maxMinutes,
    taskKeys: options.taskKeys,
    allowedRunnerProviders: options.allowedRunnerProviders,
    terminal: terminal && !scopeViolation,
    scopeClean: !scopeViolation,
    allowGeneratedTasks: options.allowGeneratedTasks,
    scopeViolation,
    generatedTasks,
    finalStatuses,
    tickCount,
    tickResults,
  };

  if (options.outPath) {
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    fs.writeFileSync(options.outPath, `${JSON.stringify(output, null, 2)}\n`);
  }
  console.log(JSON.stringify(output, null, 2));
  if (scopeViolation) {
    process.exitCode = 2;
  } else if (!terminal) {
    process.exitCode = 3;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
