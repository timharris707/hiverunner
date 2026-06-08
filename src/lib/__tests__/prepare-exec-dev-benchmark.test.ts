/**
 * Focused tests for execution-dev benchmark fixture preparation.
 * Run:
 * node ./scripts/run-ts-test.mjs src/lib/__tests__/prepare-exec-dev-benchmark.test.ts
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

type BenchmarkReplayMetadata = {
  commandPath?: string;
  workspaceRoot?: string;
  nested?: {
    sourceLogPath?: string;
  };
  health?: {
    command?: string | null;
    commandPath?: string | null;
    workspaceRoot?: string | null;
  };
  hiverunnerBenchmarkReplay: {
    bundledRunnerScriptRoot: string;
    bundledRunnerCommands: Record<string, string>;
  };
};

type ProjectSettings = {
  sourceWorkspaceRoot?: string;
  workspace?: {
    sourceRoot?: string;
  };
};

type BenchmarkManifest = {
  protocol: {
    workspaceRewrite: {
      agentRuntimeBenchmarkReplayMetadataRowsUpdated: number;
      agentRuntimeCommandRowsUpdated: number;
      agentRuntimeMetadataRowsUpdated: number;
      projectSettingsRowsUpdated: number;
      companySettingsRowsUpdated: number;
      previousSourceWorkspaceRoots: string[];
      previousCompanyWorkspaceRoots: string[];
    };
  };
};

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function createSourceDb(dbPath: string, oldAppRoot: string, oldCompanyRoot: string) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sprints (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      goal_key TEXT,
      name TEXT,
      status TEXT
    );
    CREATE TABLE companies (
      id TEXT PRIMARY KEY,
      workspace_root TEXT,
      workspace_source TEXT,
      settings_json TEXT,
      updated_at TEXT
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      settings_json TEXT,
      updated_at TEXT
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      sprint_id TEXT,
      project_id TEXT,
      task_key TEXT,
      status TEXT,
      started_at TEXT,
      completed_at TEXT,
      execution_session_id TEXT,
      consecutive_noop_wakes INTEGER DEFAULT 0,
      blocked_reason TEXT,
      updated_at TEXT
    );
    CREATE TABLE agent_runtimes (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      provider TEXT,
      command TEXT,
      metadata_json TEXT,
      workspace_root TEXT,
      updated_at TEXT
    );
  `);

  db.prepare("INSERT INTO sprints (id, parent_id, goal_key, name, status) VALUES (?, ?, ?, ?, ?)")
    .run("goal", null, "INS-G006", "Runtime benchmark", "active");
  db.prepare("INSERT INTO sprints (id, parent_id, goal_key, name, status) VALUES (?, ?, ?, ?, ?)")
    .run("sprint", "goal", null, "Fixture sprint", "active");
  db.prepare("INSERT INTO companies (id, workspace_root, workspace_source, settings_json, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(
      "company",
      oldCompanyRoot,
      "manual",
      JSON.stringify({
        workspace: {
          notesRoot: path.join(oldCompanyRoot, "notes"),
        },
      }),
      "2026-01-01T00:00:00.000Z",
    );
  db.prepare("INSERT INTO projects (id, company_id, settings_json, updated_at) VALUES (?, ?, ?, ?)")
    .run(
      "project",
      "company",
      JSON.stringify({
        sourceWorkspaceRoot: path.join(oldAppRoot, ".stable"),
        workspace: { sourceRoot: path.join(oldAppRoot, ".stable") },
      }),
      "2026-01-01T00:00:00.000Z",
    );
  db.prepare("INSERT INTO tasks (id, sprint_id, project_id, task_key, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("task-1", "sprint", "project", "INS-1", "in_progress", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO tasks (id, sprint_id, project_id, task_key, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("task-2", "sprint", "project", "INS-2", "in_progress", "2026-01-01T00:00:00.000Z");

  const oldSymphonyRunner = path.join(oldAppRoot, ".stable", "scripts", "hiverunner-symphony-runner.mjs");
  db.prepare(
    "INSERT INTO agent_runtimes (id, company_id, provider, command, metadata_json, workspace_root, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "runtime-symphony-codex",
    "company",
    "symphony",
    oldSymphonyRunner,
    JSON.stringify({
      commandPath: oldSymphonyRunner,
      workspaceRoot: oldCompanyRoot,
      nested: {
        sourceLogPath: path.join(oldAppRoot, ".stable", "scratch", "runner.log"),
      },
      health: {
        command: oldSymphonyRunner,
        commandPath: oldSymphonyRunner,
        workspaceRoot: oldCompanyRoot,
      },
    }),
    oldCompanyRoot,
    "2026-01-01T00:00:00.000Z",
  );
  db.prepare(
    "INSERT INTO agent_runtimes (id, company_id, provider, command, metadata_json, workspace_root, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "runtime-local-symphony",
    "company",
    "symphony",
    null,
    JSON.stringify({
      bundledRunner: true,
      health: {
        command: null,
        commandPath: null,
        workspaceRoot: oldCompanyRoot,
      },
    }),
    oldCompanyRoot,
    "2026-01-01T00:00:00.000Z",
  );
  db.prepare(
    "INSERT INTO agent_runtimes (id, company_id, provider, command, metadata_json, workspace_root, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "runtime-legacy-claude-wrapper",
    "company",
    "anthropic",
    path.join(oldAppRoot, "scripts", "hiverunner-claude-runner.mjs"),
    JSON.stringify({ health: { workspaceRoot: oldCompanyRoot } }),
    oldCompanyRoot,
    "2026-01-01T00:00:00.000Z",
  );

  db.close();
}

function markMigrationIncompatible(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        checksum    TEXT NOT NULL,
        applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
    db.prepare("INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)")
      .run(999, "future_bundle_only_migration", "future-checksum");
  } finally {
    db.close();
  }
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
}

function readRuntime(db: Database.Database, id: string) {
  return db
    .prepare("SELECT command, metadata_json, workspace_root FROM agent_runtimes WHERE id = ?")
    .get(id) as { command: string | null; metadata_json: string | null; workspace_root: string | null };
}

async function run() {
  console.log("\nPrepare Exec-Dev Benchmark Tests\n");

  await test("prepare stamps candidate bundled runner commands for replay defaults", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-exec-dev-benchmark-"));
    try {
      const sourceDbPath = path.join(tempRoot, "source.db");
      const targetDbPath = path.join(tempRoot, "target", "orchestration.db");
      const manifestPath = path.join(tempRoot, "target", "benchmark-manifest.json");
      const oldAppRoot = path.join(tempRoot, "main-app");
      const oldCompanyRoot = path.join(tempRoot, "stable-company-workspace");
      const candidateRoot = path.join(tempRoot, "candidate-source");
      const candidateCompanyRoot = path.join(tempRoot, "candidate-company-workspace");
      fs.mkdirSync(path.join(candidateRoot, "scripts"), { recursive: true });
      createSourceDb(sourceDbPath, oldAppRoot, oldCompanyRoot);

      const result = spawnSync(process.execPath, [
        "./scripts/run-tsx.mjs",
        "scripts/prepare-exec-dev-benchmark.ts",
        "--source-db",
        sourceDbPath,
        "--target-db",
        targetDbPath,
        "--manifest",
        manifestPath,
        "--goal",
        "INS-G006",
        "--expected-tasks",
        "2",
        "--required-repeats",
        "1",
        "--source-workspace-root",
        candidateRoot,
        "--company-workspace-root",
        candidateCompanyRoot,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const target = new Database(targetDbPath, { readonly: true, fileMustExist: true });
      try {
        const localSymphony = readRuntime(target, "runtime-local-symphony");
        assert.equal(localSymphony.command, null);
        const localMetadata = parseJson<BenchmarkReplayMetadata>(localSymphony.metadata_json ?? "{}");
        const replay = localMetadata.hiverunnerBenchmarkReplay;
        assert.equal(replay.bundledRunnerScriptRoot, candidateRoot);
        assert.deepEqual(replay.bundledRunnerCommands, {
          anthropic: path.join(candidateRoot, "scripts", "hiverunner-claude-runner.mjs"),
          gemini: path.join(candidateRoot, "scripts", "hiverunner-gemini-runner.mjs"),
          hermes: path.join(candidateRoot, "scripts", "hiverunner-hermes-runner.mjs"),
          openclaw: path.join(candidateRoot, "scripts", "hiverunner-openclaw-runner.mjs"),
          codex: path.join(candidateRoot, "scripts", "hiverunner-symphony-runner.mjs"),
        });

        const codexRuntime = readRuntime(target, "runtime-symphony-codex");
        const candidateSymphonyRunner = path.join(candidateRoot, "scripts", "hiverunner-symphony-runner.mjs");
        assert.equal(codexRuntime.command, candidateSymphonyRunner);
        const codexMetadata = parseJson<BenchmarkReplayMetadata>(codexRuntime.metadata_json ?? "{}");
        assert.equal(codexMetadata.commandPath, candidateSymphonyRunner);
        assert.equal(codexMetadata.workspaceRoot, candidateCompanyRoot);
        assert.equal(codexMetadata.nested?.sourceLogPath, path.join(candidateRoot, "scratch", "runner.log"));
        assert.equal(codexMetadata.health.command, candidateSymphonyRunner);
        assert.equal(codexMetadata.health.commandPath, candidateSymphonyRunner);
        assert.equal(codexMetadata.health.workspaceRoot, candidateCompanyRoot);
        assert.equal(
          codexMetadata.hiverunnerBenchmarkReplay.bundledRunnerCommands.anthropic,
          path.join(candidateRoot, "scripts", "hiverunner-claude-runner.mjs"),
        );

        const legacyClaude = readRuntime(target, "runtime-legacy-claude-wrapper");
        assert.equal(legacyClaude.command, path.join(candidateRoot, "scripts", "hiverunner-claude-runner.mjs"));

        const project = target
          .prepare("SELECT settings_json FROM projects WHERE id = 'project'")
          .get() as { settings_json: string };
        const projectSettings = parseJson<ProjectSettings>(project.settings_json);
        assert.equal(projectSettings.workspace?.sourceRoot, candidateRoot);
        assert.equal(projectSettings.sourceWorkspaceRoot, candidateRoot);

        const company = target
          .prepare("SELECT workspace_root, settings_json FROM companies WHERE id = 'company'")
          .get() as { workspace_root: string; settings_json: string };
        assert.equal(company.workspace_root, candidateCompanyRoot);
        assert.equal(
          parseJson<{ workspace: { notesRoot: string } }>(company.settings_json).workspace.notesRoot,
          path.join(candidateCompanyRoot, "notes"),
        );

        const manifest = parseJson<BenchmarkManifest>(fs.readFileSync(manifestPath, "utf8"));
        assert.equal(manifest.protocol.workspaceRewrite.agentRuntimeBenchmarkReplayMetadataRowsUpdated, 2);
        assert.equal(manifest.protocol.workspaceRewrite.agentRuntimeCommandRowsUpdated, 2);
        assert.equal(manifest.protocol.workspaceRewrite.agentRuntimeMetadataRowsUpdated, 3);
        assert.equal(manifest.protocol.workspaceRewrite.projectSettingsRowsUpdated, 1);
        assert.equal(manifest.protocol.workspaceRewrite.companySettingsRowsUpdated, 1);
        assert.deepEqual(manifest.protocol.workspaceRewrite.previousSourceWorkspaceRoots, [
          path.join(oldAppRoot, ".stable"),
        ]);
        assert.deepEqual(manifest.protocol.workspaceRewrite.previousCompanyWorkspaceRoots, [oldCompanyRoot]);

        const rowJson = JSON.stringify({
          project: project.settings_json,
          company: company.settings_json,
          runtime: target.prepare("SELECT json_group_array(json_object('command', command, 'workspaceRoot', workspace_root, 'metadata', metadata_json)) AS json FROM agent_runtimes")
            .get() as { json: string },
        });
        assert.equal(rowJson.includes(oldCompanyRoot), false, "old company root should not remain in rewritten runtime/config rows");
        assert.equal(rowJson.includes(path.join(oldAppRoot, ".stable")), false, "old source root should not remain in rewritten runtime/config rows");
      } finally {
        target.close();
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  await test("prepare refuses migration-incompatible source DB before touching target", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-exec-dev-benchmark-"));
    try {
      const sourceDbPath = path.join(tempRoot, "source.db");
      const targetDbPath = path.join(tempRoot, "target", "orchestration.db");
      const manifestPath = path.join(tempRoot, "target", "benchmark-manifest.json");
      createSourceDb(sourceDbPath, path.join(tempRoot, "main-app"), path.join(tempRoot, "company-workspace"));
      markMigrationIncompatible(sourceDbPath);

      fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
      fs.writeFileSync(targetDbPath, "sentinel-target", "utf8");

      const result = spawnSync(process.execPath, [
        "./scripts/run-tsx.mjs",
        "scripts/prepare-exec-dev-benchmark.ts",
        "--source-db",
        sourceDbPath,
        "--target-db",
        targetDbPath,
        "--manifest",
        manifestPath,
        "--goal",
        "INS-G006",
        "--expected-tasks",
        "2",
        "--required-repeats",
        "1",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /migration-incompatible source DB/);
      assert.match(result.stderr, /future_migration/);
      assert.equal(fs.readFileSync(targetDbPath, "utf8"), "sentinel-target");
      assert.equal(fs.existsSync(manifestPath), false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  await test("repeat check-only refuses migration-incompatible DB before opening writable runtime DB", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-benchmark-repeat-"));
    try {
      const dbPath = path.join(tempRoot, "orchestration.db");
      markMigrationIncompatible(dbPath);

      const result = spawnSync(process.execPath, [
        "./scripts/run-tsx.mjs",
        "scripts/runtime-benchmark-repeat.ts",
        "--task-key",
        "INS-1",
        "--check-only",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ORCHESTRATION_DB_PATH: dbPath,
        },
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /migration-incompatible orchestration DB/);
      assert.match(result.stderr, /future_migration/);

      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        assert.equal(tableExists(db, "tasks"), false);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
