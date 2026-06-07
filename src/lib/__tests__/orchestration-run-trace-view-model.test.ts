import assert from "node:assert/strict";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  buildRedactedRunTraceExport,
  buildRunTraceViewModel,
  normalizeRunTraceTimeline,
  type RunTraceEvidenceInput,
} from "@/lib/orchestration/run-trace";

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]" });

const now = Date.parse("2026-06-06T20:00:00.000Z");

function event(id: string, kind: string, offsetMs: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind,
    summary: id,
    ts: now + offsetMs,
    source: "execution_transcript",
    ...extra,
  };
}

function baseTrace(overrides: Partial<RunTraceEvidenceInput> = {}): RunTraceEvidenceInput {
  return {
    run: {
      id: "run-1",
      status: "succeeded",
      providerId: "anthropic",
      invocationSource: "anthropic",
      startedAt: "2026-06-06T20:00:00.000Z",
      finishedAt: "2026-06-06T20:01:00.000Z",
      durationMs: 60_000,
      error: null,
    },
    provider: {
      id: "anthropic",
      displayName: "Anthropic",
      capabilities: {
        liveText: true,
        actionDetection: true,
        structuredTools: true,
        thinking: true,
        runSteering: false,
        persistedTranscript: true,
      },
    },
    providerExecution: {
      structuredTelemetry: true,
      observedLiveText: true,
      observedStructuredTools: true,
      observedThinking: true,
      resultErrors: [],
    },
    metrics: {
      durationMs: 60_000,
      inputTokens: 120,
      outputTokens: 80,
      totalCostUsd: 0.05,
      actionsFound: 1,
      actionsExecuted: 1,
    },
    transcript: {
      entries: [{ id: "t1" }],
      provenance: {
        totalEntries: 1,
        fullTranscriptAvailable: true,
        source: "execution_run_transcript_events",
      },
    },
    timeline: [
      event("started", "run_start", 0),
      event("assistant", "assistant_text_final", 20_000),
      event("tool", "tool_result", 30_000),
      event("action", "action_detected", 40_000),
      event("usage", "run_progress", 50_000, { providerEventType: "usage_update token cost" }),
      event("done", "run_end", 60_000),
    ],
    memoryEvidence: { records: [{ id: "memory-1" }] },
    skillEffectiveness: { events: [{ id: "skill-1" }] },
    workspaceRunVisibility: { schema: "hiverunner.workspace_run_visibility.v1" },
    ...overrides,
  };
}

