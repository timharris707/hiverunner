import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

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
};

function usage(): never {
  console.error([
    "Usage: node ./scripts/run-tsx.mjs scripts/prepare-exec-dev-benchmark.ts [--source-db data/orchestration.db] [--target-db data-exec-dev/orchestration.db] [--goal INS-G006]",
    "       [--fixture-id ins-g006-runtime-replay-v1] [--expected-tasks 10] [--required-repeats 3]",
    "       [--task-key INS-205] [--task-keys INS-205,INS-208,...] [--reset-selected-tasks-to to-do|none]",
    "       [--source-workspace-root /path/to/source-worktree] [--company-workspace-root /path/to/company-workspace]",
  ].join("\n"));
  process.exit(1);
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
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage();
    }
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
  companyIds: string[];
  projectIds: string[];
  agentRuntimeRowsUpdated: number;
} {
  if (!input.sourceWorkspaceRoot && !input.companyWorkspaceRoot) {
    return {
      sourceWorkspaceRoot: null,
      companyWorkspaceRoot: null,
      companyIds: [],
      projectIds: [],
      agentRuntimeRowsUpdated: 0,
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
  if (input.sourceWorkspaceRoot) {
    for (const row of projectRows) {
      let settings: Record<string, unknown>;
      try {
        settings = JSON.parse(row.settings_json ?? "{}") as Record<string, unknown>;
      } catch {
        settings = {};
      }
      const workspace = typeof settings.workspace === "object" && settings.workspace && !Array.isArray(settings.workspace)
        ? { ...(settings.workspace as Record<string, unknown>) }
        : {};
      workspace.sourceRoot = input.sourceWorkspaceRoot;
      settings.workspace = workspace;
      db.prepare("UPDATE projects SET settings_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(settings), now, row.project_id);
    }
  }

  let agentRuntimeRowsUpdated = 0;
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

  return {
    sourceWorkspaceRoot: input.sourceWorkspaceRoot,
    companyWorkspaceRoot: input.companyWorkspaceRoot,
    companyIds,
    projectIds,
    agentRuntimeRowsUpdated,
  };
}

function replaySummaryCommands(input: {
  dbPath: string;
  goalKey: string;
  fixtureId: string;
  requiredRepeats: number;
  expectedTaskCount: number;
  taskKeys: string[];
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

  fs.mkdirSync(path.dirname(options.targetDbPath), { recursive: true });

  const source = new Database(options.sourceDbPath, { readonly: true, fileMustExist: true });
  try {
    source.pragma("query_only = ON");
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

    const copied = new Database(options.targetDbPath, { readonly: true, fileMustExist: true });
    try {
      copied.pragma("query_only = ON");
      const copiedGoal = copied.prepare("SELECT id FROM sprints WHERE goal_key = ? LIMIT 1").get(options.goalKey);
      if (!copiedGoal) {
        throw new Error(`Copied DB is missing goal ${options.goalKey}.`);
      }
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
        report: "Run each arm against the same frozen fixture DB in an isolated execution-dev lane, then pass all repeat summary JSON files to scripts/runtime-promotion-gate.ts.",
        summaryCommands: replaySummaryCommands({
          dbPath: path.resolve(options.targetDbPath),
          goalKey: options.goalKey,
          fixtureId: options.fixtureId,
          requiredRepeats: options.requiredRepeats,
          expectedTaskCount: options.expectedTaskCount,
          taskKeys,
        }),
      },
      notes: [
        "Copied with better-sqlite3 backup from a readonly/query_only source handle.",
        "Target is intended for an execution-dev lane only, not stable 3001 or observer-only 3010.",
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
