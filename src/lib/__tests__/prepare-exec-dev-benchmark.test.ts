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
  requestedRuntimeProvider?: string;
  selectedRuntimeDisplayName?: string;
  model?: string;
  workspaceRoot?: string;
  nested?: {
    sourceLogPath?: string;
  };
  hiverunnerSymphony?: {
    sandbox?: string;
    approvalPolicy?: string;
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
    allowedRunnerProviders?: string[];
    routeSanitization?: {
      allowedRunnerProviders: string[];
      preferredRunnerProvider: string;
      hivesUpdated: number;
      primaryRoutesRewritten: number;
      fallbacksDropped: number;
      agentsUpdated: number;
      agentModelsCleared: number;
      runtimeRowsUpdated: number;
      runtimeRowsDeleted: number;
    } | null;
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

function createSourceDb(
  dbPath: string,
  oldAppRoot: string,
  oldCompanyRoot: string,
  options: { sourceWorkspaceRoot?: string } = {},
) {
  const db = new Database(dbPath);
  const sourceWorkspaceRoot = options.sourceWorkspaceRoot ?? path.join(oldAppRoot, ".stable");
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
        company_id TEXT,
        task_key TEXT,
        status TEXT,
        assignee_agent_id TEXT,
        assigned_at TEXT,
        eligible_assignee_ids TEXT,
        execution_engine TEXT,
        model_lane TEXT,
        started_at TEXT,
        completed_at TEXT,
        execution_session_id TEXT,
        consecutive_noop_wakes INTEGER DEFAULT 0,
        blocked_reason TEXT,
        updated_at TEXT
      );
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        name TEXT,
        adapter_type TEXT,
        model TEXT,
        status TEXT,
        current_task_id TEXT,
        updated_at TEXT
      );
      CREATE TABLE agent_wakeup_requests (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        company_id TEXT,
        source TEXT NOT NULL DEFAULT 'api',
        reason TEXT,
        trigger_detail TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL CHECK (status IN ('queued','claimed','finished','failed')),
        coalesced_count INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT,
        run_id TEXT,
        requested_at TEXT,
        claimed_at TEXT,
        finished_at TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE UNIQUE INDEX idx_wakeup_requests_idempotency
        ON agent_wakeup_requests(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE TABLE heartbeat_runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        company_id TEXT,
        invocation_source TEXT NOT NULL DEFAULT 'wakeup_request',
        trigger_detail TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','timed_out')),
        started_at TEXT,
        finished_at TEXT,
        wakeup_request_id TEXT,
        usage_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        exit_code INTEGER,
        error TEXT,
        context_snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','revision_requested','approved','rejected','cancelled')),
        requested_by_agent_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        decision_note TEXT,
        decided_by_user_id TEXT,
        decided_at TEXT,
        linked_task_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE execution_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        agent_id TEXT,
        provider TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        token_usage_json TEXT NOT NULL DEFAULT '{}',
        duration_ms INTEGER,
        idempotency_key TEXT,
        process_pid INTEGER,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE UNIQUE INDEX idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE TABLE agent_task_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        company_id TEXT,
        adapter_type TEXT,
        task_key TEXT,
        session_params_json TEXT NOT NULL DEFAULT '{}',
        session_display_id TEXT,
        last_run_id TEXT,
        last_error TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE agent_runtimes (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        agent_id TEXT,
        provider TEXT,
        runtime_slug TEXT,
        display_name TEXT,
        command TEXT,
        status TEXT,
        metadata_json TEXT,
        workspace_root TEXT,
        updated_at TEXT
      );
      CREATE TABLE company_execution_hives (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        slug TEXT,
        name TEXT,
        lanes_json TEXT,
        is_active INTEGER,
        archived_at TEXT,
        updated_at TEXT
      );
    `);

  db.prepare("INSERT INTO sprints (id, parent_id, goal_key, name, status) VALUES (?, ?, ?, ?, ?)")
    .run("goal", null, "GOAL-BENCH-1", "Runtime benchmark", "active");
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
        sourceWorkspaceRoot,
        workspace: { sourceRoot: sourceWorkspaceRoot },
      }),
      "2026-01-01T00:00:00.000Z",
    );
    db.prepare("INSERT INTO agents (id, company_id, name, adapter_type, model, status, current_task_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("agent-gemini", "company", "Flash", "gemini", "gemini-3.5-flash", "idle", null, "2026-01-01T00:00:00.000Z");
    db.prepare("INSERT INTO agents (id, company_id, name, adapter_type, model, status, current_task_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("agent-codex", "company", "Gator", "codex", "gpt-5.5", "idle", null, "2026-01-01T00:00:00.000Z");
    db.prepare("INSERT INTO tasks (id, sprint_id, project_id, company_id, task_key, status, assignee_agent_id, execution_engine, model_lane, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("task-1", "sprint", "project", "company", "INS-1", "in_progress", "agent-gemini", "symphony", "default", "2026-01-01T00:00:00.000Z");
    db.prepare("INSERT INTO tasks (id, sprint_id, project_id, company_id, task_key, status, assignee_agent_id, execution_engine, model_lane, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("task-2", "sprint", "project", "company", "INS-2", "in_progress", "agent-gemini", "symphony", "deep", "2026-01-01T00:00:00.000Z");
    db.prepare("INSERT INTO company_execution_hives (id, company_id, slug, name, lanes_json, is_active, archived_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        "hive",
        "company",
        "benchmark",
        "Benchmark Hive",
        JSON.stringify([
          {
            id: "default",
            label: "Default",
            description: "Default benchmark lane",
            useFor: [],
            primary: { mode: "runtime_managed", runtimeId: "gemini", runtimeLabel: "Gemini CLI" },
            fallbacks: [
              { mode: "runtime_managed", runtimeId: "codex", runtimeLabel: "Codex" },
              { mode: "runtime_managed", runtimeId: "gemini", runtimeLabel: "Gemini CLI" },
            ],
            approvalPolicy: { mode: "none", label: "No approval" },
            verificationStatus: "untested",
            verificationNote: "",
          },
          {
            id: "deep",
            label: "Deep",
            description: "Deep benchmark lane",
            useFor: [],
            primary: { mode: "runtime_managed", runtimeId: "anthropic", runtimeLabel: "Claude Code" },
            fallbacks: [
              { mode: "runtime_managed", runtimeId: "gemini", runtimeLabel: "Gemini CLI" },
            ],
            approvalPolicy: { mode: "none", label: "No approval" },
            verificationStatus: "untested",
            verificationNote: "",
          },
        ]),
        1,
        null,
        "2026-01-01T00:00:00.000Z",
      );

    const oldSymphonyRunner = path.join(oldAppRoot, ".stable", "scripts", "hiverunner-symphony-runner.mjs");
    db.prepare(
      "INSERT INTO agent_runtimes (id, company_id, agent_id, provider, runtime_slug, display_name, command, status, metadata_json, workspace_root, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "runtime-symphony-codex",
      "company",
      null,
      "symphony",
      "symphony-codex",
      "Symphony Codex",
      oldSymphonyRunner,
      "online",
      JSON.stringify({
      commandPath: oldSymphonyRunner,
      requestedRuntimeProvider: "codex",
      selectedRuntimeDisplayName: "codex runtime",
      model: "openai-codex/gpt-5.5",
      workspaceRoot: oldCompanyRoot,
      nested: {
        sourceLogPath: path.join(oldAppRoot, ".stable", "scratch", "runner.log"),
      },
      hiverunnerSymphony: {
        sandbox: "danger-full-access",
        approvalPolicy: "never",
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
      "INSERT INTO agent_runtimes (id, company_id, agent_id, provider, runtime_slug, display_name, command, status, metadata_json, workspace_root, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "runtime-local-symphony",
      "company",
      null,
      "symphony",
      "local-symphony",
      "Local Symphony",
      null,
      "online",
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
      "INSERT INTO agent_runtimes (id, company_id, agent_id, provider, runtime_slug, display_name, command, status, metadata_json, workspace_root, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "runtime-legacy-claude-wrapper",
      "company",
      null,
      "anthropic",
      "legacy-claude-wrapper",
      "Claude Wrapper",
      path.join(oldAppRoot, "scripts", "hiverunner-claude-runner.mjs"),
      "online",
      JSON.stringify({ health: { workspaceRoot: oldCompanyRoot } }),
      oldCompanyRoot,
      "2026-01-01T00:00:00.000Z",
    );
    db.prepare(
      "INSERT INTO agent_runtimes (id, company_id, agent_id, provider, runtime_slug, display_name, command, status, metadata_json, workspace_root, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "runtime-agent-gemini",
      "company",
      "agent-gemini",
      "gemini",
      "flash-runtime",
      "Gemini Flash",
      path.join(oldAppRoot, "scripts", "hiverunner-gemini-runner.mjs"),
      "online",
      JSON.stringify({ requestedRuntimeProvider: "gemini", model: "gemini-3.5-flash" }),
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
        "GOAL-BENCH-1",
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
        assert.equal(codexMetadata.requestedRuntimeProvider, "codex");
        assert.equal(codexMetadata.selectedRuntimeDisplayName, "codex runtime");
        assert.equal(codexMetadata.model, "openai-codex/gpt-5.5");
        assert.equal(codexMetadata.hiverunnerSymphony?.sandbox, "danger-full-access");
        assert.equal(codexMetadata.hiverunnerSymphony?.approvalPolicy, "never");
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
        assert.equal(manifest.protocol.workspaceRewrite.agentRuntimeCommandRowsUpdated, 3);
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

  await test("prepare does not rewrite non-path runtime metadata strings", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-exec-dev-benchmark-"));
    try {
      const sourceDbPath = path.join(tempRoot, "source.db");
      const targetDbPath = path.join(tempRoot, "target", "orchestration.db");
      const manifestPath = path.join(tempRoot, "target", "benchmark-manifest.json");
      const oldAppRoot = process.cwd();
      const oldCompanyRoot = path.join(tempRoot, "stable-company-workspace");
      const candidateRoot = path.join(tempRoot, "candidate-source");
      const candidateCompanyRoot = path.join(tempRoot, "candidate-company-workspace");
      fs.mkdirSync(path.join(candidateRoot, "scripts"), { recursive: true });
      createSourceDb(sourceDbPath, oldAppRoot, oldCompanyRoot, { sourceWorkspaceRoot: oldAppRoot });

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
        "GOAL-BENCH-1",
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
        const codexRuntime = readRuntime(target, "runtime-symphony-codex");
        const codexMetadata = parseJson<BenchmarkReplayMetadata>(codexRuntime.metadata_json ?? "{}");
        assert.equal(codexMetadata.commandPath, path.join(candidateRoot, "scripts", "hiverunner-symphony-runner.mjs"));
        assert.equal(codexMetadata.requestedRuntimeProvider, "codex");
        assert.equal(codexMetadata.selectedRuntimeDisplayName, "codex runtime");
        assert.equal(codexMetadata.model, "openai-codex/gpt-5.5");
        assert.equal(codexMetadata.hiverunnerSymphony?.sandbox, "danger-full-access");
        assert.equal(codexMetadata.hiverunnerSymphony?.approvalPolicy, "never");
      } finally {
        target.close();
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  await test("prepare can sanitize fixture-company benchmark routes to allowed runner providers", () => {
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
        "GOAL-BENCH-1",
        "--expected-tasks",
        "2",
        "--required-repeats",
        "1",
        "--source-workspace-root",
        candidateRoot,
        "--company-workspace-root",
        candidateCompanyRoot,
        "--sanitize-runner-routes",
        "--allowed-runner-providers",
        "codex,anthropic",
        "--preferred-runner-provider",
        "codex",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const target = new Database(targetDbPath, { readonly: true, fileMustExist: true });
      try {
        const agent = target
          .prepare("SELECT adapter_type, model FROM agents WHERE id = 'agent-gemini'")
          .get() as { adapter_type: string; model: string | null };
        assert.equal(agent.adapter_type, "codex");
        assert.equal(agent.model, null);

        const runtime = target
          .prepare("SELECT provider, command, status, metadata_json, workspace_root FROM agent_runtimes WHERE id = 'runtime-agent-gemini'")
          .get() as { provider: string; command: string | null; status: string; metadata_json: string; workspace_root: string };
        const candidateCodexRunner = path.join(candidateRoot, "scripts", "hiverunner-symphony-runner.mjs");
        assert.equal(runtime.provider, "codex");
        assert.equal(runtime.command, candidateCodexRunner);
        assert.equal(runtime.status, "online");
        assert.equal(runtime.workspace_root, candidateCompanyRoot);
        const metadata = parseJson<{
          requestedRuntimeProvider: string;
          selectedRuntimeDisplayName: string;
          model?: string;
          commandPath: string;
          health: { commandPath: string; workspaceRoot: string };
        }>(runtime.metadata_json);
        assert.equal(metadata.requestedRuntimeProvider, "codex");
        assert.equal(metadata.selectedRuntimeDisplayName, "Codex");
        assert.equal(metadata.model, undefined);
        assert.equal(metadata.commandPath, candidateCodexRunner);
        assert.equal(metadata.health.commandPath, candidateCodexRunner);
        assert.equal(metadata.health.workspaceRoot, candidateCompanyRoot);

        const symphonyRuntime = target
          .prepare("SELECT provider, command, status, workspace_root FROM agent_runtimes WHERE id = 'runtime-symphony-codex'")
          .get() as { provider: string; command: string | null; status: string; workspace_root: string };
        assert.equal(symphonyRuntime.provider, "codex");
        assert.equal(symphonyRuntime.command, candidateCodexRunner);
        assert.equal(symphonyRuntime.status, "online");
        assert.equal(symphonyRuntime.workspace_root, candidateCompanyRoot);

        const disallowedRuntimeRows = target
          .prepare("SELECT id, provider FROM agent_runtimes WHERE company_id = 'company' AND provider NOT IN ('codex', 'anthropic') ORDER BY id")
          .all() as Array<{ id: string; provider: string }>;
        assert.deepEqual(disallowedRuntimeRows, []);

        const hive = target
          .prepare("SELECT lanes_json FROM company_execution_hives WHERE id = 'hive'")
          .get() as { lanes_json: string };
        const lanes = parseJson<Array<{ primary: { runtimeId: string }; fallbacks: Array<{ runtimeId: string }> }>>(hive.lanes_json);
        assert.equal(lanes[0]?.primary.runtimeId, "codex");
        assert.deepEqual(lanes[0]?.fallbacks.map((fallback) => fallback.runtimeId), ["codex"]);
        assert.equal(lanes[1]?.primary.runtimeId, "anthropic");
        assert.deepEqual(lanes[1]?.fallbacks, []);

        const manifest = parseJson<BenchmarkManifest>(fs.readFileSync(manifestPath, "utf8"));
        assert.deepEqual(manifest.protocol.allowedRunnerProviders, ["anthropic", "codex"]);
        assert.equal(manifest.protocol.routeSanitization?.preferredRunnerProvider, "codex");
        assert.equal(manifest.protocol.routeSanitization?.hivesUpdated, 1);
        assert.equal(manifest.protocol.routeSanitization?.primaryRoutesRewritten, 1);
        assert.equal(manifest.protocol.routeSanitization?.fallbacksDropped, 2);
        assert.equal(manifest.protocol.routeSanitization?.agentsUpdated, 1);
        assert.equal(manifest.protocol.routeSanitization?.agentModelsCleared, 1);
        assert.equal(manifest.protocol.routeSanitization?.runtimeRowsUpdated, 3);
      } finally {
        target.close();
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  await test("reset selected benchmark tasks clears copied runtime backoff state", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-exec-dev-benchmark-"));
    try {
      const sourceDbPath = path.join(tempRoot, "source.db");
      const targetDbPath = path.join(tempRoot, "target", "orchestration.db");
      const manifestPath = path.join(tempRoot, "target", "benchmark-manifest.json");
      createSourceDb(sourceDbPath, path.join(tempRoot, "main-app"), path.join(tempRoot, "company-workspace"));

      const source = new Database(sourceDbPath);
      try {
        source
          .prepare(
            `UPDATE tasks
                SET status = 'in_progress',
                    started_at = '2026-01-01T00:00:00.000Z',
                    completed_at = '2026-01-01T00:05:00.000Z',
                    execution_session_id = 'stale-session',
                    consecutive_noop_wakes = 2,
                    blocked_reason = 'stale-blocker'
              WHERE id = 'task-1'`,
          )
          .run();
        source
          .prepare("UPDATE agents SET current_task_id = 'task-1' WHERE id = 'agent-gemini'")
          .run();
        source
          .prepare(
            `INSERT INTO agent_wakeup_requests
               (id, agent_id, company_id, source, reason, payload_json, status, idempotency_key, run_id, requested_at, created_at, updated_at)
             VALUES (?, ?, ?, 'api', ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "wake-selected",
            "agent-gemini",
            "company",
            "sweep_open_task",
            JSON.stringify({ taskId: "task-1" }),
            "queued",
            "sweep:task-1:to-do",
            "heartbeat-selected",
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
          );
        source
          .prepare(
            `INSERT INTO heartbeat_runs
               (id, agent_id, company_id, invocation_source, status, started_at, finished_at, wakeup_request_id, error, context_snapshot_json, created_at, updated_at)
             VALUES (?, ?, ?, 'wakeup_request', ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "heartbeat-selected",
            "agent-gemini",
            "company",
            "failed",
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:10.000Z",
            "wake-selected",
            "External runner command exited with code 127: env: node: No such file or directory",
            JSON.stringify({ taskId: "task-1" }),
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:10.000Z",
          );
        source
          .prepare(
            `INSERT INTO heartbeat_runs
               (id, agent_id, company_id, invocation_source, status, started_at, finished_at, error, context_snapshot_json, created_at, updated_at)
             VALUES (?, ?, ?, 'wakeup_request', ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "heartbeat-unrelated",
            "agent-codex",
            "company",
            "failed",
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:10.000Z",
            "unrelated failure",
            JSON.stringify({ taskId: "task-2" }),
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:10.000Z",
          );
        source
          .prepare(
            `INSERT INTO approvals
               (id, company_id, type, status, requested_by_agent_id, payload_json, linked_task_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "approval-selected",
            "company",
            "protected_runtime_command",
            "pending",
            "agent-gemini",
            JSON.stringify({ command: "npm run build" }),
            "task-1",
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
          );
        source
          .prepare(
            `INSERT INTO approvals
               (id, company_id, type, status, requested_by_agent_id, payload_json, linked_task_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "approval-unrelated",
            "company",
            "protected_runtime_command",
            "pending",
            "agent-codex",
            JSON.stringify({ command: "npm test" }),
            "task-2",
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
          );
        source
          .prepare(
            `INSERT INTO execution_runs
               (id, task_id, agent_id, provider, status, started_at, idempotency_key, process_pid, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "execution-selected",
            "task-1",
            "agent-gemini",
            "gemini",
            "running",
            "2026-01-01T00:00:00.000Z",
            "execution:task-1",
            12345,
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
          );
        source
          .prepare(
            `INSERT INTO execution_runs
               (id, task_id, agent_id, provider, status, started_at, idempotency_key, process_pid, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "execution-unrelated",
            "task-2",
            "agent-gemini",
            "gemini",
            "running",
            "2026-01-01T00:00:00.000Z",
            "execution:task-2",
            23456,
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
          );
        source
          .prepare(
            `INSERT INTO agent_task_sessions
               (id, agent_id, company_id, adapter_type, task_key, session_params_json, session_display_id, last_run_id, last_error, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "session-selected",
            "agent-gemini",
            "company",
            "gemini",
            "INS-1",
            JSON.stringify({ resume: true }),
            "display-stale",
            "heartbeat-selected",
            "env node failed",
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
          );
      } finally {
        source.close();
      }

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
        "GOAL-BENCH-1",
        "--expected-tasks",
        "1",
        "--required-repeats",
        "1",
        "--task-key",
        "INS-1",
        "--reset-selected-tasks-to",
        "to-do",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const target = new Database(targetDbPath, { readonly: true, fileMustExist: true });
      try {
        const task = target
          .prepare("SELECT status, started_at, completed_at, execution_session_id, consecutive_noop_wakes, blocked_reason FROM tasks WHERE id = 'task-1'")
          .get() as {
            status: string;
            started_at: string | null;
            completed_at: string | null;
            execution_session_id: string | null;
            consecutive_noop_wakes: number;
            blocked_reason: string | null;
          };
        assert.equal(task.status, "to-do");
        assert.equal(task.started_at, null);
        assert.equal(task.completed_at, null);
        assert.equal(task.execution_session_id, null);
        assert.equal(task.consecutive_noop_wakes, 0);
        assert.equal(task.blocked_reason, null);

        const agent = target
          .prepare("SELECT current_task_id FROM agents WHERE id = 'agent-gemini'")
          .get() as { current_task_id: string | null };
        assert.equal(agent.current_task_id, null);

        const wake = target
          .prepare("SELECT status, idempotency_key, finished_at FROM agent_wakeup_requests WHERE id = 'wake-selected'")
          .get() as { status: string; idempotency_key: string | null; finished_at: string | null };
        assert.equal(wake.status, "failed");
        assert.equal(wake.idempotency_key, null);
        assert.ok(wake.finished_at);

        const heartbeat = target
          .prepare("SELECT status, error FROM heartbeat_runs WHERE id = 'heartbeat-selected'")
          .get() as { status: string; error: string | null };
        assert.equal(heartbeat.status, "cancelled");
        assert.match(heartbeat.error ?? "", /env: node/);

        const unrelatedHeartbeat = target
          .prepare("SELECT status FROM heartbeat_runs WHERE id = 'heartbeat-unrelated'")
          .get() as { status: string };
        assert.equal(unrelatedHeartbeat.status, "failed");

        const approval = target
          .prepare("SELECT status, decision_note, decided_at FROM approvals WHERE id = 'approval-selected'")
          .get() as { status: string; decision_note: string | null; decided_at: string | null };
        assert.equal(approval.status, "cancelled");
        assert.equal(approval.decision_note, "benchmark replay reset");
        assert.ok(approval.decided_at);

        const unrelatedApproval = target
          .prepare("SELECT status, decision_note FROM approvals WHERE id = 'approval-unrelated'")
          .get() as { status: string; decision_note: string | null };
        assert.equal(unrelatedApproval.status, "pending");
        assert.equal(unrelatedApproval.decision_note, null);

        const selectedRun = target
          .prepare("SELECT status, completed_at, idempotency_key, process_pid FROM execution_runs WHERE id = 'execution-selected'")
          .get() as { status: string; completed_at: string | null; idempotency_key: string | null; process_pid: number | null };
        assert.equal(selectedRun.status, "cancelled");
        assert.ok(selectedRun.completed_at);
        assert.equal(selectedRun.idempotency_key, null);
        assert.equal(selectedRun.process_pid, null);

        const unrelatedRun = target
          .prepare("SELECT status, idempotency_key, process_pid FROM execution_runs WHERE id = 'execution-unrelated'")
          .get() as { status: string; idempotency_key: string | null; process_pid: number | null };
        assert.equal(unrelatedRun.status, "running");
        assert.equal(unrelatedRun.idempotency_key, "execution:task-2");
        assert.equal(unrelatedRun.process_pid, 23456);

        const session = target
          .prepare("SELECT session_params_json, session_display_id, last_run_id, last_error FROM agent_task_sessions WHERE id = 'session-selected'")
          .get() as { session_params_json: string; session_display_id: string | null; last_run_id: string | null; last_error: string | null };
        assert.equal(session.session_params_json, "{}");
        assert.equal(session.session_display_id, null);
        assert.equal(session.last_run_id, null);
        assert.equal(session.last_error, null);
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
        "GOAL-BENCH-1",
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
        "--db",
        dbPath,
        "--task-key",
        "INS-1",
        "--goal",
        "GOAL-BENCH-1",
        "--check-only",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ORCHESTRATION_DB_PATH: path.join(tempRoot, "wrong-lane.db"),
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
      assert.equal(fs.existsSync(path.join(tempRoot, "wrong-lane.db")), false);
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
