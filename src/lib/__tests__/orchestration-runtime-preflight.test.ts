/**
 * Focused tests for deterministic runtime preflight circuits.
 * Run:
 * node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-runtime-preflight.test.ts
 */

import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  pass ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  fail ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nRuntime Preflight Circuit Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-runtime-preflight-"));
  const dbPath = path.join(tempRoot, "orchestration.db");
  const cwd = path.join(tempRoot, "workspace");
  const libDir = path.join(tempRoot, "lib");
  const runnerScript = path.join(tempRoot, "hiverunner-symphony-runner.mjs");
  const helperImport = path.join(libDir, "external-runner-utils.mjs");
  const missingNode = path.join(tempRoot, "bin", "missing-node");
  const missingRunner = path.join(tempRoot, "missing", "hiverunner-symphony-runner.mjs");
  const allowedWorkspace = path.join(tempRoot, "allowed-workspace");
  const outsideWorkspace = path.join(tempRoot, "outside-workspace");

  const originalDbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.ORCHESTRATION_DB_PATH = dbPath;

  try {
    mkdirSync(cwd, { recursive: true });
    mkdirSync(allowedWorkspace, { recursive: true });
    mkdirSync(outsideWorkspace, { recursive: true });
    mkdirSync(libDir, { recursive: true });
    writeFileSync(runnerScript, "console.log('runner');\n", "utf8");
    writeFileSync(helperImport, "export {};\n", "utf8");
    rmSync(dbPath, { force: true });

    const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { admitHeartbeatRuntimePreflight, admitRuntimePreflight } = await import("@/lib/orchestration/runtime-preflight");
    const db = getOrchestrationDb();

    await test("migration creates runtime_preflight_results with open circuit index", () => {
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_preflight_results'")
        .get() as { name: string } | undefined;
      assert.strictEqual(table?.name, "runtime_preflight_results");

      const index = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runtime_preflight_open_deterministic_circuit'")
        .get() as { name: string } | undefined;
      assert.strictEqual(index?.name, "idx_runtime_preflight_open_deterministic_circuit");
    });

    await test("repeated missing Node preflight opens one circuit then blocks", () => {
      const input = {
        laneKey: "default",
        provider: "symphony",
        runnerProvider: "codex",
        runnerModel: "gpt-5",
        taskId: "task-node",
        heartbeatRunId: "heartbeat-node-1",
        nodePath: missingNode,
        command: runnerScript,
        commandArgs: ["--fixture"],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd,
        diagnosticText: "OPENAI_API_KEY=sk-test-secret-value PATH=/tmp/secret/bin raw stderr omitted",
      };

      const first = admitRuntimePreflight(input, db);
      assert.strictEqual(first.status, "failed");
      assert.strictEqual(first.failureCode, "missing_node_binary");
      assert.ok(first.circuitId);

      const second = admitRuntimePreflight(input, db);
      assert.strictEqual(second.status, "blocked");
      assert.strictEqual(second.failureCode, "missing_node_binary");
      assert.strictEqual(second.circuitId, first.circuitId);

      const rows = db
        .prepare("SELECT id, summary_json FROM runtime_preflight_results WHERE failure_code = 'missing_node_binary'")
        .all() as Array<{ id: string; summary_json: string }>;
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0]?.id, first.circuitId);

      const summary = rows[0]?.summary_json ?? "";
      assert.ok(!summary.includes("sk-test-secret-value"), "summary must not store API key material");
      assert.ok(!summary.includes("PATH=/tmp/secret/bin"), "summary must not store raw PATH values");
      assert.ok(!summary.includes(tempRoot), "summary must not store raw fixture paths");
      assert.match(summary, /hiverunner-symphony-runner\.mjs/);
      assert.match(summary, /pathSha256/);
    });

    await test("repeated missing bundled runner preflight opens one circuit then blocks", () => {
      const input = {
        laneKey: "default",
        provider: "symphony",
        runnerProvider: "codex",
        runnerModel: "gpt-5",
        taskId: "task-runner",
        heartbeatRunId: "heartbeat-runner-1",
        nodePath: process.execPath,
        command: missingRunner,
        commandArgs: [],
        runnerScriptPath: missingRunner,
        helperImportPaths: [],
        cwd,
      };

      const first = admitRuntimePreflight(input, db);
      assert.strictEqual(first.status, "failed");
      assert.strictEqual(first.failureCode, "missing_runner_script");

      const second = admitRuntimePreflight(input, db);
      assert.strictEqual(second.status, "blocked");
      assert.strictEqual(second.circuitId, first.circuitId);

      const row = db
        .prepare("SELECT COUNT(*) AS count FROM runtime_preflight_results WHERE failure_code = 'missing_runner_script'")
        .get() as { count: number };
      assert.strictEqual(row.count, 1);
    });

    await test("missing helper import is deterministic and secret-safe", () => {
      const missingHelper = path.join(tempRoot, "lib", "missing-helper.mjs");
      const result = admitRuntimePreflight({
        laneKey: "helper",
        provider: "symphony",
        runnerProvider: "codex",
        runnerModel: "gpt-5",
        taskId: "task-helper",
        heartbeatRunId: "heartbeat-helper-1",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [missingHelper],
        cwd,
        diagnosticText: "Authorization: Bearer secret-token-value",
      }, db);
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.failureCode, "missing_helper_import");

      const row = db
        .prepare("SELECT summary_json FROM runtime_preflight_results WHERE failure_code = 'missing_helper_import' LIMIT 1")
        .get() as { summary_json: string } | undefined;
      assert.ok(row);
      assert.ok(!row!.summary_json.includes("secret-token-value"));
      assert.ok(!row!.summary_json.includes(tempRoot));
      assert.match(row!.summary_json, /missing-helper\.mjs/);
    });

    await test("subscription-local Codex preflight rejects API-key auth without storing secrets", () => {
      process.env.OPENAI_API_KEY = "sk-test-secret-value";
      const result = admitRuntimePreflight({
        laneKey: "cli-auth",
        provider: "symphony",
        runnerProvider: "codex",
        runnerModel: "gpt-5",
        taskId: "task-cli-auth",
        heartbeatRunId: "heartbeat-cli-auth-1",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd,
        companyWorkspaceRoot: cwd,
        allowedWorkspaceRoots: [cwd],
        cliCommand: "codex",
        cliReadiness: {
          status: "api_key_forbidden",
          authMode: "api_key",
          detail: "OPENAI_API_KEY=sk-test-secret-value API key auth detected",
        },
      }, db);

      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.failureCode, "missing_cli_auth");
      assert.ok(result.circuitId);

      const row = db
        .prepare("SELECT summary_json FROM runtime_preflight_results WHERE id = ? LIMIT 1")
        .get(result.circuitId) as { summary_json: string } | undefined;
      assert.ok(row);
      assert.ok(!row!.summary_json.includes("sk-test-secret-value"));
      assert.ok(!row!.summary_json.includes("OPENAI_API_KEY=sk-test-secret-value"));
      assert.match(row!.summary_json, /subscriptionLocalBoundary/);
      assert.match(row!.summary_json, /apiEnvironmentIgnored/);
    });

    await test("invalid runner provider identity is blocked before admission", () => {
      const result = admitRuntimePreflight({
        laneKey: "invalid-provider",
        provider: "symphony",
        runnerProvider: "bedrock",
        runnerModel: "claude-sonnet-4-6",
        taskId: "task-invalid-provider",
        heartbeatRunId: "heartbeat-invalid-provider-1",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd,
        companyWorkspaceRoot: cwd,
        allowedWorkspaceRoots: [cwd],
      }, db);

      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.failureCode, "invalid_provider_identity");
    });

    await test("company runtime policy blocks disabled runner providers before launch", () => {
      const disabledProviderCompany = createCompany({
        name: `Runtime Policy Co ${Date.now()}`,
        description: "fixture",
        status: "active",
      }).company;
      db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run(
        JSON.stringify({ governance: { runtime: { disabledProviders: ["gemini"] } } }),
        disabledProviderCompany.id,
      );

      const result = admitRuntimePreflight({
        laneKey: "deep",
        provider: "symphony",
        runnerProvider: "gemini",
        runnerModel: "gemini-3.1-pro-preview",
        companyId: disabledProviderCompany.id,
        taskId: "task-disabled-provider",
        heartbeatRunId: "heartbeat-disabled-provider-1",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd,
        companyWorkspaceRoot: cwd,
        allowedWorkspaceRoots: [cwd],
      }, db);

      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.failureCode, "provider_disabled_by_policy");
      assert.match(result.message ?? "", /disabled by company runtime policy/);
    });

    await test("inactive or unknown model identity is blocked when provider catalog is populated", () => {
      const result = admitRuntimePreflight({
        laneKey: "unknown-model",
        provider: "symphony",
        runnerProvider: "codex",
        runnerModel: "gpt-does-not-exist",
        taskId: "task-unknown-model",
        heartbeatRunId: "heartbeat-unknown-model-1",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd,
        companyWorkspaceRoot: cwd,
        allowedWorkspaceRoots: [cwd],
        cliCommand: "codex",
        cliReadiness: { status: "ready", authMode: "subscription", detail: "Logged in with ChatGPT" },
      }, db);

      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.failureCode, "unavailable_model_identity");
      assert.match(JSON.stringify(result.summary), /gpt-does-not-exist/);
    });

    await test("unsafe workspace outside allowed roots is blocked", () => {
      const result = admitRuntimePreflight({
        laneKey: "unsafe-workspace",
        provider: "symphony",
        runnerProvider: "gemini",
        runnerModel: "gemini-2.5-pro",
        taskId: "task-unsafe-workspace",
        heartbeatRunId: "heartbeat-unsafe-workspace-1",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd: outsideWorkspace,
        companyWorkspaceRoot: allowedWorkspace,
        allowedWorkspaceRoots: [allowedWorkspace],
      }, db);

      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.failureCode, "unsafe_workspace");
      assert.match(JSON.stringify(result.summary), /outside_allowed_workspace_roots/);
    });

    await test("unhealthy required runtime lane opens one circuit then blocks duplicate admission", () => {
      const input = {
        laneKey: "lane-health",
        provider: "symphony",
        runnerProvider: "gemini",
        runnerModel: "auto",
        taskId: "task-lane-health",
        heartbeatRunId: "heartbeat-lane-health-1",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd,
        companyWorkspaceRoot: cwd,
        allowedWorkspaceRoots: [cwd],
        laneReadinessChecks: [{
          laneKey: "stable",
          label: "Stable 3001",
          status: "unhealthy",
          mode: "stable",
          role: "executor",
          port: "3001",
          expectedRole: "executor",
          endpointUrl: "http://127.0.0.1:3001/api/hiverunner/health",
          detail: `health probe failed while reading ${tempRoot}/secret/path`,
        }],
      };

      const first = admitRuntimePreflight(input, db);
      assert.strictEqual(first.status, "failed");
      assert.strictEqual(first.failureCode, "runtime_lane_unhealthy");

      const second = admitRuntimePreflight(input, db);
      assert.strictEqual(second.status, "blocked");
      assert.strictEqual(second.failureCode, "runtime_lane_unhealthy");
      assert.strictEqual(second.circuitId, first.circuitId);

      const rows = db
        .prepare("SELECT summary_json FROM runtime_preflight_results WHERE failure_code = 'runtime_lane_unhealthy'")
        .all() as Array<{ summary_json: string }>;
      assert.strictEqual(rows.length, 1);
      assert.match(rows[0]!.summary_json, /Stable 3001/);
      assert.match(rows[0]!.summary_json, /runtime_lane_unhealthy/);
      assert.ok(!rows[0]!.summary_json.includes(tempRoot), "summary must not store raw local paths");
    });

    await test("migration-incompatible required lane uses distinct deterministic preflight code", () => {
      const result = admitRuntimePreflight({
        laneKey: "lane-migration",
        provider: "symphony",
        runnerProvider: "gemini",
        runnerModel: "auto",
        taskId: "task-lane-migration",
        heartbeatRunId: "heartbeat-lane-migration-1",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd,
        companyWorkspaceRoot: cwd,
        allowedWorkspaceRoots: [cwd],
        laneReadinessChecks: [{
          laneKey: "stable",
          label: "Stable 3001",
          status: "ok",
          mode: "stable",
          role: "executor",
          port: "3001",
          expectedMode: "stable",
          expectedRole: "executor",
          migrationCompatibility: {
            ok: false,
            expectedLatestVersion: 119,
            appliedLatestVersion: 124,
            pendingCount: 0,
            incompatibleCount: 1,
            legacyExtraCount: 0,
            error: `future migration in ${tempRoot}/orchestration.db`,
          },
        }],
      }, db);

      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.failureCode, "runtime_lane_migration_incompatible");
      assert.match(JSON.stringify(result.summary), /migration_incompatible/);
      assert.match(JSON.stringify(result.summary), /124/);
      assert.ok(!JSON.stringify(result.summary).includes(tempRoot), "summary must not store raw local paths");
    });

    await test("provider model fingerprint quarantine blocks later clean admissions", () => {
      const first = admitRuntimePreflight({
        laneKey: "quarantine",
        provider: "symphony",
        runnerProvider: "anthropic",
        runnerModel: "claude-sonnet-4-6",
        taskId: "task-quarantine-a",
        heartbeatRunId: "heartbeat-quarantine-a",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd,
        companyWorkspaceRoot: cwd,
        allowedWorkspaceRoots: [cwd],
        cliCommand: "claude",
        cliReadiness: { status: "needs_login", authMode: "missing", detail: "not logged in" },
      }, db);
      assert.strictEqual(first.status, "failed");
      assert.strictEqual(first.failureCode, "missing_cli_auth");

      const second = admitRuntimePreflight({
        laneKey: "quarantine",
        provider: "symphony",
        runnerProvider: "anthropic",
        runnerModel: "claude-sonnet-4-6",
        taskId: "task-quarantine-b",
        heartbeatRunId: "heartbeat-quarantine-b",
        nodePath: process.execPath,
        command: runnerScript,
        commandArgs: [],
        runnerScriptPath: runnerScript,
        helperImportPaths: [helperImport],
        cwd,
        companyWorkspaceRoot: cwd,
        allowedWorkspaceRoots: [cwd],
        cliCommand: "claude",
        cliReadiness: { status: "ready", authMode: "subscription", detail: "authenticated" },
      }, db);

      assert.strictEqual(second.status, "blocked");
      assert.strictEqual(second.failureCode, "quarantined_provider_model_fingerprint");
      assert.strictEqual(second.circuitId, first.circuitId);

      const row = db
        .prepare("SELECT COUNT(*) AS count FROM runtime_preflight_results WHERE lane_key = 'quarantine'")
        .get() as { count: number };
      assert.strictEqual(row.count, 1);
    });

    await test("benchmark replay metadata makes candidate bundled runner path authoritative", () => {
      const candidateSourceRoot = path.join(tempRoot, "candidate-source");
      const companyWorkspaceRoot = path.join(tempRoot, "company-workspace");
      mkdirSync(candidateSourceRoot, { recursive: true });
      mkdirSync(companyWorkspaceRoot, { recursive: true });

      db.prepare(
        `INSERT INTO companies (id, slug, name, description, status, company_code, workspace_root, workspace_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "company-replay",
        "company-replay",
        "Replay Company",
        "Fixture company",
        "active",
        "REP",
        companyWorkspaceRoot,
        "manual",
      );
      db.prepare(
        `INSERT INTO projects (id, slug, name, company_id, settings_json)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        "project-replay",
        "project-replay",
        "Replay Project",
        "company-replay",
        JSON.stringify({ workspace: { sourceRoot: candidateSourceRoot } }),
      );
      db.prepare(
        `INSERT INTO agents (id, company_id, project_id, name, role, personality, status, adapter_type, runtime_slug)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "agent-replay",
        "company-replay",
        "project-replay",
        "Replay Agent",
        "Engineer",
        "Runs replay tasks.",
        "idle",
        "symphony",
        "replay-symphony",
      );
      db.prepare(
        `INSERT INTO tasks (id, project_id, title, description, priority, type, status, created_by, task_key, company_id, execution_engine, assignee_agent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "task-replay",
        "project-replay",
        "Replay task",
        "Exercise candidate bundled runner resolution.",
        "medium",
        "feature",
        "in_progress",
        "test",
        "REP-1",
        "company-replay",
        "symphony",
        "agent-replay",
      );
      db.prepare(
        `INSERT INTO agent_runtimes
           (id, company_id, agent_id, provider, runtime_kind, scope, runtime_slug, display_name, command, status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "runtime-replay-symphony",
        "company-replay",
        "agent-replay",
        "symphony",
        "external",
        "agent",
        "replay-symphony",
        "Replay Symphony",
        null,
        "online",
        JSON.stringify({
          hiverunnerBenchmarkReplay: {
            schema: "hiverunner.benchmark_replay_runtime_paths.v1",
            bundledRunnerScriptRoot: candidateSourceRoot,
            bundledRunnerCommands: {
              anthropic: path.join(candidateSourceRoot, "scripts", "hiverunner-claude-runner.mjs"),
            },
          },
        }),
      );

      const result = admitHeartbeatRuntimePreflight(db, {
        agentId: "agent-replay",
        companyId: "company-replay",
        taskId: "task-replay",
        heartbeatRunId: "heartbeat-replay",
        provider: "symphony",
        runnerProvider: "anthropic",
        runnerModel: "claude-sonnet-4-6",
      });

      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.failureCode, "missing_runner_script");
      assert.match(JSON.stringify(result.summary), /hiverunner-claude-runner\.mjs/);
    });

    closeOrchestrationDb();
  } finally {
    if (originalDbPath === undefined) delete process.env.ORCHESTRATION_DB_PATH;
    else process.env.ORCHESTRATION_DB_PATH = originalDbPath;
    if (originalOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
