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
  const proofManifestSha = "b".repeat(64);
  const proofManifestPath = `/tmp/hiverunner-browser-proof/${runId}/manifest.json`;
  const proofManifestUri = `file://${proofManifestPath}`;
  db.prepare(
    `UPDATE tasks
        SET artifact_uri = ?,
            artifact_kind = 'file',
            artifact_sha256 = ?,
            artifact_registered_at = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(proofManifestUri, proofManifestSha, now, now, task.id);
  db.prepare(
    `INSERT INTO runtime_browser_proof_audit
       (id, company_id, agent_id, task_id, task_key, heartbeat_run_id, execution_run_id,
        status, exit_code, duration_ms, base_url, project, command, artifact_dir,
        manifest_path, manifest_sha256, artifact_count, screenshot_count, video_count,
        specs_json, urls_json, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 'succeeded', 0, 4200, ?, 'chromium', ?, ?,
             ?, ?, 3, 2, 1, ?, ?, ?)`,
  ).run(
    `proof-${runId}`,
    company.id,
    agent.id,
    task.id,
    task.key,
    runId,
    "http://localhost:3000",
    "BASE_URL=http://localhost:3000 playwright test e2e/run-events.spec.ts --project=chromium",
    `/tmp/hiverunner-browser-proof/${runId}`,
    proofManifestPath,
    proofManifestSha,
    JSON.stringify(["e2e/run-events.spec.ts"]),
    JSON.stringify([{ path: "/INS/tasks", label: "tasks" }]),
    now,
  );

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

  const traceFidelityRunId = `run-events-trace-fidelity-${stamp}`;
  const traceFidelitySecret = "sk-proj-abcdef1234567890abcdef1234567890";
  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, status, started_at, completed_at, token_usage_json, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', 'completed', ?, ?, ?, '{}', ?, ?)`,
  ).run(
    traceFidelityRunId,
    task.id,
    agent.id,
    now,
    now,
    JSON.stringify({ structuredTelemetry: true, totalCostUsd: 0.03, inputTokens: 10, outputTokens: 5 }),
    now,
    now,
  );
  const traceFidelityEvents = [
    {
      id: `${traceFidelityRunId}-command`,
      kind: "command_start",
      role: "system",
      title: "codex exec",
      body: `codex exec ${traceFidelitySecret}`,
      metadata: {
        schema: "hiverunner.live_runtime_event.v1",
        payload: { command: `codex exec ${traceFidelitySecret}`, cwd: "/tmp/run-trace", argv: ["codex", "exec"] },
      },
    },
    {
      id: `${traceFidelityRunId}-stdout`,
      kind: "stdout_chunk",
      role: "tool",
      title: "stdout",
      body: `hello ${traceFidelitySecret}`,
      metadata: {
        schema: "hiverunner.live_runtime_event.v1",
        payload: { chunk: `hello ${traceFidelitySecret}`, byteLength: 12 },
      },
    },
    {
      id: `${traceFidelityRunId}-stderr`,
      kind: "stderr_chunk",
      role: "tool",
      title: "stderr",
      body: "warning line",
      metadata: {
        schema: "hiverunner.live_runtime_event.v1",
        payload: { chunk: "warning line", byteLength: 12 },
      },
    },
    {
      id: `${traceFidelityRunId}-spawned`,
      kind: "process_spawned",
      role: "system",
      title: "process spawned",
      body: "pid 9898",
      metadata: {
        schema: "hiverunner.live_runtime_event.v1",
        payload: { pid: 9898, command: "codex", cwd: "/tmp/run-trace" },
      },
    },
    {
      id: `${traceFidelityRunId}-exit`,
      kind: "process_exit",
      role: "system",
      title: "process exited",
      body: "exit 0",
      metadata: {
        schema: "hiverunner.live_runtime_event.v1",
        payload: { pid: 9898, exitCode: 0, durationMs: 1200 },
      },
    },
    {
      id: `${traceFidelityRunId}-provider`,
      kind: "provider_event",
      role: "system",
      title: "Codex process started",
      body: "raw provider lifecycle",
      metadata: { type: "process.started", raw: { ok: true } },
    },
    {
      id: `${traceFidelityRunId}-unknown`,
      kind: "custom_provider_delta",
      role: "system",
      title: "Custom provider delta",
      body: "provider-specific delta",
      metadata: { type: "custom.delta" },
    },
    {
      id: `${traceFidelityRunId}-tool-start`,
      kind: "tool_call_start",
      role: "tool",
      title: "shell",
      body: "running npm test",
      metadata: { toolCallId: "tool-1", toolName: "shell", input: { command: "npm test" } },
    },
    {
      id: `${traceFidelityRunId}-tool-result`,
      kind: "tool_result",
      role: "tool",
      title: "shell",
      body: "tests passed",
      metadata: { toolCallId: "tool-1", toolName: "shell", isError: false },
    },
  ];
  const traceFidelityInsert = db.prepare(
    `INSERT INTO execution_run_transcript_events
       (id, execution_run_id, provider, event_kind, role, title, body, metadata_json, sequence, occurred_at, created_at)
     VALUES (?, ?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  traceFidelityEvents.forEach((event, index) => {
    traceFidelityInsert.run(
      event.id,
      traceFidelityRunId,
      event.kind,
      event.role,
      event.title,
      event.body,
      JSON.stringify(event.metadata),
      index + 1,
      new Date(Date.parse(now) + index).toISOString(),
      now,
    );
  });

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
  const traceFidelityRequest = {
    nextUrl: new URL(`http://localhost/api/orchestration/engine/runs/${traceFidelityRunId}/events`),
  } as never;

  let suggestionFixtureCounter = 0;
  function createSuggestionFixture(options: {
    label: string;
    taskStatus: "done" | "in-progress" | "blocked" | "review";
    runStatus?: "completed" | "failed";
    reviewToStatus?: "done" | "in_progress" | "to-do" | "blocked";
  }) {
    suggestionFixtureCounter += 1;
    const sourceTask = createTask({
      projectId: project.id,
      title: `Eval suggestion ${options.label}`,
      description: "Eval suggestion fixture.",
      priority: "P2",
      type: "feature",
      status: options.taskStatus,
      assignee: agent.id,
      labels: [],
      createdBy: "test",
    }).task;
    const sourceRunId = `run-events-suggestion-${options.label}-${stamp}-${suggestionFixtureCounter}`;
    const fixtureStartedAt = `2026-06-06T22:${String(suggestionFixtureCounter).padStart(2, "0")}:00.000Z`;
    const fixtureCompletedAt = `2026-06-06T22:${String(suggestionFixtureCounter).padStart(2, "0")}:30.000Z`;
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, status, started_at, completed_at, token_usage_json,
          error_message, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, 'codex', ?, ?, ?, ?, ?, '{}', ?, ?)`,
    ).run(
      sourceRunId,
      sourceTask.id,
      agent.id,
      options.runStatus ?? "completed",
      fixtureStartedAt,
      fixtureCompletedAt,
      JSON.stringify({
        inputTokens: 80,
        outputTokens: 40,
        totalCostUsd: 0.04,
        workspaceRunVisibility: {
          schema: "hiverunner.workspace_run_visibility.v1",
          totals: { trackedRoots: 1, changedDuringRunCount: 1 },
        },
      }),
      options.runStatus === "failed" ? "Reviewer run failed after status evidence." : null,
      fixtureStartedAt,
      fixtureCompletedAt,
    );
    if (options.reviewToStatus) {
      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'review', ?, ?, ?)`,
      ).run(
        `run-events-review-${sourceRunId}`,
        project.id,
        sourceTask.id,
        agent.id,
        options.reviewToStatus,
        JSON.stringify({ source: "engine_action", runId: sourceRunId }),
        fixtureCompletedAt,
      );
    }
    return {
      runId: sourceRunId,
      request: {
        nextUrl: new URL(`http://localhost/api/orchestration/engine/runs/${sourceRunId}/events`),
      } as never,
    };
  }

  const acceptedSuggestion = createSuggestionFixture({
    label: "accepted",
    taskStatus: "done",
    reviewToStatus: "done",
  });
  const returnedSuggestion = createSuggestionFixture({
    label: "returned",
    taskStatus: "in-progress",
    reviewToStatus: "in_progress",
  });
  const blockedSuggestion = createSuggestionFixture({
    label: "blocked",
    taskStatus: "blocked",
    reviewToStatus: "blocked",
  });
  const failedSuggestion = createSuggestionFixture({
    label: "failed",
    taskStatus: "done",
    runStatus: "failed",
    reviewToStatus: "done",
  });

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
        evidenceSummary?: { hasProofAttachments?: boolean; proofAttachmentCount?: number };
        proofAttachments?: Array<{ status?: string; manifest?: { sha256?: string }; screenshotCount?: number }>;
        evidenceGaps?: Array<{ id: string; label: string }>;
        annotations?: { schema?: string; state?: string; annotations?: unknown[]; decision?: { reason?: string } };
      };
      proofAttachments?: Array<{
        source?: string;
        status?: string;
        manifest?: { uri?: string; path?: string; sha256?: string };
        taskArtifact?: { uri?: string; sha256?: string };
        specs?: unknown[];
        urls?: unknown[];
        screenshotCount?: number;
        videoCount?: number;
      }>;
      traceExport?: {
        schema?: string;
        summary?: { copyText?: string; annotationCount?: number; proofAttachmentCount?: number };
        redaction?: { location?: string; totalRedactions?: number };
        proofAttachments?: Array<{ manifest?: { sha256?: string }; screenshotCount?: number }>;
        annotations?: { state?: string; annotations?: unknown[]; decision?: { reason?: string } };
      };
    };
    assert.ok(payload.memoryEvidence, "Expected memory evidence to be included for the run");
    assert.strictEqual(payload.memoryEvidence?.diagnostics, undefined);
    assert.strictEqual(payload.trace?.schema, "hiverunner.run_trace_view.v1");
    assert.strictEqual(payload.trace?.captureQuality?.label, "partial");
    assert.ok(payload.trace?.captureQuality?.missingRequiredEvidence?.includes("missing_transcript"));
    assert.strictEqual(payload.proofAttachments?.[0]?.source, "browser_proof");
    assert.strictEqual(payload.proofAttachments?.[0]?.status, "succeeded");
    assert.strictEqual(payload.proofAttachments?.[0]?.manifest?.path, proofManifestPath);
    assert.strictEqual(payload.proofAttachments?.[0]?.manifest?.uri, proofManifestUri);
    assert.strictEqual(payload.proofAttachments?.[0]?.manifest?.sha256, proofManifestSha);
    assert.strictEqual(payload.proofAttachments?.[0]?.taskArtifact?.sha256, proofManifestSha);
    assert.deepStrictEqual(payload.proofAttachments?.[0]?.specs, ["e2e/run-events.spec.ts"]);
    assert.strictEqual(payload.proofAttachments?.[0]?.screenshotCount, 2);
    assert.strictEqual(payload.proofAttachments?.[0]?.videoCount, 1);
    assert.strictEqual(payload.trace?.evidenceSummary?.hasProofAttachments, true);
    assert.strictEqual(payload.trace?.evidenceSummary?.proofAttachmentCount, 1);
    assert.strictEqual(payload.trace?.proofAttachments?.[0]?.manifest?.sha256, proofManifestSha);
    assert.ok(payload.trace?.evidenceGaps?.some((gap) => gap.id === "missing_raw_payload" && gap.label === "not_captured"));
    assert.strictEqual(payload.trace?.annotations?.schema, "hiverunner.run_trace_annotations.v1");
    assert.strictEqual(payload.trace?.annotations?.state, "deferred");
    assert.deepStrictEqual(payload.trace?.annotations?.annotations, []);
    assert.strictEqual(payload.traceExport?.schema, "hiverunner.run_trace_redacted_export.v1");
    assert.strictEqual(payload.traceExport?.redaction?.location, "server");
    assert.strictEqual(payload.traceExport?.summary?.annotationCount, 0);
    assert.strictEqual(payload.traceExport?.summary?.proofAttachmentCount, 1);
    assert.strictEqual(payload.traceExport?.proofAttachments?.[0]?.manifest?.sha256, proofManifestSha);
    assert.strictEqual(payload.traceExport?.annotations?.state, "deferred");
    assert.match(payload.traceExport?.annotations?.decision?.reason ?? "", /clean run-scoped persistence\/API path/);
    assert.ok(payload.traceExport?.summary?.copyText?.includes(`Run: ${runId}`));
  });

  await test("GET suggests accepted reviewed traces with operator confirmation gates", async () => {
    const res = await getEngineRunEventsRoute(acceptedSuggestion.request, {
      params: Promise.resolve({ runId: acceptedSuggestion.runId }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      task?: { status?: string | null };
      evalCaseSuggestion?: {
        outcome?: string;
        requiresOperatorConfirmation?: boolean;
        requiresLowCaptureConfirmation?: boolean;
        defaultRationale?: string;
      } | null;
    };

    assert.strictEqual(payload.task?.status, "done");
    assert.strictEqual(payload.evalCaseSuggestion?.outcome, "accepted");
    assert.strictEqual(payload.evalCaseSuggestion?.requiresOperatorConfirmation, true);
    assert.strictEqual(payload.evalCaseSuggestion?.requiresLowCaptureConfirmation, true);
    assert.match(payload.evalCaseSuggestion?.defaultRationale ?? "", /Accepted after review/);
  });

  await test("GET suggests returned reviewed traces but not blocked or failed traces", async () => {
    const returnedRes = await getEngineRunEventsRoute(returnedSuggestion.request, {
      params: Promise.resolve({ runId: returnedSuggestion.runId }),
    });
    const blockedRes = await getEngineRunEventsRoute(blockedSuggestion.request, {
      params: Promise.resolve({ runId: blockedSuggestion.runId }),
    });
    const failedRes = await getEngineRunEventsRoute(failedSuggestion.request, {
      params: Promise.resolve({ runId: failedSuggestion.runId }),
    });

    assert.strictEqual(returnedRes.status, 200);
    assert.strictEqual(blockedRes.status, 200);
    assert.strictEqual(failedRes.status, 200);

    const returnedPayload = await returnedRes.json() as {
      evalCaseSuggestion?: { outcome?: string; requiresOperatorConfirmation?: boolean } | null;
    };
    const blockedPayload = await blockedRes.json() as { evalCaseSuggestion?: unknown };
    const failedPayload = await failedRes.json() as { evalCaseSuggestion?: unknown };

    assert.strictEqual(returnedPayload.evalCaseSuggestion?.outcome, "returned");
    assert.strictEqual(returnedPayload.evalCaseSuggestion?.requiresOperatorConfirmation, true);
    assert.strictEqual(blockedPayload.evalCaseSuggestion, null);
    assert.strictEqual(failedPayload.evalCaseSuggestion, null);
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

  await test("GET preserves canonical runtime transcript event fidelity in Run Trace timeline", async () => {
    const res = await getEngineRunEventsRoute(traceFidelityRequest, {
      params: Promise.resolve({ runId: traceFidelityRunId }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      trace?: {
        timeline?: Array<{
          id: string;
          kind: string;
          rawKind?: string;
          summary?: string;
          providerEventType?: string;
          payload?: Record<string, unknown> | null;
          metadata?: Record<string, unknown> | null;
        }>;
      };
      run?: {
        lastMeaningfulProgressAt?: string | null;
        suspiciousAfterAt?: string | null;
      };
    };

    const timeline = payload.trace?.timeline ?? [];
    const byId = new Map(timeline.map((event) => [event.id, event]));

    assert.strictEqual(byId.get(`${traceFidelityRunId}-command`)?.kind, "command_start");
    assert.strictEqual(byId.get(`${traceFidelityRunId}-stdout`)?.kind, "stdout_chunk");
    assert.strictEqual(byId.get(`${traceFidelityRunId}-stderr`)?.kind, "stderr_chunk");
    assert.strictEqual(byId.get(`${traceFidelityRunId}-spawned`)?.kind, "process_spawned");
    assert.strictEqual(byId.get(`${traceFidelityRunId}-exit`)?.kind, "process_exit");
    assert.strictEqual(byId.get(`${traceFidelityRunId}-provider`)?.kind, "provider_stream_event");
    assert.strictEqual(byId.get(`${traceFidelityRunId}-unknown`)?.kind, "provider_stream_event");
    assert.strictEqual(byId.get(`${traceFidelityRunId}-tool-start`)?.kind, "tool_call_start");
    assert.strictEqual(byId.get(`${traceFidelityRunId}-tool-result`)?.kind, "tool_result");
    assert.ok(!timeline.some((event) =>
      event.id.startsWith(traceFidelityRunId) &&
      event.kind === "run_progress"
    ));

    assert.strictEqual(byId.get(`${traceFidelityRunId}-command`)?.payload?.cwd, "/tmp/run-trace");
    assert.strictEqual(byId.get(`${traceFidelityRunId}-stdout`)?.payload?.byteLength, 12);
    assert.strictEqual(byId.get(`${traceFidelityRunId}-spawned`)?.payload?.pid, 9898);
    assert.strictEqual(byId.get(`${traceFidelityRunId}-exit`)?.payload?.exitCode, 0);
    assert.strictEqual(byId.get(`${traceFidelityRunId}-provider`)?.payload?.providerEventType, "Codex process started");
    assert.deepStrictEqual(byId.get(`${traceFidelityRunId}-tool-start`)?.payload?.input, { command: "npm test" });
    assert.strictEqual(byId.get(`${traceFidelityRunId}-tool-result`)?.payload?.isError, false);
    assert.strictEqual(
      payload.run?.lastMeaningfulProgressAt,
      new Date(Date.parse(now) + 8).toISOString(),
    );
    assert.strictEqual(payload.run?.suspiciousAfterAt, null);

    const serializedTimeline = JSON.stringify(timeline.filter((event) => event.id.startsWith(traceFidelityRunId)));
    assert.match(serializedTimeline, /\[REDACTED:api_key\]/);
    assert.doesNotMatch(serializedTimeline, /sk-proj-[A-Za-z0-9_-]+/);
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
