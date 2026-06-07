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

  const noMemoryCompany = createCompany({
    name: `Run Events No Memory Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const noMemoryProject = createProject({
    companyId: noMemoryCompany.id,
    name: `Run Events No Memory Project ${stamp}`,
    description: "fixture",
    color: "#14b8a6",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const noMemoryAgent = createProjectAgent({
    projectId: noMemoryProject.id,
    name: `Run Events No Memory Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Analyst",
    personality: "Precise fixture agent without memory.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const noMemoryTask = createTask({
    projectId: noMemoryProject.id,
    title: "Run events no-memory fixture task",
    description: "Fixture task without indexed memory.",
    priority: "P2",
    type: "research",
    status: "review",
    assignee: noMemoryAgent.id,
    labels: [],
    createdBy: "test",
  }).task;
  const noMemoryRunId = `run-events-no-memory-${stamp}`;
  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, status, started_at, completed_at, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', 'completed', ?, ?, '{}', ?, ?)`,
  ).run(noMemoryRunId, noMemoryTask.id, noMemoryAgent.id, now, now, now, now);

  const secretBearer = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret";
  const secretApiKey = "sk-proj-1234567890abcdefghijklmnopqrstuv";
  const secretGithubToken = "github_pat_1234567890abcdefghijklmnopqrstuvwxyz";
  const secretPassword = "correct-horse-battery-staple";
  const secretRunId = `run-events-secret-${stamp}`;
  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, status, started_at, completed_at, token_usage_json, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, 'anthropic', 'completed', ?, ?, ?, '{}', ?, ?)`,
  ).run(
    secretRunId,
    task.id,
    agent.id,
    now,
    now,
    JSON.stringify({
      structuredTelemetry: true,
      resultText: `Provider summary included ${secretBearer} and ${secretGithubToken}.`,
      totalCostUsd: 0.02,
      inputTokens: 25,
      outputTokens: 10,
    }),
    now,
    now,
  );
  db.prepare(
    `INSERT INTO execution_run_transcript_events
       (id, execution_run_id, provider, event_kind, role, title, body, metadata_json, sequence, occurred_at, created_at)
     VALUES (?, ?, 'anthropic', 'assistant_text_final', 'assistant', 'assistant final', ?, ?, 1, ?, ?)`,
  ).run(
    `${secretRunId}-transcript`,
    secretRunId,
    `The command printed ${secretApiKey}, ${secretBearer}, and ${secretGithubToken}.`,
    JSON.stringify({
      env: {
        OPENAI_API_KEY: secretApiKey,
        NORMAL_ENV: "visible-route-env",
      },
      password: secretPassword,
    }),
    now,
    now,
  );

  const defaultRequest = {
    nextUrl: new URL(`http://localhost/api/orchestration/engine/runs/${runId}/events`),
  } as never;
  const diagnosticsRequest = {
    nextUrl: new URL(`http://localhost/api/orchestration/engine/runs/${runId}/events?includeMemoryDiagnostics=true`),
  } as never;
  const noMemoryRequest = {
    nextUrl: new URL(`http://localhost/api/orchestration/engine/runs/${noMemoryRunId}/events`),
  } as never;
  const secretRequest = {
    nextUrl: new URL(`http://localhost/api/orchestration/engine/runs/${secretRunId}/events`),
  } as never;

  await test("GET omits memory diagnostics by default", async () => {
    const res = await getEngineRunEventsRoute(defaultRequest, {
      params: Promise.resolve({ runId }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      memoryEvidence?: { diagnostics?: unknown };
      trace?: {
        schema?: string;
        captureQuality?: { label?: string; missingRequiredEvidence?: string[] };
        evidenceGaps?: Array<{ id: string; label: string }>;
        annotations?: { schema?: string; state?: string; annotations?: unknown[]; decision?: { reason?: string } };
      };
      traceExport?: {
        schema?: string;
        summary?: { copyText?: string; annotationCount?: number };
        redaction?: { location?: string; totalRedactions?: number };
        annotations?: { state?: string; annotations?: unknown[]; decision?: { reason?: string } };
      };
    };
    assert.ok(payload.memoryEvidence, "Expected memory evidence to be included for the run");
    assert.strictEqual(payload.memoryEvidence?.diagnostics, undefined);
    assert.strictEqual(payload.trace?.schema, "hiverunner.run_trace_view.v1");
    assert.strictEqual(payload.trace?.captureQuality?.label, "partial");
    assert.ok(payload.trace?.captureQuality?.missingRequiredEvidence?.includes("missing_transcript"));
    assert.ok(payload.trace?.evidenceGaps?.some((gap) => gap.id === "missing_raw_payload" && gap.label === "not_captured"));
    assert.strictEqual(payload.trace?.annotations?.schema, "hiverunner.run_trace_annotations.v1");
    assert.strictEqual(payload.trace?.annotations?.state, "deferred");
    assert.deepStrictEqual(payload.trace?.annotations?.annotations, []);
    assert.strictEqual(payload.traceExport?.schema, "hiverunner.run_trace_redacted_export.v1");
    assert.strictEqual(payload.traceExport?.redaction?.location, "server");
    assert.strictEqual(payload.traceExport?.summary?.annotationCount, 0);
    assert.strictEqual(payload.traceExport?.annotations?.state, "deferred");
    assert.match(payload.traceExport?.annotations?.decision?.reason ?? "", /clean run-scoped persistence\/API path/);
    assert.ok(payload.traceExport?.summary?.copyText?.includes(`Run: ${runId}`));
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

  await test("GET trace keeps empty memory evidence containers as missing evidence", async () => {
    const res = await getEngineRunEventsRoute(noMemoryRequest, {
      params: Promise.resolve({ runId: noMemoryRunId }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      memoryEvidence?: {
        injectionSource?: string;
        evidence?: unknown[];
      };
      trace?: {
        evidenceSummary?: { hasMemoryEvidence?: boolean };
        evidenceGaps?: Array<{ id: string; label: string }>;
      };
    };

    assert.strictEqual(payload.memoryEvidence?.injectionSource, "none");
    assert.deepStrictEqual(payload.memoryEvidence?.evidence, []);
    assert.strictEqual(payload.trace?.evidenceSummary?.hasMemoryEvidence, false);
    assert.ok(payload.trace?.evidenceGaps?.some((gap) =>
      gap.id === "missing_memory_evidence" &&
      gap.label === "not_captured"
    ));
  });

  await test("GET redacted trace export removes secrets at route boundary", async () => {
    const res = await getEngineRunEventsRoute(secretRequest, {
      params: Promise.resolve({ runId: secretRunId }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      traceExport?: {
        schema?: string;
        redaction?: {
          totalRedactions?: number;
          categories?: {
            bearer_token?: { count?: number };
            api_key?: { count?: number };
            sensitive_field?: { count?: number };
          };
        };
        transcript?: { entries?: Array<{ metadata?: { env?: { NORMAL_ENV?: string } } }> };
      };
    };
    const exportPayload = payload.traceExport;
    const serialized = JSON.stringify(exportPayload);

    assert.strictEqual(exportPayload?.schema, "hiverunner.run_trace_redacted_export.v1");
    assert.strictEqual(exportPayload?.transcript?.entries?.[0]?.metadata?.env?.NORMAL_ENV, "visible-route-env");
    assert.ok((exportPayload?.redaction?.totalRedactions ?? 0) >= 5);
    assert.ok((exportPayload?.redaction?.categories?.bearer_token?.count ?? 0) >= 1);
    assert.ok((exportPayload?.redaction?.categories?.api_key?.count ?? 0) >= 2);
    assert.ok((exportPayload?.redaction?.categories?.sensitive_field?.count ?? 0) >= 2);
    assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._-]+/i);
    assert.doesNotMatch(serialized, /sk-proj-[A-Za-z0-9_-]+/);
    assert.doesNotMatch(serialized, /github_pat_[A-Za-z0-9_]+/);
    assert.doesNotMatch(serialized, new RegExp(secretPassword));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
