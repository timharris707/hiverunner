/**
 * Focused runtime usage/context ledger tests.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-runtime-ledgers.db node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-runtime-ledgers.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  pass ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  fail ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

console.log("\nRuntime Ledger Tests\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for runtime ledger tests");
  }
  rmSync(dbPath, { force: true });

  const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
  const {
    normalizedRuntimeUsageTotals,
    recordRuntimeUsageLedgerEntry,
  } = await import("@/lib/orchestration/runtime-usage-ledger");
  const { recordRuntimeContextManifest } = await import("@/lib/orchestration/context-manifest");

  const db = getOrchestrationDb();

  await test("migration creates runtime ledger tables", () => {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('runtime_usage_ledger', 'runtime_context_manifests')`
    ).all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((row) => row.name).sort(), [
      "runtime_context_manifests",
      "runtime_usage_ledger",
    ]);
  });

  await test("usage ledger normalizes fresh input and idempotently replaces rows", () => {
    const totals = normalizedRuntimeUsageTotals({
      inputTokens: 100,
      cacheReadInputTokens: 80,
      outputTokens: 12,
      estimatedCostUsd: 0.0042,
    });
    assert.equal(totals.freshInputTokens, 20);
    assert.equal(totals.totalTokens, 112);
    assert.equal(totals.costCents, 0.42);

    const first = recordRuntimeUsageLedgerEntry(db, {
      sourceType: "manual",
      idempotencyKey: "ledger-test:usage",
      provider: "codex",
      model: "gpt-5.5",
      usage: {
        inputTokens: 100,
        cacheReadInputTokens: 80,
        outputTokens: 12,
        estimatedCostUsd: 0.0042,
      },
    });
    const second = recordRuntimeUsageLedgerEntry(db, {
      sourceType: "manual",
      idempotencyKey: "ledger-test:usage",
      provider: "codex",
      model: "gpt-5.5",
      usage: {
        inputTokens: 120,
        cacheReadInputTokens: 90,
        outputTokens: 10,
      },
    });
    assert.ok(first);
    assert.ok(second);

    const row = db.prepare(
      `SELECT COUNT(*) AS count, fresh_input_tokens, total_tokens
       FROM runtime_usage_ledger
       WHERE idempotency_key = ?`
    ).get("ledger-test:usage") as { count: number; fresh_input_tokens: number; total_tokens: number };
    assert.equal(row.count, 1);
    assert.equal(row.fresh_input_tokens, 30);
    assert.equal(row.total_tokens, 130);
  });

  await test("context manifest stores prompt hash and size, not raw prompt text", () => {
    const prompt = "System: secret context should not be duplicated in ledger.";
    recordRuntimeContextManifest(db, {
      sourceType: "manual",
      idempotencyKey: "ledger-test:context",
      provider: "overseer",
      model: "gpt-5.5",
      prompt,
      metadata: { purpose: "test" },
    });

    const row = db.prepare(
      `SELECT prompt_sha256, prompt_chars, estimated_tokens, metadata_json
       FROM runtime_context_manifests
       WHERE idempotency_key = ?
       LIMIT 1`
    ).get("ledger-test:context") as
      | { prompt_sha256: string; prompt_chars: number; estimated_tokens: number; metadata_json: string }
      | undefined;
    assert.ok(row);
    assert.equal(row!.prompt_sha256.length, 64);
    assert.equal(row!.prompt_chars, prompt.length);
    assert.ok(row!.estimated_tokens > 0);
    assert.ok(!JSON.stringify(row).includes("secret context should not be duplicated"));
    assert.match(row!.metadata_json, /test/);
  });

  closeOrchestrationDb();

  if (failed > 0) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\n${passed} passed`);
}

void run();
