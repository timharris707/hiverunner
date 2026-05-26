import assert from "node:assert";
import { rmSync } from "node:fs";

import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

const isolation = createIsolatedOrchestrationWorkspace({
  prefix: "mc-wiki-writeback-requests-",
});

import { createCompany } from "@/lib/orchestration/company-service";
import { createCompanyMemoryRecord } from "@/lib/orchestration/company-memory";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { applyMemoryCurationAction } from "@/lib/orchestration/memory-quality";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  createWikiWritebackRequest,
  listWikiWritebackRequests,
  updateWikiWritebackApprovalState,
  wikiContentHash,
} from "@/lib/orchestration/wiki-writeback-requests";

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

async function run() {
  console.log("\nOrchestration Wiki Write-back Request Persistence Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  isolation.syncDatabase(db);
  const stamp = Date.now();
  const company = createCompany({
    name: `Wiki Writeback Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const memory = createCompanyMemoryRecord(company.slug, {
    title: "Approved source memory",
    body: "The curated source body.",
    status: "active",
    source: "task",
    reviewRequired: false,
    reviewState: "approved",
  }).memory;
  const curation = applyMemoryCurationAction(company.slug, {
    targetType: "memory_record",
    targetId: memory.id,
    action: "resolve",
    actor: "Mannie",
    idempotencyKey: "wiki-writeback-source-resolution",
  });
  const otherCompany = createCompany({
    name: `Other Wiki Writeback Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const otherMemory = createCompanyMemoryRecord(otherCompany.slug, {
    title: "Other company memory",
    body: "This memory should not be usable as provenance for the first company.",
    status: "active",
    source: "task",
    reviewRequired: false,
    reviewState: "approved",
  }).memory;
  const otherCuration = applyMemoryCurationAction(otherCompany.slug, {
    targetType: "memory_record",
    targetId: otherMemory.id,
    action: "resolve",
    actor: "Mannie",
    idempotencyKey: "wiki-writeback-other-company-resolution",
  });

  await test("migration creates write-back request table with provenance columns", () => {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wiki_writeback_requests'")
      .get() as { name: string } | undefined;
    assert.strictEqual(table?.name, "wiki_writeback_requests");

    const columns = new Set((db.prepare("PRAGMA table_info(wiki_writeback_requests)").all() as Array<{ name: string }>).map((column) => column.name));
    for (const column of [
      "approval_state",
      "target_path",
      "idempotency_key",
      "source_memory_ids_json",
      "curation_action_ids_json",
      "generated_content_hash",
      "previous_file_hash",
      "rollback_json",
    ]) {
      assert.strictEqual(columns.has(column), true, `missing ${column}`);
    }
  });

  await test("creation stores provenance and is idempotent for the same key", () => {
    const hash = wikiContentHash("# Generated note\n\nCurated body.");
    const first = createWikiWritebackRequest(company.slug, {
      targetPath: "Memory/Generated/approved-source-memory.md",
      idempotencyKey: "source-memory-to-wiki-once",
      sourceMemoryIds: [memory.id],
      curationActionIds: [curation.action.id],
      generatedContentHash: hash,
      previousFileHash: "previous-file-hash",
      rollback: {
        strategy: "restore_previous_hash",
        previousPath: "Memory/Generated/approved-source-memory.md",
      },
      requestedBy: "Mannie",
    });
    const second = createWikiWritebackRequest(company.slug, {
      targetPath: "Memory/Generated/ignored-on-repeat.md",
      idempotencyKey: "source-memory-to-wiki-once",
      sourceMemoryIds: [memory.id],
      curationActionIds: [curation.action.id],
      generatedContentHash: "ignored-on-repeat",
      requestedBy: "Mannie",
    });

    assert.strictEqual(first.idempotent, false);
    assert.strictEqual(second.idempotent, true);
    assert.strictEqual(second.request.id, first.request.id);
    assert.strictEqual(second.request.targetPath, "Memory/Generated/approved-source-memory.md");
    assert.deepStrictEqual(second.request.sourceMemoryIds, [memory.id]);
    assert.deepStrictEqual(second.request.curationActionIds, [curation.action.id]);
    assert.strictEqual(second.request.generatedContentHash, hash);
    assert.strictEqual(second.request.previousFileHash, "previous-file-hash");
    assert.strictEqual(second.request.rollback.strategy, "restore_previous_hash");

    const rows = db.prepare("SELECT COUNT(*) AS count FROM wiki_writeback_requests WHERE company_id = ?").get(company.id) as { count: number };
    assert.strictEqual(rows.count, 1);
  });

  await test("creation rejects provenance IDs that do not belong to the company", () => {
    assert.throws(
      () => createWikiWritebackRequest(company.slug, {
        targetPath: "Memory/Generated/wrong-source.md",
        idempotencyKey: "wrong-source-company",
        sourceMemoryIds: [otherMemory.id],
        generatedContentHash: wikiContentHash("wrong source"),
        requestedBy: "Mannie",
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "writeback_source_memory_not_found",
    );

    assert.throws(
      () => createWikiWritebackRequest(company.slug, {
        targetPath: "Memory/Generated/wrong-action.md",
        idempotencyKey: "wrong-action-company",
        sourceMemoryIds: [memory.id],
        curationActionIds: [otherCuration.action.id],
        generatedContentHash: wikiContentHash("wrong action"),
        requestedBy: "Mannie",
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "writeback_curation_action_not_found",
    );
  });

  await test("approval and write result update state without losing rollback provenance", () => {
    const [request] = listWikiWritebackRequests(company.slug, { approvalState: "requested" });
    const approved = updateWikiWritebackApprovalState(request.id, {
      approvalState: "approved",
      approvedBy: "Tim",
    });
    const written = updateWikiWritebackApprovalState(request.id, {
      approvalState: "written",
      previousFileHash: "previous-file-hash-at-write",
      rollback: { strategy: "restore_previous_hash", previousHash: "previous-file-hash-at-write" },
    });

    assert.strictEqual(approved.approvalState, "approved");
    assert.strictEqual(approved.approvedBy, "Tim");
    assert.ok(approved.approvedAt);
    assert.strictEqual(written.approvalState, "written");
    assert.ok(written.writtenAt);
    assert.strictEqual(written.previousFileHash, "previous-file-hash-at-write");
    assert.strictEqual(written.rollback.previousHash, "previous-file-hash-at-write");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
