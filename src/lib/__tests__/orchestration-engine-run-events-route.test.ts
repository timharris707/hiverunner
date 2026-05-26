import assert from "node:assert";
import { rmSync } from "node:fs";

import { GET as getEngineRunEventsRoute } from "@/app/api/orchestration/engine/runs/[runId]/events/route";
import { createCompany } from "@/lib/orchestration/company-service";
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

console.log("\nOrchestration Engine Run Events Route Tests\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Run Events Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Run Events Project ${stamp}`,
    description: "fixture",
    color: "#0ea5e9",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Run Events Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Analyst",
    personality: "Precise fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Run events fixture task",
    description: "Fixture task.",
    priority: "P2",
    type: "research",
    status: "review",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  const runId = `run-events-${stamp}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, status, started_at, completed_at, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', 'completed', ?, ?, '{}', ?, ?)`,
  ).run(runId, task.id, agent.id, now, now, now, now);

  db.prepare(
    `INSERT INTO memory_source_index
       (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
        file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
        hiverunner_tags_json, status, indexed_at)
     VALUES (?, ?, 'company-vault', ?, 'company', ?, ?, ?, 'markdown', ?, ?, ?, '[]', 1, '[]', 'active', ?)`,
  ).run(
    "run-events-company-match",
    company.id,
    "/tmp/memory/company/run-events.md",
    "Run events company note",
    "Company-wide note for run event diagnostics.",
    "Company-wide note for run event diagnostics.",
    now,
    JSON.stringify({ title: "Run events company note" }),
    JSON.stringify(["role:analyst"]),
    now,
  );

  const defaultRequest = {
    nextUrl: new URL(`http://localhost/api/orchestration/engine/runs/${runId}/events`),
  } as never;
  const diagnosticsRequest = {
    nextUrl: new URL(`http://localhost/api/orchestration/engine/runs/${runId}/events?includeMemoryDiagnostics=true`),
  } as never;

  await test("GET omits memory diagnostics by default", async () => {
    const res = await getEngineRunEventsRoute(defaultRequest, {
      params: Promise.resolve({ runId }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      memoryEvidence?: { diagnostics?: unknown };
    };
    assert.ok(payload.memoryEvidence, "Expected memory evidence to be included for the run");
    assert.strictEqual(payload.memoryEvidence?.diagnostics, undefined);
  });

  await test("GET includes memory diagnostics when explicitly requested", async () => {
    const res = await getEngineRunEventsRoute(diagnosticsRequest, {
      params: Promise.resolve({ runId }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      memoryEvidence?: {
        diagnostics?: {
          version: number;
          source: string;
          evidence: Array<{ recordId: string; evidenceEnvelope?: { version: number } }>;
        };
      };
    };
    assert.ok(payload.memoryEvidence, "Expected memory evidence to be included for the run");
    assert.ok(payload.memoryEvidence?.diagnostics, "Expected diagnostics when requested");
    assert.strictEqual(payload.memoryEvidence?.diagnostics?.version, 1);
    assert.strictEqual(payload.memoryEvidence?.diagnostics?.source, "memory_source_index");
    assert.ok((payload.memoryEvidence?.diagnostics?.evidence.length ?? 0) > 0);
    assert.strictEqual(payload.memoryEvidence?.diagnostics?.evidence[0]?.recordId, "run-events-company-match");
    assert.strictEqual(payload.memoryEvidence?.diagnostics?.evidence[0]?.evidenceEnvelope?.version, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