async function run() {
  console.log("\nOrchestration Run Trace View Model Tests\n");

  await test("normalizes v1 timeline taxonomy from existing event evidence", () => {
    const normalized = normalizeRunTraceTimeline([
      event("later", "run_end", 80),
      event("handoff", "run_progress", 10, { providerEventType: "wakeup_request_claimed" }),
      event("message", "assistant_text_final", 20),
      event("tool", "tool_result", 30),
      event("process", "run_progress", 40, { providerEventType: "stderr" }),
      event("action", "task_updated", 50),
      event("artifact", "run_progress", 60, { providerEventType: "artifact_registered" }),
      event("usage", "run_progress", 70, { providerEventType: "usage_update" }),
      event("memory", "run_progress", 75, { providerEventType: "memory_receipt" }),
      event("review", "run_progress", 77, { providerEventType: "review_returned" }),
    ]);

    assert.deepEqual(
      normalized.map((item) => [item.id, item.category]),
      [
        ["handoff", "handoff"],
        ["message", "message"],
        ["tool", "tool"],
        ["process", "process_io"],
        ["action", "action"],
        ["artifact", "artifact"],
        ["usage", "usage"],
        ["memory", "memory"],
        ["review", "review"],
        ["later", "runner_status"],
      ],
    );
  });

  await test("completed traces are complete when expected evidence is captured", () => {
    const model = buildRunTraceViewModel(baseTrace());

    assert.equal(model.captureQuality.label, "complete");
    assert.equal(model.annotations.schema, "hiverunner.run_trace_annotations.v1");
    assert.equal(model.annotations.state, "deferred");
    assert.equal(model.annotations.annotations.length, 0);
    assert.match(model.annotations.decision.reason, /clean run-scoped persistence\/API path/);
    assert.equal(model.annotations.decision.migrationRequired, true);
    assert.deepEqual(model.captureQuality.missingRequiredEvidence, []);
    assert.equal(model.evidenceSummary.hasTranscript, true);
    assert.equal(model.evidenceSummary.hasCost, true);
    assert.equal(model.evidenceSummary.categoryCounts.message, 1);
    assert.ok(model.evidenceGaps.some((gap) =>
      gap.id === "missing_raw_payload" &&
      gap.label === "not_captured" &&
      gap.affectsCaptureQuality === false
    ));
  });

  await test("empty structured memory evidence containers are not counted as memory evidence", () => {
    const model = buildRunTraceViewModel(baseTrace({
      memoryEvidence: {
        company: { id: "company-1", slug: "company-1", name: "Company 1" },
        run: { id: "run-1", status: "completed" },
        injectionSource: "none",
        evidence: [],
        utilization: {
          receipts: { receipts: [] },
          matchedUse: { status: "not_evaluated", matches: [] },
        },
        diagnostics: {
          version: 1,
          source: "none",
          evidence: [],
        },
      },
    }));

    const memoryGap = model.evidenceGaps.find((gap) => gap.id === "missing_memory_evidence");

    assert.equal(model.evidenceSummary.hasMemoryEvidence, false);
    assert.equal(memoryGap?.label, "not_captured");
    assert.equal(memoryGap?.affectsCaptureQuality, false);
    assert.equal(model.captureQuality.label, "complete");
  });

  await test("memory utilization receipts count as memory evidence even without injected records", () => {
    const model = buildRunTraceViewModel(baseTrace({
      memoryEvidence: {
        injectionSource: "none",
        evidence: [],
        utilization: {
          receipts: {
            receipts: [{ source: "agent_claim", claims: { used: [{ recordId: "memory-1" }] } }],
          },
          matchedUse: { status: "not_evaluated", matches: [] },
        },
      },
    }));

    assert.equal(model.evidenceSummary.hasMemoryEvidence, true);
    assert.equal(model.evidenceGaps.some((gap) => gap.id === "missing_memory_evidence"), false);
  });

  await test("failed runs are partial when run evidence exists but expected categories are missing", () => {
    const model = buildRunTraceViewModel(baseTrace({
      run: {
        ...baseTrace().run,
        id: "run-failed",
        status: "failed",
        providerId: "codex",
        invocationSource: "codex",
        error: "Command exited with code 1",
      },
      provider: {
        id: "codex",
        capabilities: {
          liveText: true,
          actionDetection: true,
          structuredTools: true,
          thinking: true,
          runSteering: true,
          persistedTranscript: true,
        },
      },
      metrics: { durationMs: 10_000 },
      transcript: { entries: [], provenance: { totalEntries: 0, fullTranscriptAvailable: false } },
      workspaceRunVisibility: null,
      timeline: [
        event("started", "run_start", 0),
        event("failed", "run_error", 10_000),
      ],
    }));

    assert.equal(model.captureQuality.label, "partial");
    assert.notEqual(model.captureQuality.label, "failed");
    assert.ok(model.captureQuality.missingRequiredEvidence.includes("missing_transcript"));
    assert.ok(model.captureQuality.missingRequiredEvidence.includes("missing_cost"));
    assert.ok(model.captureQuality.missingRequiredEvidence.includes("missing_workspace_visibility"));
  });

  await test("cancelled runs surface missing cost without treating transcript absence as expected", () => {
    const model = buildRunTraceViewModel(baseTrace({
      run: {
        ...baseTrace().run,
        id: "run-cancelled",
        status: "cancelled",
        providerId: "gemini",
        invocationSource: "gemini",
      },
      provider: {
        id: "gemini",
        capabilities: {
          liveText: false,
          actionDetection: false,
          structuredTools: false,
          thinking: false,
          runSteering: false,
          persistedTranscript: false,
        },
      },
      providerExecution: { resultErrors: [] },
      metrics: { durationMs: 15_000 },
      transcript: { entries: [], provenance: { totalEntries: 0, fullTranscriptAvailable: false } },
      timeline: [
        event("started", "run_start", 0),
        event("cancelled", "run_end", 15_000),
      ],
    }));

    const costGap = model.evidenceGaps.find((gap) => gap.id === "missing_cost");
    const transcriptGap = model.evidenceGaps.find((gap) => gap.id === "missing_transcript");

    assert.equal(model.captureQuality.label, "partial");
    assert.equal(costGap?.label, "not_captured");
    assert.equal(costGap?.affectsCaptureQuality, true);
    assert.equal(transcriptGap?.label, "not_available");
    assert.equal(transcriptGap?.affectsCaptureQuality, false);
  });

  await test("running traces stay partial while evidence is accumulating", () => {
    const model = buildRunTraceViewModel(baseTrace({
      run: {
        ...baseTrace().run,
        id: "run-running",
        status: "running",
        finishedAt: null,
        durationMs: null,
      },
      metrics: {
        inputTokens: 40,
        outputTokens: 10,
        totalCostUsd: 0.01,
      },
      timeline: [
        event("started", "run_start", 0),
        event("assistant", "assistant_text_delta", 5_000),
      ],
    }));

    assert.equal(model.captureQuality.label, "partial");
    assert.deepEqual(model.captureQuality.missingRequiredEvidence, []);
  });

  await test("minimal manual traces label missing data as unavailable", () => {
    const model = buildRunTraceViewModel({
      run: {
        id: "manual-run",
        status: "succeeded",
        providerId: "none",
        invocationSource: "manual",
      },
      provider: {
        id: "none",
        capabilities: {
          liveText: false,
          actionDetection: false,
          structuredTools: false,
          thinking: false,
          runSteering: false,
          persistedTranscript: false,
        },
      },
      metrics: {},
      transcript: { entries: [], provenance: { totalEntries: 0, fullTranscriptAvailable: false } },
      timeline: [],
    });

    assert.equal(model.captureQuality.label, "minimal");
    assert.equal(model.evidenceGaps.find((gap) => gap.id === "manual_or_minimal_runner")?.label, "not_available");
    assert.equal(model.evidenceGaps.find((gap) => gap.id === "missing_timeline")?.label, "not_available");
    assert.equal(model.evidenceGaps.find((gap) => gap.id === "missing_transcript")?.label, "not_available");
    assert.equal(model.evidenceGaps.find((gap) => gap.id === "missing_cost")?.label, "not_available");
    assert.equal(model.evidenceGaps.find((gap) => gap.id === "missing_workspace_visibility")?.label, "not_available");
    assert.equal(model.evidenceGaps.find((gap) => gap.id === "missing_memory_evidence")?.label, "not_available");
  });

  await test("capture failures are distinct from failed agent runs", () => {
    const model = buildRunTraceViewModel(baseTrace({
      run: {
        ...baseTrace().run,
        id: "run-capture-failed",
        status: "failed",
        error: "Trace capture failed while storing transcript events",
      },
    }));

    assert.equal(model.captureQuality.label, "failed");
    assert.equal(model.evidenceGaps.find((gap) => gap.id === "trace_capture_failed")?.label, "capture_failed");
  });

  await test("redacted exports preserve trace shape and summarize redactions by category", () => {
    const secretBearer = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret";
    const secretApiKey = "sk-proj-1234567890abcdefghijklmnopqrstuv";
    const secretGithubToken = "github_pat_1234567890abcdefghijklmnopqrstuvwxyz";
    const secretPassword = "correct-horse-battery-staple";
    const trace = baseTrace({
      run: {
        ...baseTrace().run,
        usage: {
          OPENAI_API_KEY: secretApiKey,
          regularField: "visible-run-usage",
        },
        result: {
          authorization: secretBearer,
        },
      },
      task: {
        id: "task-1",
        key: "INS-212",
        title: "Add deterministic redacted export basics",
      },
      providerExecution: {
        ...baseTrace().providerExecution,
        assistantSummary: `Used ${secretGithubToken} while checking the provider payload.`,
        note: `Authorization header was ${secretBearer}.`,
      },
      transcript: {
        entries: [{
          id: "entry-1",
          body: `The command printed ${secretApiKey} and ${secretBearer}.`,
          type: "assistant_text_final",
          source: "anthropic",
          ts: now,
        }],
        provenance: {
          totalEntries: 1,
          fullTranscriptAvailable: true,
          source: "execution_run_transcript_events",
        },
      },
      timeline: [
        event("started", "run_start", 0),
        event("assistant", "assistant_text_final", 20_000, {
          summary: `Provider returned ${secretGithubToken}.`,
          metadata: {
            env: {
              OPENAI_API_KEY: secretApiKey,
              NORMAL_ENV: "visible-env-value",
            },
            password: secretPassword,
          },
        }),
      ],
      memoryEvidence: null,
      rawPayload: {
        request: {
          headers: {
            authorization: secretBearer,
          },
          env: {
            OPENAI_API_KEY: secretApiKey,
            NORMAL_ENV: "visible-env-value",
          },
          password: secretPassword,
        },
      },
    });

    const exportPayload = buildRedactedRunTraceExport(trace);
    const serialized = JSON.stringify(exportPayload);

    assert.equal(exportPayload.schema, "hiverunner.run_trace_redacted_export.v1");
    assert.equal(exportPayload.redaction.location, "server");
    assert.equal(exportPayload.summary.annotationCount, 0);
    assert.equal(exportPayload.annotations.state, "deferred");
    assert.equal(exportPayload.annotations.annotations.length, 0);
    assert.match(exportPayload.annotations.decision.reason, /existing marker systems are voice-session or task-comment scoped/);
    assert.equal(exportPayload.timeline.length, 2);
    assert.deepEqual(
      exportPayload.evidenceGaps.map((gap) => gap.label),
      buildRunTraceViewModel(trace).evidenceGaps.map((gap) => gap.label),
    );
    assert.equal(exportPayload.rawPayload?.request?.env?.NORMAL_ENV, "visible-env-value");
    assert.equal(exportPayload.timeline[1]?.metadata?.env?.NORMAL_ENV, "visible-env-value");
    assert.ok(exportPayload.summary.copyText.includes("Run: run-1"));
    assert.ok(exportPayload.summary.copyText.includes("Evidence gaps: Memory evidence missing [not_captured]"));
    assert.ok(exportPayload.redaction.totalRedactions >= 5);
    assert.ok(exportPayload.redaction.categories.bearer_token.count >= 1);
    assert.ok(exportPayload.redaction.categories.api_key.count >= 2);
    assert.ok(exportPayload.redaction.categories.sensitive_field.count >= 2);
    assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._-]+/i);
    assert.doesNotMatch(serialized, /sk-proj-[A-Za-z0-9_-]+/);
    assert.doesNotMatch(serialized, /github_pat_[A-Za-z0-9_]+/);
    assert.doesNotMatch(serialized, new RegExp(secretPassword));
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
