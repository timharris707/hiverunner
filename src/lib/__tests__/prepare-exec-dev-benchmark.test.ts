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
  health?: {
    command?: string | null;
    commandPath?: string | null;
  };
  hiverunnerBenchmarkReplay: {
    bundledRunnerScriptRoot: string;
    bundledRunnerCommands: Record<string, string>;
  };
};

type ProjectSettings = {
  workspace?: {
    sourceRoot?: string;
  };
};

type BenchmarkManifest = {
  protocol: {
    workspaceRewrite: {
      agentRuntimeBenchmarkReplayMetadataRowsUpdated: number;
      agentRuntimeCommandRowsUpdated: number;
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
  db.prepare("INSERT INTO companies (id, workspace_root, workspace_source, updated_at) VALUES (?, ?, ?, ?)")
    .run("company", oldCompanyRoot, "manual", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO projects (id, company_id, settings_json, updated_at) VALUES (?, ?, ?, ?)")
    .run("project", "company", JSON.stringify({ workspace: { sourceRoot: path.join(oldAppRoot, ".stable") } }), "2026-01-01T00:00:00.000Z");
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
      health: {
        command: oldSymphonyRunner,
        commandPath: oldSymphonyRunner,
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
    "{}",
    oldCompanyRoot,
    "2026-01-01T00:00:00.000Z",
  );

  db.close();
}

function readRuntime(db: Database.Database, id: string) {
  return db
    .prepare("SELECT command, metadata_json FROM agent_runtimes WHERE id = ?")
    .get(id) as { command: string | null; metadata_json: string | null };
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
        assert.equal(codexMetadata.health.command, candidateSymphonyRunner);
        assert.equal(codexMetadata.health.commandPath, candidateSymphonyRunner);
        assert.equal(
          codexMetadata.hiverunnerBenchmarkReplay.bundledRunnerCommands.anthropic,
          path.join(candidateRoot, "scripts", "hiverunner-claude-runner.mjs"),
        );

        const legacyClaude = readRuntime(target, "runtime-legacy-claude-wrapper");
        assert.equal(legacyClaude.command, path.join(candidateRoot, "scripts", "hiverunner-claude-runner.mjs"));

        const project = target
          .prepare("SELECT settings_json FROM projects WHERE id = 'project'")
          .get() as { settings_json: string };
        assert.equal(parseJson<ProjectSettings>(project.settings_json).workspace?.sourceRoot, candidateRoot);

        const manifest = parseJson<BenchmarkManifest>(fs.readFileSync(manifestPath, "utf8"));
        assert.equal(manifest.protocol.workspaceRewrite.agentRuntimeBenchmarkReplayMetadataRowsUpdated, 2);
        assert.equal(manifest.protocol.workspaceRewrite.agentRuntimeCommandRowsUpdated, 2);
      } finally {
        target.close();
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
