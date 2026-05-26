import assert from "node:assert";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createCompany } from "@/lib/orchestration/company-service";
import { createCompanyMemoryRecord } from "@/lib/orchestration/company-memory";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { applyMemoryCurationAction } from "@/lib/orchestration/memory-quality";
import {
  GET as getWikiWritebackRoute,
  POST as postWikiWritebackRoute,
} from "@/app/api/orchestration/companies/[slug]/wiki/writeback/route";
import {
  POST as submitWikiWritebackRoute,
} from "@/app/api/orchestration/companies/[slug]/wiki/writeback/[requestId]/submit/route";
import {
  GET as getWikiRollbackMetadataRoute,
} from "@/app/api/orchestration/companies/[slug]/wiki/writeback/[requestId]/rollback/route";
import { updateWikiWritebackApprovalState } from "@/lib/orchestration/wiki-writeback-requests";

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

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function run() {
  console.log("\nOrchestration Wiki Governance API Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const workspaceRoot = path.join(os.tmpdir(), `mc-wiki-governance-api-${Date.now()}`);
  rmSync(workspaceRoot, { recursive: true, force: true });
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Wiki Governance API Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  db.prepare("UPDATE companies SET workspace_root = ? WHERE id = ?").run(
    path.join(workspaceRoot, "companies", company.slug),
    company.id,
  );

  const approvedMemory = createCompanyMemoryRecord(company.slug, {
    title: "Approved governance source",
    body: "This note is approved and safe to publish.",
    status: "active",
    source: "task",
    reviewRequired: false,
    reviewState: "approved",
  }).memory;
  const approvedCuration = applyMemoryCurationAction(company.slug, {
    targetType: "memory_record",
    targetId: approvedMemory.id,
    action: "resolve",
    actor: "Mannie",
    idempotencyKey: "wiki-governance-approved-source",
  });

  const pendingMemory = createCompanyMemoryRecord(company.slug, {
    title: "Pending governance source",
    body: "This note is not approved yet.",
    status: "draft",
    source: "task",
    reviewRequired: true,
    reviewState: "not_requested",
  }).memory;
  applyMemoryCurationAction(company.slug, {
    targetType: "memory_record",
    targetId: pendingMemory.id,
    action: "dismiss",
    actor: "Mannie",
    idempotencyKey: "wiki-governance-pending-source",
  });

  let requestId = "";

  await test("preview rejects unapproved source memory", async () => {
    const res = await postWikiWritebackRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/wiki/writeback`, {
        targetPath: "company/pending-note.md",
        sourceMemoryIds: [pendingMemory.id],
        idempotencyKey: "wiki-preview-unapproved",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 403);
    const payload = await res.json() as { error?: { code?: string } };
    assert.strictEqual(payload.error?.code, "memory_not_approved");
  });

  await test("preview ignores client writableZones overrides and keeps vault-zone validation server-owned", async () => {
    const res = await postWikiWritebackRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/wiki/writeback`, {
        targetPath: "archive/client-override.md",
        sourceMemoryIds: [approvedMemory.id],
        idempotencyKey: "wiki-preview-client-writable-zones",
        writableZones: ["archive"],
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 403);
    const payload = await res.json() as { error?: { code?: string } };
    assert.strictEqual(payload.error?.code, "read_only_zone");
  });

  await test("preview returns request metadata and generated markdown for approved source memory", async () => {
    const res = await postWikiWritebackRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/wiki/writeback`, {
        targetPath: "company/approved-note.md",
        sourceMemoryIds: [approvedMemory.id],
        curationActionIds: [approvedCuration.action.id],
        idempotencyKey: "wiki-preview-approved",
        requestedBy: "Tim",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 201);
    const payload = await res.json() as {
      request: { id: string; approvalState: string; targetPath: string; sourceMemoryIds: string[]; curationActionIds: string[] };
      generatedMarkdown: string;
      targetFilePath: string;
      previousFileHash: string | null;
      idempotent: boolean;
    };

    requestId = payload.request.id;
    assert.strictEqual(payload.request.approvalState, "requested");
    assert.strictEqual(payload.request.targetPath, "company/approved-note.md");
    assert.deepStrictEqual(payload.request.sourceMemoryIds, [approvedMemory.id]);
    assert.deepStrictEqual(payload.request.curationActionIds, [approvedCuration.action.id]);
    assert.ok(payload.generatedMarkdown.includes("Approved governance source"));
    assert.ok(payload.targetFilePath.endsWith(path.join("company", "approved-note.md")));
    assert.strictEqual(payload.previousFileHash, null);
    assert.strictEqual(payload.idempotent, false);
    assert.strictEqual(existsSync(payload.targetFilePath), false);
  });

  await test("submit rejects requests that have not been approved", async () => {
    const res = await submitWikiWritebackRoute(
      new Request(`http://localhost/api/orchestration/companies/${company.slug}/wiki/writeback/${requestId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "Tim" }),
      }) as never,
      { params: Promise.resolve({ slug: company.slug, requestId }) },
    );

    assert.strictEqual(res.status, 403);
    const payload = await res.json() as { error?: { code?: string } };
    assert.strictEqual(payload.error?.code, "writeback_not_approved");
  });

  await test("submit writes an approved request and returns the written file details", async () => {
    updateWikiWritebackApprovalState(requestId, { approvalState: "approved", approvedBy: "Tim" });

    const res = await submitWikiWritebackRoute(
      new Request(`http://localhost/api/orchestration/companies/${company.slug}/wiki/writeback/${requestId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "Tim" }),
      }) as never,
      { params: Promise.resolve({ slug: company.slug, requestId }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      request: { id: string; approvalState: string; approvedBy: string | null; writtenAt: string | null };
      fileWritten: boolean;
      filePath: string;
      fileSha256After: string;
      idempotent: boolean;
    };

    assert.strictEqual(payload.request.id, requestId);
    assert.strictEqual(payload.request.approvalState, "written");
    assert.strictEqual(payload.request.approvedBy, "Tim");
    assert.ok(payload.request.writtenAt);
    assert.strictEqual(payload.fileWritten, true);
    assert.ok(payload.filePath.endsWith(path.join("company", "approved-note.md")));
    assert.ok(payload.fileSha256After.length > 0);
    assert.strictEqual(payload.idempotent, false);
  });

  await test("history returns stable request ids in company order", async () => {
    const res = await getWikiWritebackRoute(
      { nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/wiki/writeback`) } as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      requests: Array<{ id: string; approvalState: string; targetPath: string }>;
    };

    assert.ok(payload.requests.some((request) => request.id === requestId));
    assert.strictEqual(payload.requests[0].id, requestId);
    assert.strictEqual(payload.requests[0].approvalState, "written");
  });

  await test("rollback metadata returns the stored rollback contract for the request", async () => {
    const res = await getWikiRollbackMetadataRoute(
      { nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/wiki/writeback/${requestId}/rollback`) } as never,
      { params: Promise.resolve({ slug: company.slug, requestId }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      requestId: string;
      approvalState: string;
      rollback: { strategy?: string; targetPath?: string; previousFileHash?: string | null };
      previousFileHash: string | null;
    };

    assert.strictEqual(payload.requestId, requestId);
    assert.strictEqual(payload.approvalState, "written");
    assert.strictEqual(payload.rollback.strategy, "delete_created_file");
    assert.strictEqual(payload.rollback.targetPath, "company/approved-note.md");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
