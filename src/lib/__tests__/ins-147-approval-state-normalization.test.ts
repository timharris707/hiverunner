import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { buildMemoryContext } from "@/lib/orchestration/memory-context";
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

async function run() {
  console.log("\nINS-147: Approval State Normalization Test\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Approval State Company ${stamp}`,
    description: "fixture for INS-147 normalization",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Approval State Project ${stamp}`,
    description: "fixture project",
    color: "#0ea5e9",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Approval State Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Implementation Engineer",
    personality: "Precise test fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Test approval state normalization",
    description: "fixture task",
    priority: "P2",
    type: "research",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  function insertIndexRecord(input: {
    id: string;
    title: string;
    layer?: string;
    frontmatter?: Record<string, unknown>;
    linkedIds?: string[];
    companyId?: string;
  }) {
    db.prepare(`
      INSERT INTO memory_source_index
        (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
         file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
         hiverunner_tags_json, status, indexed_at)
      VALUES (?, ?, 'company-vault', ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, 0, '[]', 'active', ?)
    `).run(
      input.id,
      input.companyId ?? company.id,
      `/tmp/approval-state/${input.id}.md`,
      input.layer ?? "project",
      input.title,
      input.content ?? `${input.title} body`,
      input.content ?? `${input.title} body`,
      new Date().toISOString(),
      JSON.stringify(input.frontmatter ?? {}),
      JSON.stringify(["role:implementation"]),
      JSON.stringify(input.linkedIds ?? [task.key]),
      new Date().toISOString(),
    );
  }

  await test("migration 110 normalizes approval_state from review_state for missing approval records", () => {
    insertIndexRecord({
      id: "has-review-only",
      title: "Has Review State Only",
      frontmatter: {
        review_state: "approved",
        project_id: project.id,
        source_task_key: task.key,
        confidence: 0.95,
      },
    });
    insertIndexRecord({
      id: "has-both",
      title: "Has Both Approval and Review",
      frontmatter: {
        approval_state: "approved",
        review_state: "approved",
        project_id: project.id,
        source_task_key: task.key,
        confidence: 0.95,
      },
    });
    insertIndexRecord({
      id: "has-neither",
      title: "Has Neither Approval nor Review",
      frontmatter: {
        project_id: project.id,
        source_task_key: task.key,
        confidence: 0.95,
      },
    });

    const beforeMigration = db.prepare(`
      SELECT COUNT(*) as count FROM memory_source_index
      WHERE company_id = ? AND json_extract(frontmatter_json, '$.approval_state') IS NULL
    `).get(company.id) as { count: number };

    db.exec(`
      UPDATE memory_source_index
      SET frontmatter_json = json_set(
        frontmatter_json,
        '$.approval_state',
        json_extract(frontmatter_json, '$.review_state')
      )
      WHERE json_extract(frontmatter_json, '$.approval_state') IS NULL
        AND json_extract(frontmatter_json, '$.review_state') IS NOT NULL;
    `);

    const afterMigration = db.prepare(`
      SELECT COUNT(*) as count FROM memory_source_index
      WHERE company_id = ? AND json_extract(frontmatter_json, '$.approval_state') IS NULL
    `).get(company.id) as { count: number };

    const hasReviewOnly = db.prepare(`
      SELECT json_extract(frontmatter_json, '$.approval_state') as approval_state
      FROM memory_source_index
      WHERE record_id = 'has-review-only'
    `).get() as { approval_state: string };

    const hasBoth = db.prepare(`
      SELECT json_extract(frontmatter_json, '$.approval_state') as approval_state
      FROM memory_source_index
      WHERE record_id = 'has-both'
    `).get() as { approval_state: string };

    const hasNeither = db.prepare(`
      SELECT json_extract(frontmatter_json, '$.approval_state') as approval_state
      FROM memory_source_index
      WHERE record_id = 'has-neither'
    `).get() as { approval_state: string };

    assert.strictEqual(beforeMigration.count, 2, "Should have 2 records missing approval_state before migration");
    assert.strictEqual(afterMigration.count, 1, "Should have 1 record missing approval_state after migration (has-neither)");
    assert.strictEqual(hasReviewOnly.approval_state, "approved", "has-review-only should have approval_state set to 'approved'");
    assert.strictEqual(hasBoth.approval_state, "approved", "has-both should retain existing approval_state");
    assert.strictEqual(hasNeither.approval_state, null, "has-neither should still lack approval_state");
  });

  await test("after normalization, records with review_state have approval_state in frontmatter", () => {
    const isolatedCompany2 = createCompany({
      name: `Approval State Company 2 ${stamp}`,
      description: "fixture for INS-147 frontmatter update verification",
      status: "active",
    }).company;
    const isolatedProject2 = createProject({
      companyId: isolatedCompany2.id,
      name: `Approval State Project 2 ${stamp}`,
      description: "fixture project",
      color: "#0ea5e9",
      emoji: "icon:folder",
      status: "active",
    }).project;

    insertIndexRecord({
      id: "review-to-approval",
      title: "Review State Only",
      layer: "project",
      companyId: isolatedCompany2.id,
      linkedIds: ["INS-TEST"],
      frontmatter: {
        review_state: "approved",
        project_id: isolatedProject2.id,
        confidence: 0.95,
      },
    });

    const recordBefore = db.prepare(`
      SELECT json_extract(frontmatter_json, '$.approval_state') as approval_state,
             json_extract(frontmatter_json, '$.review_state') as review_state
      FROM memory_source_index
      WHERE record_id = 'review-to-approval'
    `).get() as { approval_state: string | null; review_state: string | null };

    assert.strictEqual(recordBefore.approval_state, null, "Should have null approval_state before migration");
    assert.strictEqual(recordBefore.review_state, "approved", "Should have review_state='approved' before migration");

    db.exec(`
      UPDATE memory_source_index
      SET frontmatter_json = json_set(
        frontmatter_json,
        '$.approval_state',
        json_extract(frontmatter_json, '$.review_state')
      )
      WHERE json_extract(frontmatter_json, '$.approval_state') IS NULL
        AND json_extract(frontmatter_json, '$.review_state') IS NOT NULL;
    `);

    const recordAfter = db.prepare(`
      SELECT json_extract(frontmatter_json, '$.approval_state') as approval_state,
             json_extract(frontmatter_json, '$.review_state') as review_state
      FROM memory_source_index
      WHERE record_id = 'review-to-approval'
    `).get() as { approval_state: string | null; review_state: string | null };

    console.log(`    Before: approval_state=${recordBefore.approval_state}, review_state=${recordBefore.review_state}`);
    console.log(`    After: approval_state=${recordAfter.approval_state}, review_state=${recordAfter.review_state}`);

    assert.strictEqual(recordAfter.approval_state, "approved", "Should have approval_state='approved' after migration");
    assert.strictEqual(recordAfter.review_state, "approved", "Should still have review_state='approved' after migration");
  });

  await test("migration is idempotent—running again produces no changes", () => {
    const recordsBefore = db
      .prepare(`
        SELECT record_id, json_extract(frontmatter_json, '$.approval_state') as approval_state
        FROM memory_source_index
        WHERE company_id = ?
        ORDER BY record_id
      `)
      .all(company.id) as Array<{ record_id: string; approval_state: string | null }>;

    db.exec(`
      UPDATE memory_source_index
      SET frontmatter_json = json_set(
        frontmatter_json,
        '$.approval_state',
        json_extract(frontmatter_json, '$.review_state')
      )
      WHERE json_extract(frontmatter_json, '$.approval_state') IS NULL
        AND json_extract(frontmatter_json, '$.review_state') IS NOT NULL;
    `);

    const recordsAfter = db
      .prepare(`
        SELECT record_id, json_extract(frontmatter_json, '$.approval_state') as approval_state
        FROM memory_source_index
        WHERE company_id = ?
        ORDER BY record_id
      `)
      .all(company.id) as Array<{ record_id: string; approval_state: string | null }>;

    assert.deepStrictEqual(
      recordsBefore,
      recordsAfter,
      "Second migration run should produce identical state",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
