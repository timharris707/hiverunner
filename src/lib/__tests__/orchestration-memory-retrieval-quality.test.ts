import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { buildMemoryContext } from "@/lib/orchestration/memory-context";
import { getMemoryGraph, listMemoryIndexRecords } from "@/lib/orchestration/memory-vault";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";

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

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function run() {
  console.log("\nOrchestration Memory Retrieval Quality Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Retrieval Quality Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Retrieval Quality Project ${stamp}`,
    description: "fixture project",
    color: "#0ea5e9",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Retrieval Quality Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Implementation Engineer",
    personality: "Precise test fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Retrieve quality memory",
    description: "fixture task",
    priority: "P2",
    type: "research",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  function insertIndex(input: {
    id: string;
    title: string;
    layer?: string;
    frontmatter?: Record<string, unknown>;
    linkedIds?: string[];
    fileMtime?: string;
    pinned?: 0 | 1;
    content?: string;
    sourcePath?: string;
    tags?: string[];
  }) {
    db.prepare(`
      INSERT INTO memory_source_index
        (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
         file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
         hiverunner_tags_json, status, indexed_at)
      VALUES (?, ?, 'company-vault', ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?, '[]', 'active', ?)
    `).run(
      input.id,
      company.id,
      input.sourcePath ?? `/tmp/retrieval-quality/${input.id}.md`,
      input.layer ?? "project",
      input.title,
      input.content ?? `${input.title} body`,
      input.content ?? `${input.title} body`,
      input.fileMtime ?? new Date().toISOString(),
      JSON.stringify(input.frontmatter ?? {
        review_state: "approved",
        project_id: project.id,
        source_task_key: task.key,
        confidence: 0.95,
      }),
      JSON.stringify(input.tags ?? ["role:implementation"]),
      JSON.stringify(input.linkedIds ?? [task.key]),
      input.pinned ?? 0,
      new Date().toISOString(),
    );
  }

  await test("quality policy ranks accepted evidence and warns on duplicate, orphan, and missing approval state", () => {
    insertIndex({ id: "accepted-high-quality", title: "Accepted High Quality Evidence", pinned: 1 });
    insertIndex({ id: "duplicate-a", title: "Duplicate Evidence" });
    insertIndex({ id: "duplicate-b", title: "Duplicate Evidence" });
    insertIndex({
      id: "orphan-note",
      title: "Orphan Evidence",
      layer: "company",
      frontmatter: { review_state: "approved", confidence: 0.9 },
      linkedIds: [],
    });
    insertIndex({
      id: "missing-approval",
      title: "Missing Approval Evidence",
      frontmatter: { project_id: project.id, source_task_key: task.key, confidence: 0.9 },
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
    assert.strictEqual(context.quality.status, "degraded");
    assert.strictEqual(context.evidence[0].recordId, "accepted-high-quality");
    assert.ok(context.evidence.findIndex((item) => item.recordId === "duplicate-b") > context.evidence.findIndex((item) => item.recordId === "duplicate-a"));
    assert.ok(context.quality.warnings.some((issue) => issue.type === "duplicate_cluster" && issue.recordId === "duplicate-b"));
    assert.ok(context.quality.warnings.some((issue) => issue.type === "orphan_note" && issue.recordId === "orphan-note"));
    assert.ok(context.quality.warnings.some((issue) => issue.type === "missing_approval_state" && issue.recordId === "missing-approval"));
    assert.match(context.section, /Quality warnings:/);
  });

  await test("INS-36 graph explorer fixtures are quarantined from normal prompts but remain explicitly accessible", () => {
    insertIndex({
      id: "ins36-fixture-orphan",
      title: `INS-36 orphan note ${stamp}`,
      layer: "company",
      content: `Representative graph explorer fixture for INS-36 orphan note ${stamp}.`,
      sourcePath: `/tmp/ins36-${stamp}-abcdef12/company/orphan.md`,
      frontmatter: {},
      linkedIds: [],
    });

    const normalContext = buildMemoryContext({
      db,
      companyId: company.id,
      agentId: agent.id,
      agentRole: agent.role,
      projectId: project.id,
      limit: 20,
    });

    assert.ok(normalContext);
    assert.ok(!normalContext.section.includes("INS-36 orphan note"));
    assert.ok(!normalContext.evidence.some((item) => item.recordId === "ins36-fixture-orphan"));
    assert.ok(normalContext.quality.warnings.some((issue) => issue.type === "fixture_quarantine" && issue.recordId === "ins36-fixture-orphan"));

    const explicitContext = buildMemoryContext({
      db,
      companyId: company.id,
      agentId: agent.id,
      agentRole: agent.role,
      projectId: project.id,
      limit: 20,
      includeFixtureMemories: true,
    });

    assert.ok(explicitContext);
    assert.ok(explicitContext.section.includes("INS-36 orphan note"));
    const explicitEvidence = explicitContext.evidence.find((item) => item.recordId === "ins36-fixture-orphan");
    assert.ok(explicitEvidence);
    assert.ok(explicitEvidence.inclusionReasons.some((reason) => reason.includes("explicit fixture access")));

    const indexRecords = listMemoryIndexRecords(company.id, { q: "INS-36 orphan", db }).records;
    assert.ok(indexRecords.some((record) => record.recordId === "ins36-fixture-orphan"));
    const graph = getMemoryGraph(company.id, { db, limit: 100 });
    assert.ok(graph.nodes.some((node) => node.id === "ins36-fixture-orphan"));
  });

  await test("quality policy refuses stale, unapproved, and low-confidence indexed evidence with explicit reasons", () => {
    const isolatedCompany = createCompany({
      name: `Retrieval Refusal Company ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;
    const isolatedProject = createProject({
      companyId: isolatedCompany.id,
      name: `Retrieval Refusal Project ${stamp}`,
      description: "fixture project",
      color: "#ef4444",
      emoji: "icon:folder",
      status: "active",
    }).project;
    const isolatedAgent = createProjectAgent({
      projectId: isolatedProject.id,
      name: `Retrieval Refusal Agent ${stamp}`,
      emoji: "icon:bot",
      role: "Implementation Engineer",
      personality: "Precise test fixture agent.",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;

    function insertRefusal(id: string, title: string, frontmatter: Record<string, unknown>, fileMtime = new Date().toISOString()) {
      db.prepare(`
        INSERT INTO memory_source_index
          (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
           file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
           hiverunner_tags_json, status, indexed_at)
        VALUES (?, ?, 'company-vault', ?, 'project', ?, ?, ?, 'markdown', ?, ?, ?, ?, 0, '[]', 'active', ?)
      `).run(
        id,
        isolatedCompany.id,
        `/tmp/retrieval-quality/${id}.md`,
        title,
        `${title} body`,
        `${title} body`,
        fileMtime,
        JSON.stringify({ project_id: isolatedProject.id, source_task_key: "INS-TEST", ...frontmatter }),
        JSON.stringify(["role:implementation"]),
        JSON.stringify(["INS-TEST"]),
        new Date().toISOString(),
      );
    }

    insertRefusal("stale-evidence", "Stale Evidence", { review_state: "approved", confidence: 0.95 }, daysAgo(730));
    insertRefusal("unapproved-evidence", "Unapproved Evidence", { review_state: "requested", confidence: 0.95 });
    insertRefusal("low-confidence", "Low Confidence Evidence", { review_state: "approved", confidence: 0.2 });

    const context = buildMemoryContext({
      db,
      companyId: isolatedCompany.id,
      agentId: isolatedAgent.id,
      agentRole: isolatedAgent.role,
      projectId: isolatedProject.id,
      limit: 10,
    });

    assert.ok(context);
    assert.strictEqual(context.quality.status, "refused");
    assert.strictEqual(context.evidence.length, 0);
    assert.ok(context.quality.refusals.some((issue) => issue.type === "stale_evidence" && issue.recordId === "stale-evidence"));
    assert.ok(context.quality.refusals.some((issue) => issue.type === "unapproved" && issue.recordId === "unapproved-evidence"));
    assert.ok(context.quality.refusals.some((issue) => issue.type === "low_confidence" && issue.recordId === "low-confidence"));
    assert.match(context.section, /Memory retrieval refused/);
    assert.match(context.section, /Refused Stale Evidence/);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
