import assert from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

import { PATCH as patchMemoryCandidate } from "@/app/api/orchestration/companies/[slug]/memory/candidates/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { getMemoryCandidate, listMemoryCandidates, reviewMemoryCandidate } from "@/lib/orchestration/memory-candidates";
import {
  backfillActiveMemoryRecordsToVault,
  generateKnowledgeMapNotes,
  generateGraphNoteMetadata,
  getCompanyMemorySettings,
  getMemoryGraph,
  initializeCompanyMemoryVault,
  listMemoryIndexRecords,
  serializeMemoryMarkdown,
  slugifyMemoryPathPart,
  syncCompanyMemoryVault,
  writeGraphNoteMetadata,
} from "@/lib/orchestration/memory-vault";
import { writeBackApprovedCandidate } from "@/lib/orchestration/memory-writeback";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";

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
  console.log("\nCompany Memory Vault Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mc-memory-vault-"));
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Memory Vault Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const otherCompany = createCompany({
    name: `Other Memory Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  db.prepare("UPDATE companies SET workspace_root = ? WHERE id = ?").run(
    path.join(workspaceRoot, "companies", company.slug),
    company.id,
  );
  db.prepare("UPDATE companies SET workspace_root = ? WHERE id = ?").run(
    path.join(workspaceRoot, "companies", otherCompany.slug),
    otherCompany.id,
  );
  const project = createProject({
    companyId: company.id,
    name: `Memory Project ${stamp}`,
    description: "fixture",
    color: "#f97316",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Memory Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Implementation Engineer",
    personality: "Fixture agent",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Persist memory note",
    description: "fixture",
    priority: "P2",
    type: "research",
    status: "done",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  await test("vault initializer persists settings and creates the Obsidian folder shape", () => {
    const init = initializeCompanyMemoryVault(company.slug);
    const settings = getCompanyMemorySettings(company.slug).settings;
    assert.strictEqual(settings.canonicalMode, "company_vault");
    assert.strictEqual(settings.allowWikiWrites, false);
    for (const folder of ["company", "projects", "agents", "sessions", "inbox", "archive", "maps"]) {
      assert.ok(existsSync(path.join(init.vaultRoot, folder)), `${folder} exists`);
    }
  });

  await test("sync indexes markdown frontmatter, wikilinks, task mentions, and search text", () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const notePath = path.join(settings.vaultRoot, "company", "architecture-note.md");
    writeFileSync(
      notePath,
      serializeMemoryMarkdown({
        frontmatter: {
          id: "fixture-memory-note",
          title: "Architecture Note",
          type: "architecture",
          layer: "company",
          tags: ["hiverunner/memory", "role:implementation"],
          status: "active",
        },
        body: `# Architecture Note\n\nThis links to [[Retrieval Evidence]] and ${task.key}.`,
      }),
      "utf-8",
    );

    const sync = syncCompanyMemoryVault(company.slug, { includeGlobalWiki: false });
    assert.strictEqual(sync.errors.length, 0);
    assert.ok(sync.filesReindexed >= 1);

    const indexed = listMemoryIndexRecords(company.slug, { q: "Architecture", tag: "hiverunner/memory" });
    assert.strictEqual(indexed.records.length, 1);
    assert.strictEqual(indexed.records[0].recordId, "fixture-memory-note");
    assert.deepStrictEqual(indexed.records[0].linkedIds.sort(), [task.key, "Retrieval Evidence"].sort());
  });

  await test("graph endpoint data includes wikilink/task-key edges", () => {
    const graph = getMemoryGraph(company.slug);
    assert.ok(graph.nodes.some((node) => node.id === "fixture-memory-note"));
    assert.ok(graph.nodes.some((node) => node.id === `task:${task.key}`));
    assert.ok(graph.edges.some((edge) => edge.source === "fixture-memory-note" && edge.target === `task:${task.key}`));
  });

  await test("map coverage treats records linked from map notes as covered", () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const projectMapFixtureDir = path.join(settings.vaultRoot, "projects", "map-coverage-fixture");
    mkdirSync(projectMapFixtureDir, { recursive: true });
    writeFileSync(
      path.join(projectMapFixtureDir, "shared-entity-a.md"),
      serializeMemoryMarkdown({
        frontmatter: {
          id: "map-covered-duplicate-a",
          title: "Shared Entity Coverage",
          type: "project",
          layer: "project",
          tags: ["hiverunner/memory"],
          status: "active",
        },
        body: "# Shared Entity Coverage\n\nFirst duplicate fixture.",
      }),
      "utf-8",
    );
    writeFileSync(
      path.join(projectMapFixtureDir, "shared-entity-b.md"),
      serializeMemoryMarkdown({
        frontmatter: {
          id: "map-covered-duplicate-b",
          title: "Shared Entity Coverage",
          type: "project",
          layer: "project",
          tags: ["hiverunner/memory"],
          status: "active",
        },
        body: "# Shared Entity Coverage\n\nSecond duplicate fixture.",
      }),
      "utf-8",
    );
    writeFileSync(
      path.join(settings.vaultRoot, "maps", "entity-coverage.md"),
      serializeMemoryMarkdown({
        frontmatter: {
          id: "map-coverage-note",
          title: "Entity Coverage Map",
          type: "map",
          layer: "map",
          tags: ["hiverunner/knowledge-map"],
          status: "active",
        },
        body: "# Entity Coverage Map\n\nTracks [[Shared Entity Coverage]].",
      }),
      "utf-8",
    );

    const sync = syncCompanyMemoryVault(company.slug, { includeGlobalWiki: false });
    assert.strictEqual(sync.errors.length, 0);

    const graph = getMemoryGraph(company.slug);
    assert.ok(graph.mapCoverage.coveredRecords >= 3);
    assert.ok(
      !graph.mapCoverage.uncoveredSample.some((record) => record.title === "Shared Entity Coverage"),
      "records linked from a map note should not appear as map coverage gaps",
    );
  });

  await test("graph note metadata emitter generates stable frontmatter, aliases, tags, and wikilinks", () => {
    db.prepare(`
      INSERT INTO company_memory_records
        (id, company_id, project_id, task_id, slug, title, body, kind, scope, status, source, confidence, review_required, review_state, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'architecture', 'project', 'active', 'task', 0.82, 0, 'approved', ?)
    `).run(
      "graph-memory-record",
      company.id,
      project.id,
      task.id,
      "graph-memory-record",
      "Graph Metadata Contract",
      "Graph metadata should link project, task, and indexed source evidence.",
      JSON.stringify({ vaultRecordId: "fixture-memory-note", tags: ["graph", "graph"] }),
    );
    db.prepare(`
      INSERT INTO memory_curation_states
        (id, company_id, target_type, target_id, state, actor, note, metadata_json)
      VALUES (?, ?, 'memory_record', ?, 'acknowledged', 'Tim', 'Keep this record in the graph.', '{}')
    `).run("graph-curation-state", company.id, "graph-memory-record");

    const first = generateGraphNoteMetadata(company.slug);
    const second = generateGraphNoteMetadata(company.slug);
    assert.deepStrictEqual(
      second.notes.map((note) => ({ id: note.id, relativePath: note.relativePath, markdown: note.markdown })),
      first.notes.map((note) => ({ id: note.id, relativePath: note.relativePath, markdown: note.markdown })),
    );

    const memoryNote = first.notes.find((note) => note.id === "graph:memory:graph-memory-record");
    assert.ok(memoryNote);
    assert.strictEqual(memoryNote.kind, "memory");
    assert.strictEqual(memoryNote.frontmatter.id, "graph:memory:graph-memory-record");
    assert.strictEqual(memoryNote.frontmatter.graph_kind, "memory");
    assert.deepStrictEqual(memoryNote.aliases, ["graph-memory-record"]);
    assert.strictEqual(memoryNote.tags.filter((tag) => tag === "graph").length, 1);
    assert.ok(memoryNote.tags.includes("hiverunner/graph/memory"));
    assert.ok(memoryNote.relativePath.startsWith("graph/memories/"));
    assert.ok(memoryNote.links.some((link) => link.targetId === `graph:task:${task.key}` && link.wikilink.includes("|")));
    assert.ok(memoryNote.links.some((link) => link.targetId === "graph:evidence:fixture-memory-note"));
    assert.ok(memoryNote.markdown.startsWith("---\n"));
    assert.ok(memoryNote.markdown.includes("links: ["));

    const curationNote = first.notes.find((note) => note.id === "graph:curation:memory_record:graph-memory-record");
    assert.ok(curationNote);
    assert.ok(curationNote.links.some((link) => link.targetId === "graph:memory:graph-memory-record"));
  });

  await test("graph note metadata writer is dry-run by default and writes only graph-zone files", () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const companyNotePath = path.join(settings.vaultRoot, "company", "architecture-note.md");
    const beforeCompanyNote = readFileSync(companyNotePath, "utf-8");
    const dryRun = writeGraphNoteMetadata(company.slug);
    assert.strictEqual(dryRun.dryRun, true);
    assert.strictEqual(dryRun.written.length, 0);
    assert.ok(dryRun.planned.length > 0);
    assert.ok(dryRun.planned.every((item) => item.filePath.includes(`${path.sep}graph${path.sep}`)));

    const applied = writeGraphNoteMetadata(company.slug, { apply: true });
    assert.strictEqual(applied.dryRun, false);
    assert.strictEqual(applied.errors.length, 0);
    assert.ok(applied.written.length > 0);
    assert.ok(applied.written.every((item) => {
      const relative = path.relative(settings.vaultRoot, item.filePath);
      return !relative.startsWith("..") && relative.split(path.sep)[0] === "graph" && existsSync(item.filePath);
    }));
    assert.strictEqual(readFileSync(companyNotePath, "utf-8"), beforeCompanyNote);
  });

  await test("knowledge map notes are deterministic, idempotent, and include cluster provenance", () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const projectDir = path.join(settings.vaultRoot, "projects", project.slug);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, "knowledge-map-source.md"),
      serializeMemoryMarkdown({
        frontmatter: {
          id: "knowledge-map-source",
          title: "Knowledge Map Source",
          type: "workflow",
          layer: "project",
          project: "HiveRunner",
          entities: ["Insight", "HiveRunner"],
          workflows: ["Sprint Planning"],
          evidence_cluster: "Sprint 4 proof",
          tags: ["topic:company-memory", "workflow:review", "evidence:release-proof"],
          status: "active",
        },
        body: `# Knowledge Map Source\n\nMap material for [[Architecture Note]] and ${task.key}.`,
      }),
      "utf-8",
    );
    syncCompanyMemoryVault(company.slug, { includeGlobalWiki: false });

    const first = generateKnowledgeMapNotes(company.slug, { apply: false, limit: 100 });
    const second = generateKnowledgeMapNotes(company.slug, { apply: false, limit: 100 });
    assert.deepStrictEqual(
      first.notes.map((note) => ({ kind: note.kind, sha256: note.sha256, markdown: note.markdown, clusters: note.clusters })),
      second.notes.map((note) => ({ kind: note.kind, sha256: note.sha256, markdown: note.markdown, clusters: note.clusters })),
    );

    for (const note of first.notes) {
      assert.ok(note.filePath.startsWith(path.join(settings.vaultRoot, "maps") + path.sep));
      for (const cluster of note.clusters) {
        assert.ok(cluster.sources.length > 0, `${note.kind}:${cluster.title} has sources`);
        assert.ok(cluster.sourceRecordIds.length > 0, `${note.kind}:${cluster.title} has source ids`);
        assert.ok(note.markdown.includes("**Provenance**"));
        for (const source of cluster.sources) {
          assert.ok(source.recordId, "source record id is present");
          assert.ok(source.sourcePath, "source path is present");
          assert.ok(note.markdown.includes(`record: \`${source.recordId}\``));
          assert.ok(note.markdown.includes(`path: \`${source.sourcePath.replaceAll("\\", "/")}\``));
        }
      }
    }

    const entityNote = first.notes.find((note) => note.kind === "entities");
    assert.ok(entityNote?.clusters.some((cluster) => cluster.title === "HiveRunner"));
    const projectNote = first.notes.find((note) => note.kind === "projects");
    assert.ok(projectNote?.clusters.some((cluster) => cluster.title === "HiveRunner"));
    const workflowNote = first.notes.find((note) => note.kind === "workflows");
    assert.ok(workflowNote?.clusters.some((cluster) => cluster.title === "Sprint Planning"));
    const evidenceNote = first.notes.find((note) => note.kind === "evidence");
    assert.ok(evidenceNote?.clusters.some((cluster) => cluster.title === "Sprint 4 proof"));

    const applied = generateKnowledgeMapNotes(company.slug, { apply: true, limit: 100 });
    for (const note of applied.notes) {
      assert.ok(existsSync(note.filePath), `${note.kind} map note was written`);
      assert.strictEqual(readFileSync(note.filePath, "utf-8"), note.markdown);
    }

    const writtenBefore = Object.fromEntries(applied.notes.map((note) => [note.kind, readFileSync(note.filePath, "utf-8")]));
    const reapplied = generateKnowledgeMapNotes(company.slug, { apply: true, limit: 100 });
    assert.deepStrictEqual(reapplied.notes.map((note) => note.sha256), applied.notes.map((note) => note.sha256));
    for (const note of reapplied.notes) {
      assert.strictEqual(readFileSync(note.filePath, "utf-8"), writtenBefore[note.kind]);
    }
  });

  await test("candidate list is company scoped", () => {
    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, status, proposed_by_agent, source_task_id, proposed_at, scope)
      VALUES
        ('candidate-company-a', ?, 'Company A memory', 'pending', 'Scout', ?, ?, 'role_project'),
        ('candidate-company-b', ?, 'Company B memory', 'pending', 'Scout', NULL, ?, 'company')
    `).run(company.id, task.id, new Date().toISOString(), otherCompany.id, new Date().toISOString());

    const candidates = listMemoryCandidates(company.slug, { status: "pending" });
    assert.ok(candidates.some((candidate) => candidate.id === "candidate-company-a"));
    assert.ok(!candidates.some((candidate) => candidate.id === "candidate-company-b"));
  });

  await test("approved candidate writes exactly one canonical vault note", async () => {
    const outsidePath = path.join(workspaceRoot, "outside-wiki.md");
    writeFileSync(outsidePath, "original", "utf-8");
    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, scope)
      VALUES (?, ?, ?, 'fact', ?, 'implementation', 'pending', 'Scout', ?, ?, 'role_project')
    `).run(
      "candidate-writeback",
      company.id,
      "Approved memory should become a Markdown note in the company vault.",
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
    );

    const review = reviewMemoryCandidate("candidate-writeback", "approved", "Tim");
    assert.strictEqual(review.outcome, "approved");
    const candidate = getMemoryCandidate("candidate-writeback");
    assert.ok(candidate);
    const before = readFileSync(outsidePath, "utf-8");
    const result = await writeBackApprovedCandidate(candidate!, company.slug, "Tim");
    const after = readFileSync(outsidePath, "utf-8");
    assert.strictEqual(after, before);
    assert.strictEqual(result.status, "written");
    assert.strictEqual(result.fileWritten, true);
    assert.ok(result.filePath?.includes(`${path.sep}memory${path.sep}`));
    assert.ok(existsSync(result.filePath!));
    const indexed = listMemoryIndexRecords(company.slug, { q: "Approved memory" });
    assert.ok(indexed.records.some((record) => record.sourcePath === result.filePath));
  });

  await test("writeback refuses unapproved, traversal, and read-only-zone targets", async () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const outsidePath = path.join(workspaceRoot, "outside-wiki.md");
    const archivePath = path.join(settings.vaultRoot, "archive", "readonly.md");
    writeFileSync(outsidePath, "outside", "utf-8");
    writeFileSync(archivePath, "archive", "utf-8");

    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, scope, target_source_file)
      VALUES
        ('candidate-not-approved', ?, 'Pending records must not write.', 'fact', ?, 'workflow', 'pending', 'Scout', ?, ?, 'company', ?),
        ('candidate-traversal', ?, 'Traversal must not write.', 'fact', ?, 'workflow', 'approved', 'Scout', ?, ?, 'company', ?),
        ('candidate-readonly', ?, 'Archive is read only.', 'fact', ?, 'workflow', 'approved', 'Scout', ?, ?, 'company', ?)
    `).run(
      company.id,
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
      path.join(settings.vaultRoot, "company", "pending.md"),
      company.id,
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
      path.join(settings.vaultRoot, "company", "..", "..", "outside-wiki.md"),
      company.id,
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
      archivePath,
    );

    await assert.rejects(
      () => writeBackApprovedCandidate(getMemoryCandidate("candidate-not-approved")!, company.slug, "Tim"),
      /candidate must be approved/,
    );
    await assert.rejects(
      () => writeBackApprovedCandidate(getMemoryCandidate("candidate-traversal")!, company.slug, "Tim"),
      /outside the company vault/,
    );
    await assert.rejects(
      () => writeBackApprovedCandidate(getMemoryCandidate("candidate-readonly")!, company.slug, "Tim"),
      /not in a declared writable vault zone/,
    );
    assert.strictEqual(readFileSync(outsidePath, "utf-8"), "outside");
    assert.strictEqual(readFileSync(archivePath, "utf-8"), "archive");
  });

  await test("targeted update preserves frontmatter and detects hash conflicts", async () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const target = path.join(settings.vaultRoot, "company", "existing-update.md");
    const initial = serializeMemoryMarkdown({
      frontmatter: {
        id: "existing-update",
        title: "Existing Update",
        tags: ["existing"],
      },
      body: "Original body with [[Existing Link]].",
    });
    writeFileSync(target, initial, "utf-8");
    const beforeHash = sha256(initial);

    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, scope, target_source_file)
      VALUES (?, ?, ?, 'fact', ?, 'workflow', 'approved', 'Scout', ?, ?, 'company', ?)
    `).run(
      "candidate-update",
      company.id,
      "Approved update body with [[New Link]].",
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
      target,
    );

    const result = await writeBackApprovedCandidate(getMemoryCandidate("candidate-update")!, company.slug, "Tim", {
      expectedFileSha256: beforeHash,
    });
    assert.strictEqual(result.action, "append");
    const updated = readFileSync(target, "utf-8");
    assert.ok(updated.startsWith("---\nid: \"existing-update\""));
    assert.ok(updated.includes("[[Existing Link]]"));
    assert.ok(updated.includes("[[New Link]]"));

    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, scope, target_source_file)
      VALUES (?, ?, ?, 'fact', ?, 'workflow', 'approved', 'Scout', ?, ?, 'company', ?)
    `).run(
      "candidate-conflict",
      company.id,
      "This should not be appended after a stale preview.",
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
      target,
    );

    await assert.rejects(
      () => writeBackApprovedCandidate(getMemoryCandidate("candidate-conflict")!, company.slug, "Tim", {
        expectedFileSha256: beforeHash,
      }),
      /changed since preview/,
    );
    assert.ok(!readFileSync(target, "utf-8").includes("This should not be appended"));
  });

  await test("writeback idempotent retry returns existing provenance without rewriting", async () => {
    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, scope)
      VALUES (?, ?, ?, 'fact', ?, 'workflow', 'approved', 'Scout', ?, ?, 'company')
    `).run(
      "candidate-idempotent",
      company.id,
      "Idempotent approved writeback should not duplicate notes or memory records.",
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
    );

    const candidate = getMemoryCandidate("candidate-idempotent")!;
    const first = await writeBackApprovedCandidate(candidate, company.slug, "Tim");
    const firstContent = readFileSync(first.filePath!, "utf-8");
    const second = await writeBackApprovedCandidate(candidate, company.slug, "Tim");
    const secondContent = readFileSync(first.filePath!, "utf-8");
    assert.strictEqual(second.fileWritten, false);
    assert.strictEqual(second.filePath, first.filePath);
    assert.strictEqual(second.memoryRecordId, first.memoryRecordId);
    assert.strictEqual(secondContent, firstContent);
    const records = db.prepare(`
      SELECT id FROM company_memory_records
      WHERE metadata_json LIKE '%candidate-idempotent%'
    `).all();
    assert.strictEqual(records.length, 1);
  });

  await test("candidate approval route returns writeback provenance and indexed records expose it", async () => {
    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, scope)
      VALUES (?, ?, ?, 'fact', ?, 'workflow', 'pending', 'Scout', ?, ?, 'role_project')
    `).run(
      "candidate-route-writeback",
      company.id,
      "Route approval should create a Markdown note with visible writeback provenance.",
      JSON.stringify(["hiverunner/memory", "route-test"]),
      task.id,
      new Date().toISOString(),
    );

    const response = await patchMemoryCandidate(
      new NextRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory/candidates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "candidate-route-writeback", decision: "approved", reviewedBy: "Tim" }),
      }),
      { params: Promise.resolve({ slug: company.slug }) },
    );
    assert.strictEqual(response.status, 200);
    const body = await response.json() as {
      outcome: string;
      writeback: { status: string; action: string; filePath: string; memoryRecordId: string };
    };
    assert.strictEqual(body.outcome, "approved");
    assert.strictEqual(body.writeback.status, "written");
    assert.strictEqual(body.writeback.action, "create");
    assert.ok(body.writeback.filePath.includes(`${path.sep}memory${path.sep}`));
    assert.ok(body.writeback.memoryRecordId);

    const indexed = listMemoryIndexRecords(company.slug, { q: "Route approval" });
    const record = indexed.records.find((candidateRecord) => candidateRecord.sourcePath === body.writeback.filePath);
    assert.ok(record);
    assert.strictEqual(record.writeback?.candidateId, "candidate-route-writeback");
    assert.strictEqual(record.writeback?.action, "create");
    assert.strictEqual(record.writeback?.attribution, "Tim");
    assert.strictEqual(record.writeback?.error, null);
  });

  await test("candidate approval route reports Markdown writeback failure and leaves candidate pending", async () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const invalidTarget = path.join(settings.vaultRoot, "company");
    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, scope, target_source_file)
      VALUES (?, ?, ?, 'fact', ?, 'workflow', 'pending', 'Scout', ?, ?, 'role_project', ?)
    `).run(
      "candidate-route-writeback-fail",
      company.id,
      "This writeback target is a directory and should fail before approval.",
      JSON.stringify(["hiverunner/memory", "route-test"]),
      task.id,
      new Date().toISOString(),
      invalidTarget,
    );

    const response = await patchMemoryCandidate(
      new NextRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory/candidates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "candidate-route-writeback-fail", decision: "approved", reviewedBy: "Tim" }),
      }),
      { params: Promise.resolve({ slug: company.slug }) },
    );
    assert.strictEqual(response.status, 400);
    const body = await response.json() as {
      error: string;
      writeback: { status: string; error: string; filePath: string | null };
    };
    assert.strictEqual(body.writeback.status, "failed");
    assert.ok(body.writeback.error.includes("target path must be a Markdown file"));
    assert.strictEqual(body.writeback.filePath, invalidTarget);
    assert.ok(body.error.includes("candidate was not approved"));
    assert.strictEqual(getMemoryCandidate("candidate-route-writeback-fail")?.status, "pending");
  });

  await test("final approval keeps candidate pending when vault writeback fails", async () => {
    const { settings } = getCompanyMemorySettings(company.slug);
    const targetDirectory = path.join(settings.vaultRoot, "company");
    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, scope, target_source_file)
      VALUES (?, ?, ?, 'fact', ?, 'implementation', 'pending', 'Scout', ?, ?, 'role_project', ?)
    `).run(
      "candidate-writeback-failure",
      company.id,
      "This approval should not stick when the target file cannot be appended.",
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
      targetDirectory,
    );

    const request = new Request(`http://localhost/api/orchestration/companies/${company.slug}/memory/candidates`, {
      method: "PATCH",
      body: JSON.stringify({ id: "candidate-writeback-failure", decision: "approved", reviewedBy: "Tim" }),
      headers: { "content-type": "application/json" },
    });
    const response = await patchMemoryCandidate(request as never, { params: Promise.resolve({ slug: company.slug }) });
    const payload = await response.json() as { writeback?: { status?: string; error?: string } };

    assert.strictEqual(response.status, 400);
    assert.strictEqual(payload.writeback?.status, "failed");
    assert.ok(payload.writeback?.error);
    assert.strictEqual(getMemoryCandidate("candidate-writeback-failure")?.status, "pending");
    const records = db.prepare(`
      SELECT id FROM company_memory_records
      WHERE metadata_json LIKE '%candidate-writeback-failure%'
    `).all();
    assert.strictEqual(records.length, 0);
  });

  await test("create writeback failure cleans up the vault note and index row", async () => {
    const body = "Forced log failure should not leave an orphan Markdown file.";
    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, scope)
      VALUES (?, ?, ?, 'fact', ?, 'workflow', 'pending', 'Scout', ?, ?, 'company')
    `).run(
      "candidate-writeback-rollback",
      company.id,
      body,
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
    );
    db.exec(`
      CREATE TRIGGER fail_candidate_writeback_log
      BEFORE INSERT ON memory_writeback_log
      WHEN NEW.candidate_id = 'candidate-writeback-rollback'
      BEGIN
        SELECT RAISE(FAIL, 'forced writeback log failure');
      END;
    `);

    const request = new NextRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory/candidates`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "candidate-writeback-rollback", decision: "approved", reviewedBy: "Tim" }),
    });
    const response = await patchMemoryCandidate(request, { params: Promise.resolve({ slug: company.slug }) });
    db.exec("DROP TRIGGER IF EXISTS fail_candidate_writeback_log;");

    assert.strictEqual(response.status, 500);
    assert.strictEqual(getMemoryCandidate("candidate-writeback-rollback")?.status, "pending");
    const expectedPath = path.join(
      getCompanyMemorySettings(company.slug).settings.vaultRoot,
      "company",
      `${slugifyMemoryPathPart(`workflow: ${body}`, "memory-note")}.md`,
    );
    assert.ok(!existsSync(expectedPath), "failed writeback removed created markdown file");
    const indexed = listMemoryIndexRecords(company.slug, { q: "Forced log failure" });
    assert.strictEqual(indexed.records.length, 0);
  });

  await test("backfill plans and applies approved DB-only candidates", () => {
    db.prepare(`
      INSERT INTO memory_candidates
        (id, company_id, body, type, tags, category, status, proposed_by_agent, source_task_id, proposed_at, reviewed_by, reviewed_at, scope)
      VALUES (?, ?, ?, 'fact', ?, 'workflow', 'approved', 'Scout', ?, ?, 'Tim', ?, 'role_project')
    `).run(
      "candidate-approved-db-only",
      company.id,
      "Approved DB-only memory should be written by backfill.",
      JSON.stringify(["hiverunner/memory"]),
      task.id,
      new Date().toISOString(),
      new Date().toISOString(),
    );

    const dryRun = backfillActiveMemoryRecordsToVault({ companySlug: company.slug, apply: false });
    assert.ok(dryRun.candidatePlanned.some((item) => item.id === "candidate-approved-db-only"));
    assert.strictEqual(dryRun.candidatesWritten, 0);

    const applied = backfillActiveMemoryRecordsToVault({ companySlug: company.slug, apply: true });
    assert.ok(applied.candidatePlanned.some((item) => item.id === "candidate-approved-db-only"));
    assert.strictEqual(applied.errors.length, 0);
    assert.strictEqual(applied.candidatesWritten, 1);

    const writeLog = db.prepare("SELECT source_path FROM memory_writeback_log WHERE candidate_id = ?").get("candidate-approved-db-only") as { source_path: string } | undefined;
    assert.ok(writeLog?.source_path);
    assert.ok(existsSync(writeLog.source_path));
    const records = db.prepare(`
      SELECT id FROM company_memory_records
      WHERE metadata_json LIKE '%candidate-approved-db-only%'
    `).all();
    assert.strictEqual(records.length, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
