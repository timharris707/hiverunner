import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { createCompanyMemoryRecord } from "@/lib/orchestration/company-memory";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { buildMemoryContext } from "@/lib/orchestration/memory-context";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";

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
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Memory Context Evidence Envelope Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const stamp = Date.now();

  await test("buildMemoryContext attaches deterministic evidence envelopes to indexed retrieval results", () => {
    const company = createCompany({
      name: `Envelope Index Company ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;
    const otherCompany = createCompany({
      name: `Envelope Index Other ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: `Envelope Index Project ${stamp}`,
      description: "fixture project",
      color: "#2563eb",
      emoji: "icon:folder",
      status: "active",
    }).project;
    const agent = createProjectAgent({
      projectId: project.id,
      name: `Envelope Index Agent ${stamp}`,
      emoji: "icon:bot",
      role: "Implementation Engineer",
      personality: "Fixture agent.",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const indexedAt = "2026-05-18T12:00:00.000Z";

    const insertIndexed = db.prepare(`
      INSERT INTO memory_source_index
        (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
         file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
         hiverunner_tags_json, status, indexed_at)
      VALUES (?, ?, 'company-vault', ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, '[]', ?, '[]', 'active', ?)
    `);

    insertIndexed.run(
      `idx-z-${stamp}`,
      company.id,
      `/tmp/envelope/${stamp}/z.md`,
      "project",
      "Zeta Rule",
      "Second record with same timestamp.",
      "Second record with same timestamp.",
      indexedAt,
      JSON.stringify({ project_id: project.id }),
      JSON.stringify(["role:implementation"]),
      1,
      indexedAt,
    );
    insertIndexed.run(
      `idx-a-${stamp}`,
      company.id,
      `/tmp/envelope/${stamp}/a.md`,
      "project",
      "Alpha Rule",
      "First record with same timestamp.",
      "First record with same timestamp.",
      indexedAt,
      JSON.stringify({ project_id: project.id }),
      JSON.stringify(["role:implementation"]),
      1,
      indexedAt,
    );
    insertIndexed.run(
      `idx-other-${stamp}`,
      otherCompany.id,
      `/tmp/envelope/${stamp}/other.md`,
      "company",
      "Other Company Rule",
      "This must never be retrieved.",
      "This must never be retrieved.",
      indexedAt,
      "{}",
      "[]",
      1,
      indexedAt,
    );

    const first = buildMemoryContext({
      db,
      companyId: company.id,
      agentId: agent.id,
      agentRole: agent.role,
      projectId: project.id,
      limit: 10,
    });
    const second = buildMemoryContext({
      db,
      companyId: company.id,
      agentId: agent.id,
      agentRole: agent.role,
      projectId: project.id,
      limit: 10,
    });

    assert.ok(first);
    assert.ok(second);
    assert.deepStrictEqual(first.evidence.map((item) => item.recordId), [`idx-a-${stamp}`, `idx-z-${stamp}`]);
    assert.deepStrictEqual(
      first.evidence.map((item) => item.evidenceEnvelope.envelopeId),
      second.evidence.map((item) => item.evidenceEnvelope.envelopeId),
    );
    assert.deepStrictEqual(first.evidence.map((item) => item.evidenceEnvelope.retrievalRank), [1, 2]);
    assert.ok(first.evidence.every((item) => item.evidenceEnvelope.companyId === company.id));
    assert.ok(first.evidence.every((item) => item.evidenceEnvelope.sourceType === "memory_source_index"));
    assert.ok(first.evidence.every((item) => item.evidenceEnvelope.matched.projectId === project.id));
    assert.ok(first.evidence.every((item) => item.evidenceEnvelope.matched.agentId === agent.id));
    assert.ok(first.evidence.every((item) => item.evidenceEnvelope.matched.roleTags.join(",") === "implementation"));
    assert.ok(first.evidence.every((item) => !item.title.includes("Other Company")));
  });

  await test("buildMemoryContext attaches envelopes to registry fallback without cross-company leakage", () => {
    const company = createCompany({
      name: `Envelope Registry Company ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;
    const otherCompany = createCompany({
      name: `Envelope Registry Other ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: `Envelope Registry Project ${stamp}`,
      description: "fixture project",
      color: "#0f766e",
      emoji: "icon:folder",
      status: "active",
    }).project;
    const agent = createProjectAgent({
      projectId: project.id,
      name: `Envelope Registry Agent ${stamp}`,
      emoji: "icon:bot",
      role: "Research Analyst",
      personality: "Fixture agent.",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;

    const memory = createCompanyMemoryRecord(company.id, {
      title: "Registry Retrieval Rule",
      body: "Use the registry fallback when the vault index has no active records.",
      kind: "workflow_note",
      scope: "project",
      status: "active",
      reviewRequired: false,
      reviewState: "approved",
      projectId: project.id,
      metadata: { tags: ["role:research"], sourcePath: `/tmp/envelope/${stamp}/registry.md` },
    }).memory;
    createCompanyMemoryRecord(otherCompany.id, {
      title: "Other Registry Rule",
      body: "This must never be retrieved.",
      kind: "workflow_note",
      scope: "company",
      status: "active",
      reviewRequired: false,
    });

    const context = buildMemoryContext({
      db,
      companyId: company.id,
      agentId: agent.id,
      agentRole: agent.role,
      projectId: project.id,
      limit: 10,
    });

    assert.ok(context);
    assert.strictEqual(context.source, "company_memory_records");
    assert.deepStrictEqual(context.evidence.map((item) => item.recordId), [memory.id]);
    const envelope = context.evidence[0].evidenceEnvelope;
    assert.strictEqual(envelope.version, 1);
    assert.match(envelope.envelopeId, /^[a-f0-9]{64}$/);
    assert.strictEqual(envelope.retrievalRank, 1);
    assert.strictEqual(envelope.sourceType, "company_memory_records");
    assert.strictEqual(envelope.companyId, company.id);
    assert.strictEqual(envelope.recordId, memory.id);
    assert.strictEqual(envelope.sourcePath, `/tmp/envelope/${stamp}/registry.md`);
    assert.deepStrictEqual(envelope.matched, {
      agentId: agent.id,
      agentRole: "Research Analyst",
      projectId: project.id,
      roleTags: ["research"],
    });
    assert.ok(!context.section.includes("Other Registry Rule"));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
