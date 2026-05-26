import assert from "node:assert";
import { rmSync } from "node:fs";

import { GET as getMemoryEvidenceRoute } from "@/app/api/orchestration/companies/[slug]/memory/evidence/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { createCompanyMemoryRecord } from "@/lib/orchestration/company-memory";
import { getOrchestrationDb } from "@/lib/orchestration/db";
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
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}`);
      console.error(`    ${message}`);
    });
}

function getRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}

async function run() {
  console.log("\nOrchestration Memory Evidence Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Memory Evidence Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const otherCompany = createCompany({
    name: `Memory Evidence Other ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Memory Evidence Project ${stamp}`,
    description: "fixture project",
    color: "#22d3ee",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const otherProject = createProject({
    companyId: otherCompany.id,
    name: `Memory Evidence Other Project ${stamp}`,
    description: "fixture project",
    color: "#ef4444",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Memory Evidence Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Researcher",
    personality: "Precise test fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const otherAgent = createProjectAgent({
    projectId: otherProject.id,
    name: `Memory Evidence Other Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Researcher",
    personality: "Precise test fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Run with injected memory",
    description: "Fixture task.",
    priority: "P2",
    type: "research",
    status: "review",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;
  const otherTask = createTask({
    projectId: otherProject.id,
    title: "Other company run",
    description: "Fixture task.",
    priority: "P2",
    type: "research",
    status: "review",
    assignee: otherAgent.id,
    labels: [],
    createdBy: "test",
  }).task;

  const runId = `memory-evidence-run-${stamp}`;
  const otherRunId = `memory-evidence-other-run-${stamp}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, status, started_at, completed_at, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', 'completed', ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    task.id,
    agent.id,
    now,
    now,
    JSON.stringify({
      injected_memory_sha256: "test-hash",
      injectedMemoryEvidence: {
        source: "memory_source_index",
        recordCount: 1,
        records: [{
          recordId: "idx-company-match",
          title: "Recorded Runtime Note",
          sourcePath: "/tmp/memory/company/operating-rule.md",
          layer: "company",
          inclusionReasons: ["stored run evidence, not recomputed at read time"],
        }],
      },
    }),
    now,
    now,
  );
  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, status, started_at, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', 'running', ?, '{}', ?, ?)`,
  ).run(otherRunId, otherTask.id, otherAgent.id, now, now, now);

  db.prepare(
    `INSERT INTO memory_source_index
       (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
        file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
        hiverunner_tags_json, status, indexed_at)
     VALUES (?, ?, 'company-vault', ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, '[]', ?, '[]', 'active', ?)`,
  ).run(
    "idx-company-match",
    company.id,
    "/tmp/memory/company/operating-rule.md",
    "company",
    "Operating rule",
    "Use source workspaces for edits.",
    "Use source workspaces for edits.",
    now,
    JSON.stringify({ title: "Operating rule" }),
    JSON.stringify(["role:researcher"]),
    1,
    now,
  );
  db.prepare(
    `INSERT INTO memory_source_index
       (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
        file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
        hiverunner_tags_json, status, indexed_at)
     VALUES (?, ?, 'company-vault', ?, 'company', ?, ?, ?, 'markdown', ?, '{}', '[]', '[]', 0, '[]', 'active', ?)`,
  ).run(
    "idx-cross-company",
    otherCompany.id,
    "/tmp/memory/other/leak.md",
    "Cross-company secret",
    "This must not appear.",
    "This must not appear.",
    now,
    now,
  );

  await test("GET returns company-scoped indexed memory evidence for a completed run", async () => {
    const res = await getMemoryEvidenceRoute(
      getRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory/evidence?executionRunId=${runId}`) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      injectionSource: string;
      run: { id: string; injectedMemorySha256: string | null };
      evidence: Array<{ recordId: string; title: string; sourcePath: string | null; layer: string; reason: string; source: { type: string; tags?: string[] } }>;
    };
    assert.strictEqual(payload.injectionSource, "vault_index");
    assert.strictEqual(payload.run.id, runId);
    assert.strictEqual(payload.run.injectedMemorySha256, "test-hash");
    assert.strictEqual(payload.evidence.length, 1);
    assert.strictEqual(payload.evidence[0].recordId, "idx-company-match");
    assert.strictEqual(payload.evidence[0].title, "Recorded Runtime Note");
    assert.strictEqual(payload.evidence[0].sourcePath, "/tmp/memory/company/operating-rule.md");
    assert.strictEqual(payload.evidence[0].layer, "company");
    assert.match(payload.evidence[0].reason, /stored run evidence/);
    assert.strictEqual(payload.evidence[0].source.type, "memory_source_index");
    assert.deepStrictEqual(payload.evidence[0].source.tags, ["role:researcher"]);
    assert.strictEqual((payload as { diagnostics?: unknown }).diagnostics, undefined);
  });

  await test("GET can include versioned diagnostics with envelopes and quality data on demand", async () => {
    const res = await getMemoryEvidenceRoute(
      getRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory/evidence?executionRunId=${runId}&includeDiagnostics=true`) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      diagnostics?: {
        version: number;
        source: string;
        quality: { status: string; score: number; warnings: unknown[]; refusals: unknown[] };
        evidence: Array<{
          recordId: string;
          title: string;
          sourcePath: string | null;
          layer: string;
          inclusionReasons: string[];
          evidenceEnvelope: { version: number; envelopeId: string; companyId: string; recordId: string; retrievalRank: number };
        }>;
      };
    };

    assert.ok(payload.diagnostics);
    assert.strictEqual(payload.diagnostics?.version, 1);
    assert.strictEqual(payload.diagnostics?.source, "memory_source_index");
    assert.strictEqual(payload.diagnostics?.quality.status, "degraded");
    assert.ok((payload.diagnostics?.quality.warnings.length ?? 0) > 0);
    assert.strictEqual(payload.diagnostics?.evidence.length, 1);
    assert.strictEqual(payload.diagnostics?.evidence[0].recordId, "idx-company-match");
    assert.strictEqual(payload.diagnostics?.evidence[0].evidenceEnvelope.version, 1);
    assert.strictEqual(payload.diagnostics?.evidence[0].evidenceEnvelope.companyId, company.id);
    assert.strictEqual(payload.diagnostics?.evidence[0].evidenceEnvelope.recordId, "idx-company-match");
    assert.strictEqual(payload.diagnostics?.evidence[0].evidenceEnvelope.retrievalRank, 1);
  });

  await test("GET rejects a run from another company slug", async () => {
    const res = await getMemoryEvidenceRoute(
      getRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory/evidence?executionRunId=${otherRunId}`) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 404);
    const payload = await res.json() as { error?: { code?: string } };
    assert.strictEqual(payload.error?.code, "execution_run_not_found");
  });

  await test("GET falls back to active company memory records when no index evidence matches", async () => {
    const fallbackCompany = createCompany({
      name: `Memory Evidence Fallback ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;
    const fallbackProject = createProject({
      companyId: fallbackCompany.id,
      name: `Memory Evidence Fallback Project ${stamp}`,
      description: "fixture project",
      color: "#14b8a6",
      emoji: "icon:folder",
      status: "active",
    }).project;
    const fallbackAgent = createProjectAgent({
      projectId: fallbackProject.id,
      name: `Memory Evidence Fallback Agent ${stamp}`,
      emoji: "icon:bot",
      role: "Analyst",
      personality: "Precise test fixture agent.",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const fallbackTask = createTask({
      projectId: fallbackProject.id,
      title: "Run with registry memory",
      description: "Fixture task.",
      priority: "P2",
      type: "research",
      status: "review",
      assignee: fallbackAgent.id,
      labels: [],
      createdBy: "test",
    }).task;
    const fallbackRunId = `memory-evidence-fallback-run-${stamp}`;
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, status, started_at, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, 'codex', 'running', ?, '{}', ?, ?)`,
    ).run(fallbackRunId, fallbackTask.id, fallbackAgent.id, now, now, now);
    const memory = createCompanyMemoryRecord(fallbackCompany.id, {
      title: "Analyst workflow note",
      body: "Analysts should preserve task evidence before summarizing.",
      kind: "workflow_note",
      scope: "project",
      status: "active",
      reviewRequired: false,
      source: "manual",
      confidence: 0.9,
      projectId: fallbackProject.id,
      metadata: { tags: ["role:analyst"], sourcePath: "/tmp/memory/fallback/workflow.md" },
    }).memory;

    const res = await getMemoryEvidenceRoute(
      getRequest(`http://localhost/api/orchestration/companies/${fallbackCompany.code}/memory/evidence?runId=${fallbackRunId}`) as never,
      { params: Promise.resolve({ slug: fallbackCompany.code }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      injectionSource: string;
      evidence: Array<{ recordId: string; layer: string; sourcePath: string | null; reason: string; source: { type: string; kind?: string; metadata?: { tags?: string[] } } }>;
    };
    assert.strictEqual(payload.injectionSource, "memory_registry_fallback");
    assert.strictEqual(payload.evidence.length, 1);
    assert.strictEqual(payload.evidence[0].recordId, memory.id);
    assert.strictEqual(payload.evidence[0].layer, "project");
    assert.strictEqual(payload.evidence[0].sourcePath, "/tmp/memory/fallback/workflow.md");
    assert.match(payload.evidence[0].reason, /project scope matched/);
    assert.strictEqual(payload.evidence[0].source.type, "company_memory_record");
    assert.strictEqual(payload.evidence[0].source.kind, "workflow_note");
    assert.deepStrictEqual(payload.evidence[0].source.metadata?.tags, ["role:analyst"]);
  });

  await test("GET omits diagnostics on legacy-compatible fallback responses", async () => {
    const fallbackCompany = createCompany({
      name: `Memory Evidence Legacy ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;
    const fallbackProject = createProject({
      companyId: fallbackCompany.id,
      name: `Memory Evidence Legacy Project ${stamp}`,
      description: "fixture project",
      color: "#14b8a6",
      emoji: "icon:folder",
      status: "active",
    }).project;
    const fallbackAgent = createProjectAgent({
      projectId: fallbackProject.id,
      name: `Memory Evidence Legacy Agent ${stamp}`,
      emoji: "icon:bot",
      role: "Analyst",
      personality: "Precise test fixture agent.",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const fallbackTask = createTask({
      projectId: fallbackProject.id,
      title: "Run with registry memory legacy",
      description: "Fixture task.",
      priority: "P2",
      type: "research",
      status: "review",
      assignee: fallbackAgent.id,
      labels: [],
      createdBy: "test",
    }).task;
    const fallbackRunId = `memory-evidence-legacy-run-${stamp}`;
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, status, started_at, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, 'codex', 'running', ?, '{}', ?, ?)`,
    ).run(fallbackRunId, fallbackTask.id, fallbackAgent.id, now, now, now);
    createCompanyMemoryRecord(fallbackCompany.id, {
      title: "Analyst legacy note",
      body: "Legacy response should not expose diagnostics unless requested.",
      kind: "workflow_note",
      scope: "project",
      status: "active",
      reviewRequired: false,
      source: "manual",
      confidence: 0.9,
      projectId: fallbackProject.id,
      metadata: { tags: ["role:analyst"], sourcePath: "/tmp/memory/fallback/legacy.md" },
    });

    const res = await getMemoryEvidenceRoute(
      getRequest(`http://localhost/api/orchestration/companies/${fallbackCompany.code}/memory/evidence?runId=${fallbackRunId}`) as never,
      { params: Promise.resolve({ slug: fallbackCompany.code }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { diagnostics?: unknown };
    assert.strictEqual(payload.diagnostics, undefined);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
