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

  const originalDbPath = process.env.ORCHESTRATION_DB_PATH;
  process.env.ORCHESTRATION_DB_PATH = dbPath;

  try {
    mkdirSync(cwd, { recursive: true });
    mkdirSync(libDir, { recursive: true });
    writeFileSync(runnerScript, "console.log('runner');\n", "utf8");
    writeFileSync(helperImport, "export {};\n", "utf8");
    rmSync(dbPath, { force: true });

    const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
    const { admitRuntimePreflight } = await import("@/lib/orchestration/runtime-preflight");
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

    closeOrchestrationDb();
  } finally {
    if (originalDbPath === undefined) delete process.env.ORCHESTRATION_DB_PATH;
    else process.env.ORCHESTRATION_DB_PATH = originalDbPath;
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
