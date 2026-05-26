import assert from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createCompany } from "@/lib/orchestration/company-service";
import { createCompanyMemoryRecord } from "@/lib/orchestration/company-memory";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { applyMemoryCurationAction } from "@/lib/orchestration/memory-quality";
import { getCompanyMemorySettings, listMemoryIndexRecords, serializeMemoryMarkdown } from "@/lib/orchestration/memory-vault";
import {
  executeApprovedWikiMarkdownWriteback,
  prepareWikiMarkdownWriteback,
} from "@/lib/orchestration/wiki-writeback-service";
import { updateWikiWritebackApprovalState } from "@/lib/orchestration/wiki-writeback-requests";

let passed = 0;
let failed = 0;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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
  console.log("\nOrchestration Wiki Markdown Write-back Service Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mc-wiki-writeback-service-"));
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Wiki Markdown Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  db.prepare("UPDATE companies SET workspace_root = ? WHERE id = ?").run(
    path.join(workspaceRoot, "companies", company.slug),
    company.id,
  );

  const memory = createCompanyMemoryRecord(company.slug, {
    title: "Approved Wiki Source",
    body: "Approved body with [[Existing Strategy]] and operator-visible provenance.",
    kind: "workflow_note",
    status: "active",
    source: "manual",
    reviewRequired: false,
    reviewState: "approved",
  }).memory;
  const curation = applyMemoryCurationAction(company.slug, {
    targetType: "memory_record",
    targetId: memory.id,
    action: "resolve",
    actor: "Tim",
    idempotencyKey: "wiki-service-source-resolved",
  });

  await test("create flow writes only after approval and preserves Obsidian links/frontmatter", async () => {
    const prepared = await prepareWikiMarkdownWriteback(company.slug, {
      targetPath: "company/generated-approved-note.md",
      sourceMemoryIds: [memory.id],
      curationActionIds: [curation.action.id],
      idempotencyKey: "create-approved-note",
      requestedBy: "Ralph",
    });
    assert.strictEqual(prepared.request.approvalState, "requested");
    await assert.rejects(
      () => executeApprovedWikiMarkdownWriteback(prepared.request.id, { actor: "Tim" }),
      /must be approved/,
    );

    updateWikiWritebackApprovalState(prepared.request.id, { approvalState: "approved", approvedBy: "Tim" });
    const written = await executeApprovedWikiMarkdownWriteback(prepared.request.id, { actor: "Tim" });
    assert.strictEqual(written.fileWritten, true);
    assert.ok(existsSync(written.filePath));
    const content = readFileSync(written.filePath, "utf-8");
    assert.ok(content.startsWith("---\nid: \"wiki-company-generated-approved-note-md\""));
    assert.ok(content.includes("[[Existing Strategy]]"));
    assert.ok(content.includes(`curation-action:${curation.action.id}`));

    const indexed = listMemoryIndexRecords(company.slug, { q: "Approved body" });
    assert.ok(indexed.records.some((record) => record.sourcePath === written.filePath));
  });

  await test("update flow preserves existing frontmatter/body and appends generated Markdown block", async () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const target = path.join(settings.vaultRoot, "company", "existing-note.md");
    const original = serializeMemoryMarkdown({
      frontmatter: {
        id: "existing-note",
        title: "Existing Note",
        tags: ["keep"],
      },
      body: "# Existing Note\n\nKeep this body and [[Original Link]].",
    });
    writeFileSync(target, original, "utf-8");

    const prepared = await prepareWikiMarkdownWriteback(company.slug, {
      targetPath: "company/existing-note.md",
      sourceMemoryIds: [memory.id],
      curationActionIds: [curation.action.id],
      idempotencyKey: "update-existing-note",
      requestedBy: "Ralph",
    });
    assert.strictEqual(prepared.previousFileHash, sha256(original));
    updateWikiWritebackApprovalState(prepared.request.id, { approvalState: "approved", approvedBy: "Tim" });
    await executeApprovedWikiMarkdownWriteback(prepared.request.id, { actor: "Tim" });

    const updated = readFileSync(target, "utf-8");
    assert.ok(updated.startsWith("---\nid: \"existing-note\"\ntitle: \"Existing Note\"\ntags: [\"keep\"]\n---"));
    assert.ok(updated.includes("[[Original Link]]"));
    assert.ok(updated.includes("hiverunner-wiki-writeback:start"));
    assert.ok(updated.includes("[[Existing Strategy]]"));
  });

  await test("conflict detection refuses writes after the previewed file hash changes", async () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const target = path.join(settings.vaultRoot, "company", "conflict-note.md");
    writeFileSync(target, "# Conflict\n\nBefore preview.\n", "utf-8");

    const prepared = await prepareWikiMarkdownWriteback(company.slug, {
      targetPath: "company/conflict-note.md",
      sourceMemoryIds: [memory.id],
      curationActionIds: [curation.action.id],
      idempotencyKey: "conflict-existing-note",
    });
    writeFileSync(target, "# Conflict\n\nChanged after preview.\n", "utf-8");
    updateWikiWritebackApprovalState(prepared.request.id, { approvalState: "approved", approvedBy: "Tim" });

    await assert.rejects(
      () => executeApprovedWikiMarkdownWriteback(prepared.request.id, { actor: "Tim" }),
      /changed since approval preview/,
    );
    assert.ok(!readFileSync(target, "utf-8").includes("Approved body with"));
  });

  await test("path traversal and read-only vault zones are rejected before request creation", async () => {
    await assert.rejects(
      () => prepareWikiMarkdownWriteback(company.slug, {
        targetPath: "../outside.md",
        sourceMemoryIds: [memory.id],
        idempotencyKey: "reject-traversal",
      }),
      /outside the company vault/,
    );
    await assert.rejects(
      () => prepareWikiMarkdownWriteback(company.slug, {
        targetPath: "archive/read-only.md",
        sourceMemoryIds: [memory.id],
        idempotencyKey: "reject-read-only-zone",
      }),
      /not in a declared writable vault zone/,
    );
  });

  await test("idempotent retry returns existing provenance without rewriting", async () => {
    const prepared = await prepareWikiMarkdownWriteback(company.slug, {
      targetPath: "company/idempotent-note.md",
      sourceMemoryIds: [memory.id],
      curationActionIds: [curation.action.id],
      idempotencyKey: "idempotent-approved-note",
    });
    updateWikiWritebackApprovalState(prepared.request.id, { approvalState: "approved", approvedBy: "Tim" });
    const first = await executeApprovedWikiMarkdownWriteback(prepared.request.id, { actor: "Tim" });
    const firstContent = readFileSync(first.filePath, "utf-8");
    const second = await executeApprovedWikiMarkdownWriteback(prepared.request.id, { actor: "Tim" });
    const secondContent = readFileSync(first.filePath, "utf-8");

    assert.strictEqual(second.fileWritten, false);
    assert.strictEqual(second.idempotent, true);
    assert.strictEqual(second.filePath, first.filePath);
    assert.strictEqual(secondContent, firstContent);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
