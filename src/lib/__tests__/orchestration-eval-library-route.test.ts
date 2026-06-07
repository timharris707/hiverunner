import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { NextRequest } from "next/server";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import {
  createFixtureAgent,
  createFixtureProject,
  DEFAULT_ORCHESTRATION_COMPANY_ID,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import type { RunTraceEvidenceInput } from "@/lib/orchestration/run-trace";

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]" });

function getRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/orchestration/companies/insight/evals${query}`);
}

function traceInput(input: {
  runId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  agentId: string;
  agentName: string;
}): RunTraceEvidenceInput {
  return {
    run: {
      id: input.runId,
      status: "succeeded",
      providerId: "codex",
      invocationSource: "codex",
      startedAt: "2026-06-06T20:00:00.000Z",
      finishedAt: "2026-06-06T20:01:00.000Z",
      durationMs: 60_000,
      error: null,
    },
    task: {
      id: input.taskId,
      key: input.taskKey,
      title: input.taskTitle,
      status: "done",
      priority: "P1",
    },
    provider: {
      id: "codex",
      displayName: "Codex",
      capabilities: {
        liveText: true,
        actionDetection: true,
        structuredTools: true,
        persistedTranscript: true,
      },
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
      entries: [{ id: "entry-1", body: "Finished with reusable evidence.", type: "assistant_text_final" }],
      provenance: { totalEntries: 1, fullTranscriptAvailable: true, source: "execution_run_transcript_events" },
    },
    timeline: [
      { id: "started", kind: "run_start", summary: "started", ts: Date.parse("2026-06-06T20:00:00.000Z"), source: "execution_transcript" },
      { id: "done", kind: "run_end", summary: "done", ts: Date.parse("2026-06-06T20:01:00.000Z"), source: "execution_transcript" },
    ],
    workspaceRunVisibility: { schema: "hiverunner.workspace_run_visibility.v1" },
    memoryEvidence: { records: [{ id: "memory-1" }] },
    rawPayload: { result: "redacted-safe" },
  };
}

async function run() {
  console.log("\nOrchestration Eval Library Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for this test");
  }

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-eval-library-route-",
  });

  try {
    const { GET } = await import("@/app/api/orchestration/companies/[slug]/evals/route");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { createEvalCase } = await import("@/lib/orchestration/eval-cases");
    const { buildRedactedRunTraceExport } = await import("@/lib/orchestration/run-trace");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);
    db.prepare("UPDATE companies SET company_code = ?, slug = ? WHERE id = ?")
      .run("INS", "insight", DEFAULT_ORCHESTRATION_COMPANY_ID);

    const project = createFixtureProject(createProject, {
      namePrefix: "Eval Library Project",
      label: "library",
      description: "Eval library route fixture",
      color: "#22c55e",
      emoji: "E",
    });
    const secondProject = createFixtureProject(createProject, {
      namePrefix: "Other Eval Project",
      label: "library-other",
      description: "Second eval library fixture",
      color: "#38bdf8",
      emoji: "O",
    });
    const runner = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "EvalLibraryRunner",
      openclawPrefix: "eval-library-runner",
      emoji: "R",
      role: "Implementation Engineer",
      skills: ["frontend"],
    });

    function saveCase(input: {
      projectId: string;
      title: string;
      type: "feature" | "research";
      labels: string[];
      runId: string;
      outcome: "accepted" | "returned";
      runnerProvider: string;
      runnerModel: string;
      templateId: string;
      sourceTemplateVersionId: string;
      templateIntakeAnswerId: string;
      createdAt: string;
    }) {
      const task = createTask({
        projectId: input.projectId,
        title: input.title,
        description: "Eval library source task.",
        labels: input.labels,
        assignee: runner.id,
        createdBy: runner.id,
        priority: "P1",
        type: input.type,
        status: "done",
      }).task;
      const taskKey = task.key ?? task.id;
      const redactedSnapshot = buildRedactedRunTraceExport(traceInput({
        runId: input.runId,
        taskId: task.id,
        taskKey,
        taskTitle: task.title,
        agentId: runner.id,
        agentName: runner.name,
      }));

      return createEvalCase({
        companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
        projectId: input.projectId,
        sourceTask: {
          id: task.id,
          key: taskKey,
          title: task.title,
          type: task.type,
        },
        sourceRun: {
          id: input.runId,
          traceRoute: `/INS/tasks/${encodeURIComponent(taskKey)}/runs/${encodeURIComponent(input.runId)}`,
          executionEngine: "hiverunner",
          runnerProvider: input.runnerProvider,
          providerId: "codex",
          runnerModel: input.runnerModel,
          agentId: runner.id,
          agentName: runner.name,
        },
        templateContext: {
          templateId: input.templateId,
          templateName: input.templateId,
          sourceTemplateVersionId: input.sourceTemplateVersionId,
          templateIntakeAnswerId: input.templateIntakeAnswerId,
          draftId: `${input.templateId}-draft`,
        },
        review: {
          outcome: input.outcome,
          rationale: `Reviewed ${input.outcome} evidence for ${input.title}.`,
          reviewerAgentId: runner.id,
          reviewerName: runner.name,
          reviewedAt: input.createdAt,
        },
        captureQuality: redactedSnapshot.captureQuality.label,
        evidenceGaps: redactedSnapshot.evidenceGaps,
        redactedSnapshot,
        idempotencyKey: `${input.runId}:${input.outcome}`,
        createdByAgentId: runner.id,
        createdAt: input.createdAt,
      }, db);
    }

    const accepted = saveCase({
      projectId: project.id,
      title: "Accepted eval case source",
      type: "feature",
      labels: ["api", "evals"],
      runId: "eval-library-run-1",
      outcome: "accepted",
      runnerProvider: "openai",
      runnerModel: "gpt-5.5",
      templateId: "build-something",
      sourceTemplateVersionId: "build-something@1.0.0",
      templateIntakeAnswerId: "intake-build-something",
      createdAt: "2026-06-06T21:00:00.000Z",
    });
    saveCase({
      projectId: secondProject.id,
      title: "Returned eval case source",
      type: "research",
      labels: ["review"],
      runId: "eval-library-run-2",
      outcome: "returned",
      runnerProvider: "anthropic",
      runnerModel: "claude-5",
      templateId: "bug-triage",
      sourceTemplateVersionId: "bug-triage@1.0.0",
      templateIntakeAnswerId: "intake-bug-triage",
      createdAt: "2026-06-07T21:00:00.000Z",
    });

    async function load(query = "") {
      const response = await GET(getRequest(query), { params: Promise.resolve({ slug: "insight" }) });
      return {
        status: response.status,
        body: await response.json() as {
          cases?: Array<{
            id: string;
            sourceProject: { name: string };
            sourceTask: { key: string; type: string; tags: string[] };
            sourceRun: { traceRoute: string; runnerProvider: string; runnerModel: string };
            review: { outcome: string };
          }>;
          total?: number;
          filters?: Record<string, unknown>;
          facets?: { projects: Array<{ value: string; label: string; count: number }>; tags: Array<{ value: string; count: number }> };
        },
      };
    }

    await test("loads the company eval library with facets and source links", async () => {
      const response = await load();

      assert.equal(response.status, 200);
      assert.equal(response.body.total, 2);
      assert.equal(response.body.cases?.length, 2);
      assert.equal(response.body.facets?.projects.length, 2);
      assert.ok(response.body.facets?.tags.some((tag) => tag.value === "api" && tag.count === 1));
      assert.equal(response.body.cases?.find((item) => item.id === accepted.id)?.sourceRun.traceRoute, accepted.sourceRun.traceRoute);
    });

    await test("applies project, task type, template, agent, runner, model, outcome, tag, and date filters", async () => {
      const query = new URLSearchParams({
        projectId: project.id,
        taskType: "feature",
        template: "build-something",
        agent: runner.id,
        runner: "openai",
        model: "gpt-5.5",
        reviewOutcome: "accepted",
        tag: "api",
        dateFrom: "2026-06-06T00:00:00.000Z",
        dateTo: "2026-06-06T23:59:59.999Z",
      });
      const response = await load(`?${query.toString()}`);

      assert.equal(response.status, 200);
      assert.equal(response.body.total, 1);
      assert.equal(response.body.cases?.[0]?.id, accepted.id);
      assert.equal(response.body.filters?.projectId, project.id);
      assert.equal(response.body.filters?.reviewOutcome, "accepted");
      assert.deepEqual(response.body.cases?.[0]?.sourceTask.tags, ["api", "evals"]);
    });

    await test("applies explicit template version and intake-answer filters from eval context", async () => {
      const query = new URLSearchParams({
        sourceTemplateVersionId: "build-something@1.0.0",
        templateIntakeAnswerId: "intake-build-something",
      });
      const response = await load(`?${query.toString()}`);

      assert.equal(response.status, 200);
      assert.equal(response.body.total, 1);
      assert.equal(response.body.cases?.[0]?.id, accepted.id);
      assert.equal(response.body.filters?.sourceTemplateVersionId, "build-something@1.0.0");
      assert.equal(response.body.filters?.templateIntakeAnswerId, "intake-build-something");
    });

    await test("returns an empty library slice when filters do not match", async () => {
      const response = await load("?tag=does-not-exist");

      assert.equal(response.status, 200);
      assert.equal(response.body.total, 0);
      assert.deepEqual(response.body.cases, []);
      assert.equal(response.body.filters?.tag, "does-not-exist");
    });
  } finally {
    workspaceIsolation.dispose();
  }

  finish();
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
