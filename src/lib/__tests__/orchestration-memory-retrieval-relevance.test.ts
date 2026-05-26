import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-memory-retrieval-relevance-${Date.now()}.db`,
  );
}

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
  console.log("\nOrchestration Memory Retrieval Relevance Weighting Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH!;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { buildMemoryContext } = await import("@/lib/orchestration/memory-context");
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Relevance Co ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Relevance Project ${stamp}`,
    description: "fixture project",
    color: "#22c55e",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Relevance Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Implementation Engineer",
    personality: "Precise.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const focusedTask = createTask({
    projectId: project.id,
    title: "Improve memory retrieval relevance weighting",
    description:
      "Improve retrieval relevance weighting so broad fixture-like memories do not dominate ordinary lead-agent prompts.",
    priority: "P1",
    type: "feature",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  function insert(input: {
    id: string;
    title: string;
    layer?: string;
    frontmatter?: Record<string, unknown>;
    tags?: string[];
    linkedIds?: string[];
    body?: string;
    sourcePath?: string;
    indexedAt?: string;
    fileMtime?: string;
  }) {
    db.prepare(`
      INSERT INTO memory_source_index
        (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
         file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
         hiverunner_tags_json, status, indexed_at)
      VALUES (?, ?, 'company-vault', ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, 0, '[]', 'active', ?)
    `).run(
      input.id,
      company.id,
      input.sourcePath ?? `/tmp/relevance/${input.id}.md`,
      input.layer ?? "company",
      input.title,
      input.body ?? `${input.title} body`,
      input.body ?? `${input.title} body`,
      input.fileMtime ?? new Date().toISOString(),
      JSON.stringify({
        review_state: "approved",
        confidence: 0.95,
        ...(input.frontmatter ?? {}),
      }),
      JSON.stringify(input.tags ?? ["role:implementation"]),
      JSON.stringify(input.linkedIds ?? []),
      input.indexedAt ?? new Date().toISOString(),
    );
  }

  await test("focused task-linked memory ranks above broad/fixture-like memories", () => {
    // Broad fixture-like memories with full quality (approved, recent, provenance)
    // but NO linkage to the focused task. Inserted newest so they would win on
    // recency alone under the old quality-only scoring.
    insert({
      id: "broad-recent-a",
      title: "General Sprint 2 evidence overview",
      body: "Background context on memory evidence hardening rituals across the sprint.",
      frontmatter: { project_id: "other-project", source_task_key: "INS-999" },
      linkedIds: ["INS-999"],
      indexedAt: new Date(Date.now() - 1_000).toISOString(),
    });
    insert({
      id: "broad-recent-b",
      title: "Generic operator notes",
      body: "Notes about the operator-facing dashboard polish lane.",
      frontmatter: { source_task_key: "INS-901" },
      linkedIds: ["INS-901"],
      indexedAt: new Date(Date.now() - 2_000).toISOString(),
    });
    insert({
      id: "broad-recent-c",
      title: "Broad smoke benchmark notes",
      body: "Notes on benchmark fixtures for Gemini smoke.",
      frontmatter: { source_task_key: "INS-902" },
      linkedIds: ["INS-902"],
      indexedAt: new Date(Date.now() - 3_000).toISOString(),
    });

    // Task-specific memory, intentionally inserted *older* so the only way it
    // can rank first is via the new relevance boost.
    const focusedTaskKey = focusedTask.key ?? "";
    assert.ok(focusedTaskKey, "focusedTask.key must be populated for fixture");
    insert({
      id: "task-linked-direct",
      title: "INS-145 design note",
      body: "Design note for INS-145: relevance boost weights for task-key, sprint, and project linkage.",
      frontmatter: { source_task_key: focusedTaskKey, project_id: project.id, confidence: 0.95, review_state: "approved" },
      linkedIds: [focusedTaskKey],
      indexedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      fileMtime: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    });

    const before = buildMemoryContext({
      db,
      companyId: company.id,
      agentId: agent.id,
      agentRole: agent.role,
      projectId: project.id,
      limit: 10,
    });
    assert.ok(before);
    const beforeOrder = before.evidence.map((e) => e.recordId);
    // Without focus, the older task-linked record does NOT bubble to the top
    // (broad recent memories with same quality score win on recency tiebreaker).
    assert.notStrictEqual(beforeOrder[0], "task-linked-direct");

    const after = buildMemoryContext({
      db,
      companyId: company.id,
      agentId: agent.id,
      agentRole: agent.role,
      projectId: project.id,
      limit: 10,
      focus: {
        taskKey: focusedTaskKey,
        taskTitle: focusedTask.title,
        taskDescription: focusedTask.description,
      },
    });
    assert.ok(after);
    const afterOrder = after.evidence.map((e) => e.recordId);
    assert.strictEqual(afterOrder[0], "task-linked-direct", `expected task-linked-direct first, got ${afterOrder.join(",")}`);

    const taskLinked = after.evidence.find((e) => e.recordId === "task-linked-direct");
    assert.ok(taskLinked);
    assert.ok(
      taskLinked.inclusionReasons.some((r) => r.includes("task linkage matched")),
      `expected task linkage reason on task-linked-direct, got: ${taskLinked.inclusionReasons.join(" | ")}`,
    );
  });

  await test("body mention of focused task key beats unrelated broad memories", () => {
    const stamp2 = Date.now();
    const isolatedCompany = createCompany({
      name: `Relevance Mention Co ${stamp2}`,
      description: "fixture",
      status: "active",
    }).company;
    const isolatedProject = createProject({
      companyId: isolatedCompany.id,
      name: `Relevance Mention Project ${stamp2}`,
      description: "fixture",
      color: "#a855f7",
      emoji: "icon:folder",
      status: "active",
    }).project;
    const isolatedAgent = createProjectAgent({
      projectId: isolatedProject.id,
      name: `Relevance Mention Agent ${stamp2}`,
      emoji: "icon:bot",
      role: "Implementation Engineer",
      personality: "Precise.",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const focusedTask2 = createTask({
      projectId: isolatedProject.id,
      title: "Wire INS-200 retrieval boost",
      description: "Wire INS-200 retrieval boost path for sprint focus.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: isolatedAgent.id,
      labels: [],
      createdBy: "test",
    }).task;

    function insertInIsolated(input: {
      id: string;
      title: string;
      body?: string;
      frontmatter?: Record<string, unknown>;
      tags?: string[];
      indexedAt?: string;
    }) {
      db.prepare(`
        INSERT INTO memory_source_index
          (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
           file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
           hiverunner_tags_json, status, indexed_at)
        VALUES (?, ?, 'company-vault', ?, 'company', ?, ?, ?, 'markdown', ?, ?, ?, '[]', 0, '[]', 'active', ?)
      `).run(
        input.id,
        isolatedCompany.id,
        `/tmp/relevance-mention/${input.id}.md`,
        input.title,
        input.body ?? `${input.title} body`,
        input.body ?? `${input.title} body`,
        new Date().toISOString(),
        JSON.stringify({ review_state: "approved", confidence: 0.95, ...(input.frontmatter ?? {}) }),
        JSON.stringify(input.tags ?? ["role:implementation"]),
        input.indexedAt ?? new Date().toISOString(),
      );
    }

    insertInIsolated({
      id: "mention-broad-a",
      title: "Broad evidence general",
      body: "General sprint background notes.",
      frontmatter: { source_task_key: "INS-700" },
      indexedAt: new Date(Date.now() - 1_000).toISOString(),
    });
    insertInIsolated({
      id: "mention-broad-b",
      title: "Broad operator notes",
      body: "Generic operator notes.",
      frontmatter: { source_task_key: "INS-701" },
      indexedAt: new Date(Date.now() - 2_000).toISOString(),
    });
    insertInIsolated({
      id: "mention-target",
      title: "Stray retrieval note",
      body: `Earlier exploration mentioning INS-200 in the prose only; no frontmatter linkage.`,
      frontmatter: { source_task_key: "INS-XYZ" },
      indexedAt: new Date(Date.now() - 3_000).toISOString(),
    });

    const focusedTask2Key = focusedTask2.key ?? "";
    assert.ok(focusedTask2Key);
    const context = buildMemoryContext({
      db,
      companyId: isolatedCompany.id,
      agentId: isolatedAgent.id,
      agentRole: isolatedAgent.role,
      projectId: isolatedProject.id,
      limit: 10,
      focus: {
        taskKey: focusedTask2Key,
        taskTitle: focusedTask2.title,
        taskDescription: focusedTask2.description,
      },
    });
    assert.ok(context);
    const order = context.evidence.map((e) => e.recordId);
    assert.strictEqual(order[0], "mention-target", `expected mention-target first, got ${order.join(",")}`);
    const target = context.evidence.find((e) => e.recordId === "mention-target");
    assert.ok(target);
    assert.ok(
      target.inclusionReasons.some((r) => r.includes("mentioned in memory title/body/path") || r.includes("shares")),
      `expected mention reason on mention-target, got: ${target.inclusionReasons.join(" | ")}`,
    );
  });

  await test("sprint match boosts a memory over equally-clean unrelated memories", () => {
    const stamp3 = Date.now() + 1;
    const sprintCompany = createCompany({
      name: `Relevance Sprint Co ${stamp3}`,
      description: "fixture",
      status: "active",
    }).company;
    const sprintProject = createProject({
      companyId: sprintCompany.id,
      name: `Relevance Sprint Project ${stamp3}`,
      description: "fixture",
      color: "#f97316",
      emoji: "icon:folder",
      status: "active",
    }).project;
    const sprintAgent = createProjectAgent({
      projectId: sprintProject.id,
      name: `Relevance Sprint Agent ${stamp3}`,
      emoji: "icon:bot",
      role: "Implementation Engineer",
      personality: "Precise.",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;

    function insertSprint(input: {
      id: string;
      title: string;
      body?: string;
      frontmatter?: Record<string, unknown>;
      tags?: string[];
      indexedAt?: string;
    }) {
      db.prepare(`
        INSERT INTO memory_source_index
          (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
           file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
           hiverunner_tags_json, status, indexed_at)
        VALUES (?, ?, 'company-vault', ?, 'company', ?, ?, ?, 'markdown', ?, ?, ?, '[]', 0, '[]', 'active', ?)
      `).run(
        input.id,
        sprintCompany.id,
        `/tmp/relevance-sprint/${input.id}.md`,
        input.title,
        input.body ?? `${input.title} body`,
        input.body ?? `${input.title} body`,
        new Date().toISOString(),
        JSON.stringify({ review_state: "approved", confidence: 0.95, ...(input.frontmatter ?? {}) }),
        JSON.stringify(input.tags ?? ["role:implementation"]),
        input.indexedAt ?? new Date().toISOString(),
      );
    }

    insertSprint({
      id: "sprint-other",
      title: "Unrelated archive note",
      body: "Unrelated archive note body.",
      frontmatter: { source_task_key: "INS-800" },
      indexedAt: new Date(Date.now() - 1_000).toISOString(),
    });
    insertSprint({
      id: "sprint-target",
      title: "Sprint 2 evidence checklist",
      body: "Body content about the sprint 2 evidence checklist.",
      tags: ["role:implementation", "sprint2"],
      frontmatter: { source_task_key: "INS-801" },
      indexedAt: new Date(Date.now() - 2_000).toISOString(),
    });

    const context = buildMemoryContext({
      db,
      companyId: sprintCompany.id,
      agentId: sprintAgent.id,
      agentRole: sprintAgent.role,
      projectId: sprintProject.id,
      limit: 10,
      focus: { sprintSlug: "sprint2" },
    });
    assert.ok(context);
    const order = context.evidence.map((e) => e.recordId);
    assert.strictEqual(order[0], "sprint-target", `expected sprint-target first, got ${order.join(",")}`);
  });

  await test("task-linked memory survives recency prefilter at scale", () => {
    const stamp4 = Date.now() + 2;
    const scaleCompany = createCompany({
      name: `Relevance Scale Co ${stamp4}`,
      description: "fixture",
      status: "active",
    }).company;
    const scaleProject = createProject({
      companyId: scaleCompany.id,
      name: `Relevance Scale Project ${stamp4}`,
      description: "fixture",
      color: "#0ea5e9",
      emoji: "icon:folder",
      status: "active",
    }).project;
    const scaleAgent = createProjectAgent({
      projectId: scaleProject.id,
      name: `Relevance Scale Agent ${stamp4}`,
      emoji: "icon:bot",
      role: "Implementation Engineer",
      personality: "Precise.",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const focusedTask4 = createTask({
      projectId: scaleProject.id,
      title: "Improve scale retrieval",
      description: "Focused task INS-SCALE for scale retrieval relevance regression.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: scaleAgent.id,
      labels: [],
      createdBy: "test",
    }).task;

    function insertScale(input: {
      id: string;
      title: string;
      body?: string;
      frontmatter?: Record<string, unknown>;
      tags?: string[];
      linkedIds?: string[];
      indexedAt: string;
    }) {
      db.prepare(`
        INSERT INTO memory_source_index
          (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
           file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
           hiverunner_tags_json, status, indexed_at)
        VALUES (?, ?, 'company-vault', ?, 'company', ?, ?, ?, 'markdown', ?, ?, ?, ?, 0, '[]', 'active', ?)
      `).run(
        input.id,
        scaleCompany.id,
        `/tmp/relevance-scale/${input.id}.md`,
        input.title,
        input.body ?? `${input.title} body`,
        input.body ?? `${input.title} body`,
        input.indexedAt,
        JSON.stringify({ review_state: "approved", confidence: 0.95, ...(input.frontmatter ?? {}) }),
        JSON.stringify(input.tags ?? ["role:implementation"]),
        JSON.stringify(input.linkedIds ?? []),
        input.indexedAt,
      );
    }

    // Insert 60 broad recent memories — well beyond the limit*2=20 recency window.
    // The task-linked memory is the OLDEST record by 30 days, so a recency-only
    // prefilter at any reasonable window will exclude it.
    for (let i = 0; i < 60; i += 1) {
      insertScale({
        id: `scale-broad-${String(i).padStart(3, "0")}`,
        title: `Broad recent note ${i}`,
        body: `Unrelated background content batch ${i}.`,
        frontmatter: { source_task_key: `INS-9${String(i).padStart(2, "0")}` },
        linkedIds: [`INS-9${String(i).padStart(2, "0")}`],
        indexedAt: new Date(Date.now() - i * 60_000).toISOString(),
      });
    }

    const focusedTaskKey4 = focusedTask4.key ?? "";
    assert.ok(focusedTaskKey4);
    insertScale({
      id: "scale-task-linked",
      title: "Old task-linked design note",
      body: `Design note linked to ${focusedTaskKey4}. Predates the recent broad batch.`,
      frontmatter: { source_task_key: focusedTaskKey4, project_id: scaleProject.id },
      linkedIds: [focusedTaskKey4],
      indexedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });

    // Limit of 10 → recency window is limit*2 = 20, far smaller than the 60
    // broad records inserted before the task-linked one. Without focus-aware
    // widening, the task-linked record is invisible to the scorer.
    const context = buildMemoryContext({
      db,
      companyId: scaleCompany.id,
      agentId: scaleAgent.id,
      agentRole: scaleAgent.role,
      projectId: scaleProject.id,
      limit: 10,
      focus: {
        taskKey: focusedTaskKey4,
        taskTitle: focusedTask4.title,
        taskDescription: focusedTask4.description,
      },
    });
    assert.ok(context);
    const order = context.evidence.map((e) => e.recordId);
    assert.strictEqual(
      order[0],
      "scale-task-linked",
      `expected scale-task-linked first even past recency window, got ${order.slice(0, 3).join(",")}`,
    );

    const taskLinked = context.evidence.find((e) => e.recordId === "scale-task-linked");
    assert.ok(taskLinked);
    assert.ok(
      taskLinked.inclusionReasons.some((r) => r.includes("task linkage matched")),
      `expected task linkage reason on scale-task-linked, got: ${taskLinked.inclusionReasons.join(" | ")}`,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
