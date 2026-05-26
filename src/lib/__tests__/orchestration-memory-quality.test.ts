import assert from "node:assert";
import { existsSync, rmSync, statSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  applyMemoryCurationAction,
  listMemoryCurationActions,
  listMemoryQualityScores,
  recordMemoryQualitySignal,
  recordMemoryQualityRecomputation,
} from "@/lib/orchestration/memory-quality";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  FAIL ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

function wikiSnapshot(): { exists: boolean; mtimeMs: number | null } {
  const wikiPath = "/Users/timharris/wiki";
  if (!existsSync(wikiPath)) return { exists: false, mtimeMs: null };
  return { exists: true, mtimeMs: statSync(wikiPath).mtimeMs };
}

async function run() {
  console.log("\nOrchestration Memory Quality Persistence Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Memory Quality Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;

  const sourcePath = `/Users/timharris/wiki/fixture-${stamp}.md`;
  db.prepare(`
    INSERT INTO memory_source_index (
      record_id, company_id, source_id, source_path, layer, title, content_excerpt,
      content_fts, file_type, frontmatter_json, tags_json, linked_ids_json,
      hiverunner_tags_json, status, indexed_at
    )
    VALUES (?, ?, 'global-wiki', ?, 'wiki', 'Quality Fixture', 'fixture excerpt',
      'fixture body', 'markdown', '{}', '[]', '[]', '[]', 'active', ?)
  `).run("quality-source-record", company.id, sourcePath, new Date().toISOString());

  await test("quality signal rows are idempotent per scoring contract", () => {
    const beforeWiki = wikiSnapshot();
    const first = recordMemoryQualitySignal(company.slug, {
      targetType: "source_index",
      targetId: "quality-source-record",
      queue: "weak_provenance",
      qualityScore: 42,
      reason: "Missing source task attribution",
      evidence: { source: "fixture" },
      scoringContract: "sprint-1-quality-v1",
      sourceFingerprint: "hash-a",
    });
    const second = recordMemoryQualitySignal(company.slug, {
      targetType: "source_index",
      targetId: "quality-source-record",
      queue: "weak_provenance",
      qualityScore: 88,
      reason: "Attribution was backfilled in the index",
      evidence: { source: "fixture", updated: true },
      scoringContract: "sprint-1-quality-v1",
      sourceFingerprint: "hash-b",
    });
    const afterWiki = wikiSnapshot();

    assert.strictEqual(first.id, second.id);
    assert.strictEqual(second.qualityScore, 88);
    assert.strictEqual(second.queue, "weak_provenance");
    const rows = db.prepare("SELECT COUNT(*) AS count FROM memory_quality_signals WHERE company_id = ?").get(company.id) as { count: number };
    assert.strictEqual(rows.count, 1);
    assert.deepStrictEqual(afterWiki, beforeWiki);
  });

  await test("recomputation markers are idempotent for the same input hash", () => {
    const first = recordMemoryQualityRecomputation(company.id, {
      recomputationKey: "sprint-2-pass",
      inputHash: "input-hash-1",
      status: "completed",
      scoresWritten: 1,
    });
    const second = recordMemoryQualityRecomputation(company.id, {
      recomputationKey: "sprint-2-pass",
      inputHash: "input-hash-1",
      status: "completed",
      scoresWritten: 1,
    });

    assert.strictEqual(first.id, second.id);
    const rows = db.prepare("SELECT COUNT(*) AS count FROM memory_quality_recomputations WHERE company_id = ?").get(company.id) as { count: number };
    assert.strictEqual(rows.count, 1);
  });

  await test("curation states follow the Sprint 1 lifecycle and action history is idempotent", () => {
    const acknowledged = applyMemoryCurationAction(company.slug, {
      targetType: "source_index",
      targetId: "quality-source-record",
      action: "acknowledge",
      actor: "Tim",
      note: "Acknowledged in queue",
      idempotencyKey: "acknowledge-once",
    });
    const acknowledgedAgain = applyMemoryCurationAction(company.slug, {
      targetType: "source_index",
      targetId: "quality-source-record",
      action: "acknowledge",
      actor: "Tim",
      note: "Acknowledged in queue",
      idempotencyKey: "acknowledge-once",
    });
    const reviewed = applyMemoryCurationAction(company.slug, {
      targetType: "source_index",
      targetId: "quality-source-record",
      action: "mark_reviewed",
      actor: "Castor",
    });
    const resolved = applyMemoryCurationAction(company.slug, {
      targetType: "source_index",
      targetId: "quality-source-record",
      action: "resolve",
      actor: "Tim",
      idempotencyKey: "resolve-once",
    });
    const reopened = applyMemoryCurationAction(company.slug, {
      targetType: "source_index",
      targetId: "quality-source-record",
      action: "reopen",
      actor: "Tim",
      idempotencyKey: "reopen-once",
    });

    assert.strictEqual(acknowledged.state.state, "acknowledged");
    assert.strictEqual(acknowledgedAgain.idempotent, true);
    assert.strictEqual(reviewed.state.state, "reviewed");
    assert.strictEqual(resolved.state.state, "resolved");
    assert.strictEqual(resolved.state.previousState, "reviewed");
    assert.strictEqual(reopened.state.state, "open");

    const states = db.prepare("SELECT COUNT(*) AS count FROM memory_curation_states WHERE company_id = ?").get(company.id) as { count: number };
    assert.strictEqual(states.count, 1);
    assert.deepStrictEqual(
      listMemoryCurationActions(company.slug, "source_index", "quality-source-record").map((action) => action.action),
      ["acknowledge", "mark_reviewed", "resolve", "reopen"],
    );
  });

  await test("quality queues can be listed with curation overlays", () => {
    applyMemoryCurationAction(company.slug, {
      targetType: "source_index",
      targetId: "quality-source-record",
      action: "acknowledge",
      actor: "Tim",
      idempotencyKey: "acknowledge-again-for-filter",
    });
    const scores = listMemoryQualityScores(company.slug, { state: "acknowledged" });
    assert.strictEqual(scores.length, 1);
    assert.strictEqual(scores[0].targetId, "quality-source-record");
    assert.strictEqual(scores[0].curationState, "acknowledged");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
