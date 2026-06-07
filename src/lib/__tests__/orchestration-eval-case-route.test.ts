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

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]" });

type SaveEvalResponse = {
  ok?: boolean;
  evalCase?: {
    id: string;
    review: { outcome: string; rationale: string };
    captureQuality: string;
    evidenceGaps: unknown[];
    snapshotSha256: string;
    redactedSnapshot: { schema: string; rawPayload?: unknown };
    sourceRun: { traceRoute: string };
    templateContext?: Record<string, unknown>;
    sourceTemplateVersionId?: string | null;
    templateIntakeAnswerId?: string | null;
  };
  links?: {
    activity: string;
    evalCase: string;
    evalsLibrary: string;
    runTrace: string;
  };
  warnings?: string[];
  error?: {
    code: string;
    message: string;
  };
};

function jsonRequest(runId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/orchestration/engine/runs/${encodeURIComponent(runId)}/eval-case`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<SaveEvalResponse> {
  return await response.json() as SaveEvalResponse;
}

async function run() {
  console.log("\nOrchestration Eval Case Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for this test");
  }

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-eval-case-route-",
  });

  try {
    const { POST } = await import("@/app/api/orchestration/engine/runs/[runId]/eval-case/route");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { createProject, createProjectAgent, createTask, listActivityFeed } = await import("@/lib/orchestration/service");
    const { persistExecutionTranscriptEvents } = await import("@/lib/orchestration/service/execution-transcript");
    const { createTemplateIntakeAnswer } = await import("@/lib/orchestration/template-persistence");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);

    db.prepare("UPDATE companies SET company_code = ?, slug = ? WHERE id = ?")
      .run("INS", "insight", DEFAULT_ORCHESTRATION_COMPANY_ID);

    const project = createFixtureProject(createProject, {
      namePrefix: "Eval Case Route Project",
      label: "route",
      description: "Eval case route fixture",
      color: "#14b8a6",
      emoji: "E",
    });
    const runner = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "EvalRouteRunner",
      openclawPrefix: "eval-route-runner",
      emoji: "R",
      role: "Implementation Engineer",
      skills: ["backend"],
    });
    const reviewer = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "EvalRouteReviewer",
      openclawPrefix: "eval-route-reviewer",
      emoji: "Q",
      role: "QA Reviewer",
      skills: ["qa"],
    });

    let runCounter = 0;
    function createRunFixture(options: {
      taskStatus: "review" | "done" | "blocked" | "in-progress";
      runStatus?: "completed" | "failed";
      includeWorkspaceVisibility?: boolean;
      errorMessage?: string | null;
      templateProvenance?: boolean;
    }) {
      runCounter += 1;
      const task = createTask({
        projectId: project.id,
        title: `Route eval source ${runCounter}`,
        description: "Route test source task.",
        labels: [],
        assignee: runner.id,
        createdBy: reviewer.id,
        priority: "P1",
        type: "feature",
        status: options.taskStatus,
      }).task;
      const artifactUri = `file:///tmp/route-eval-artifact-${runCounter}.html`;
      const artifactSha256 = `${String(runCounter).padStart(2, "0")}`.repeat(32).slice(0, 64);
      db.prepare(
        `UPDATE tasks
         SET artifact_uri = ?,
             artifact_kind = 'html',
             artifact_sha256 = ?,
             artifact_registered_at = ?
         WHERE id = ?`,
      ).run(artifactUri, artifactSha256, "2026-06-06T20:59:00.000Z", task.id);
      const runId = `route-eval-run-${runCounter}`;
      const startedAt = `2026-06-06T20:${String(runCounter).padStart(2, "0")}:00.000Z`;
      const completedAt = `2026-06-06T20:${String(runCounter).padStart(2, "0")}:30.000Z`;
      const tokenUsage: Record<string, unknown> = {
        runnerProvider: "openai",
        runnerModel: "gpt-5.5",
        inputTokens: 120,
        outputTokens: 80,
        totalCostUsd: 0.05,
        structuredTelemetry: true,
        observedLiveText: true,
        observedStructuredTools: true,
        rawPayload: {
          request: {
            env: {
              OPENAI_API_KEY: "sk-proj-1234567890abcdefghijklmnopqrstuv",
              NORMAL_ENV: "visible",
            },
          },
        },
      };
      if (options.includeWorkspaceVisibility !== false) {
        tokenUsage.workspaceRunVisibility = {
          schema: "hiverunner.workspace_run_visibility.v1",
          totals: { trackedRoots: 1, changedDuringRunCount: 0 },
        };
      }
      const sourceTemplateVersionId = options.templateProvenance ? "build-something@1.0.0" : null;
      const templateIntakeAnswerId = options.templateProvenance ? `route-template-intake-${runCounter}` : null;
      if (sourceTemplateVersionId && templateIntakeAnswerId) {
        createTemplateIntakeAnswer({
          id: templateIntakeAnswerId,
          companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
          templateVersionId: sourceTemplateVersionId,
          answers: {
            buildType: "dashboard-widget",
            vibeOrConstraint: "eval provenance fixture",
            ambitionLevel: "tiny-proof",
          },
          normalizedAnswers: {
            buildType: "dashboard-widget",
            vibeOrConstraint: "eval provenance fixture",
            ambitionLevel: "tiny-proof",
          },
          idempotencyKey: templateIntakeAnswerId,
        });
      }
      const templateGenerationProvenance = options.templateProvenance
        ? {
            schema: "hiverunner.template_draft_plan.v1",
            source: "sprint_plan_draft",
            templateId: "build-something",
            templateName: "Build Something",
            templateVersion: "1.0.0",
            draftId: `route-template-draft-${runCounter}`,
            proposalGroupId: `route-template-group-${runCounter}`,
            companyGoalId: `route-template-goal-${runCounter}`,
            templateTaskId: "shape-brief",
            capabilitySlotIds: ["builder", "verification"],
            crewRecommendation: { required: [{ id: "builder" }] },
            draftGoal: { title: "Should not be copied to Activity" },
          }
        : {};

      db.prepare(
        `INSERT INTO execution_runs
          (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
           error_message, token_usage_json, duration_ms, idempotency_key, execution_engine,
           runner_provider, runner_model, model_lane, source_template_version_id,
           template_intake_answer_id, template_generation_provenance_json,
           metadata_json, created_at, updated_at)
         VALUES
          (?, ?, ?, 'codex', ?, ?, ?, ?, ?, ?, 30000, ?, 'hiverunner',
           'openai', 'gpt-5.5', 'default', ?, ?, ?, '{}', ?, ?)`,
      ).run(
        runId,
        task.id,
        runner.id,
        `route-session-${runCounter}`,
        options.runStatus ?? "completed",
        startedAt,
        completedAt,
        options.errorMessage ?? null,
        JSON.stringify(tokenUsage),
        `route-idempotency-${runCounter}`,
        sourceTemplateVersionId,
        templateIntakeAnswerId,
        JSON.stringify(templateGenerationProvenance),
        startedAt,
        completedAt,
      );

      persistExecutionTranscriptEvents({
        db,
        executionRunId: runId,
        provider: "codex",
        occurredAt: completedAt,
        events: [
          {
            kind: "assistant_text_final",
            role: "assistant",
            title: "Final answer",
            body: "Finished the implementation and provided verification evidence.",
            occurredAt: completedAt,
          },
          {
            kind: "tool_result",
            role: "tool",
            title: "Test command",
            body: "All focused assertions passed.",
            occurredAt: completedAt,
          },
        ],
      });

      return {
        runId,
        taskId: task.id,
        taskKey: task.key ?? task.id,
        artifactUri,
        artifactSha256,
      };
    }

    function evalActivityRows(taskId: string) {
      return db
        .prepare("SELECT id, metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.eval_case_saved' ORDER BY created_at ASC")
        .all(taskId) as Array<{ id: string; metadata_json: string }>;
    }

    async function postSave(runId: string, body: Record<string, unknown>) {
      const response = await POST(jsonRequest(runId, body), {
        params: Promise.resolve({ runId }),
      });
      return {
        status: response.status,
        body: await readJson(response),
      };
    }

    await test("accepted outcome saves a redacted eval case and stable links", async () => {
      const fixture = createRunFixture({ taskStatus: "done" });
      const response = await postSave(fixture.runId, {
        outcome: "accepted",
        rationaleByOutcome: {
          accepted: "The reviewed run satisfies the task contract and has reusable evidence.",
        },
        reviewerAgentId: reviewer.id,
        reviewedAt: "2026-06-06T21:00:00.000Z",
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.evalCase?.review.outcome, "accepted");
      assert.equal(response.body.evalCase?.captureQuality, "complete");
      assert.equal(response.body.evalCase?.redactedSnapshot.schema, "hiverunner.run_trace_redacted_export.v1");
      assert.doesNotMatch(JSON.stringify(response.body.evalCase?.redactedSnapshot), /sk-proj-[A-Za-z0-9_-]+/);
      assert.match(JSON.stringify(response.body.evalCase?.redactedSnapshot), /\[REDACTED:sensitive_field\]/);
      assert.equal(response.body.links?.activity, `/INS/activity?evalCase=${encodeURIComponent(response.body.evalCase!.id)}`);
      assert.equal(response.body.links?.evalCase, `/INS/evals/${encodeURIComponent(response.body.evalCase!.id)}`);
      assert.equal(response.body.links?.evalsLibrary, "/INS/evals");
      assert.equal(response.body.links?.runTrace, `/INS/tasks/${encodeURIComponent(fixture.taskKey)}/runs/${encodeURIComponent(fixture.runId)}`);
      assert.equal(response.body.evalCase?.sourceRun.traceRoute, response.body.links?.runTrace);

      const activityRows = evalActivityRows(fixture.taskId);
      assert.equal(activityRows.length, 1);
      const metadata = JSON.parse(activityRows[0].metadata_json) as Record<string, unknown>;
      assert.equal(metadata.schema, "hiverunner.eval_case_activity.v1");
      assert.equal(metadata.evalCaseId, response.body.evalCase?.id);
      assert.equal(metadata.reviewOutcome, "accepted");
      assert.deepEqual(metadata.links, response.body.links);
      assert.deepEqual(metadata.sourceTask, {
        id: fixture.taskId,
        key: fixture.taskKey,
        title: `Route eval source 1`,
        route: `/INS/tasks/${encodeURIComponent(fixture.taskKey)}`,
      });
      assert.deepEqual(metadata.sourceRun, {
        id: fixture.runId,
        traceRoute: response.body.links?.runTrace,
        executionEngine: "hiverunner",
        runnerProvider: "openai",
        providerId: "codex",
        runnerModel: "gpt-5.5",
        agentId: runner.id,
        agentName: runner.name,
      });
      assert.deepEqual(metadata.sourceArtifact, {
        uri: fixture.artifactUri,
        kind: "html",
        sha256: fixture.artifactSha256,
        registeredAt: "2026-06-06T20:59:00.000Z",
      });
      assert.deepEqual(metadata.snapshotEvidence, {
        schema: "hiverunner.run_trace_redacted_export.v1",
        sha256: response.body.evalCase?.snapshotSha256,
        route: `${response.body.links?.evalCase}#snapshot`,
        redactionPolicy: "hiverunner.run_trace_redaction.v1",
        redactionCount: 1,
        captureQuality: "complete",
        evidenceGapCount: response.body.evalCase?.evidenceGaps.length,
        annotationState: "deferred",
      });
      const serializedActivity = JSON.stringify(metadata);
      assert.ok(serializedActivity.length < 2400);
      assert.doesNotMatch(serializedActivity, /Finished the implementation/);
      assert.doesNotMatch(serializedActivity, /All focused assertions passed/);
      assert.doesNotMatch(serializedActivity, /redactedSnapshot/);

      const feed = listActivityFeed({ limit: 20 });
      const feedEvent = feed.activity.find((event) => event.eventType === "task.eval_case_saved" && event.taskId === fixture.taskId);
      assert.ok(feedEvent);
      assert.equal(feedEvent.message, `Eval case saved for ${fixture.taskKey} (accepted)`);
      assert.equal(feedEvent.metadata?.evalCaseId, response.body.evalCase?.id);
      assert.equal((feedEvent.metadata?.links as Record<string, unknown> | undefined)?.evalCase, response.body.links?.evalCase);
    });

    await test("template source runs save compact eval and Activity provenance", async () => {
      const fixture = createRunFixture({ taskStatus: "done", templateProvenance: true });
      const response = await postSave(fixture.runId, {
        outcome: "accepted",
        rationaleByOutcome: {
          accepted: "The template-generated run is reusable with compact provenance.",
        },
        reviewerAgentId: reviewer.id,
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.evalCase?.sourceTemplateVersionId, "build-something@1.0.0");
      assert.equal(response.body.evalCase?.templateIntakeAnswerId, "route-template-intake-2");
      assert.equal(response.body.evalCase?.templateContext?.templateId, "build-something");
      assert.equal(response.body.evalCase?.templateContext?.templateName, "Build Something");
      assert.equal(response.body.evalCase?.templateContext?.draftId, "route-template-draft-2");
      assert.deepEqual(response.body.evalCase?.templateContext?.capabilitySlotIds, ["builder", "verification"]);
      assert.equal(response.body.evalCase?.templateContext?.sourceTemplateVersionId, "build-something@1.0.0");
      assert.equal(response.body.evalCase?.templateContext?.templateIntakeAnswerId, "route-template-intake-2");
      assert.equal(response.body.evalCase?.templateContext && "crewRecommendation" in response.body.evalCase.templateContext, false);
      assert.equal(response.body.evalCase?.templateContext && "draftGoal" in response.body.evalCase.templateContext, false);

      const [activity] = evalActivityRows(fixture.taskId);
      assert.ok(activity);
      const metadata = JSON.parse(activity.metadata_json) as Record<string, unknown>;
      const template = metadata.template as Record<string, unknown>;
      assert.equal(template.sourceTemplateVersionId, "build-something@1.0.0");
      assert.equal(template.templateIntakeAnswerId, "route-template-intake-2");
      assert.equal(template.templateId, "build-something");
      assert.equal(template.draftId, "route-template-draft-2");
      assert.equal((template.sourceLinks as Record<string, unknown>).evals, "/INS/evals?template=build-something%401.0.0");
      assert.equal((template.sourceLinks as Record<string, unknown>).intake, "/INS/evals?templateIntakeAnswerId=route-template-intake-2");
      const serializedActivity = JSON.stringify(metadata);
      assert.doesNotMatch(serializedActivity, /Should not be copied/);
      assert.doesNotMatch(serializedActivity, /crewRecommendation/);
      assert.doesNotMatch(serializedActivity, /redactedSnapshot/);
    });

    for (const outcome of ["returned", "rejected", "blocked"] as const) {
      await test(`${outcome} outcome saves with its own rationale`, async () => {
        const fixture = createRunFixture({ taskStatus: outcome === "blocked" ? "blocked" : "review" });
        const response = await postSave(fixture.runId, {
          review: {
            outcome,
            rationales: {
              [outcome]: `The reviewer chose ${outcome} after inspecting the trace evidence.`,
            },
            reviewerAgentId: reviewer.id,
          },
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.evalCase?.review.outcome, outcome);
        assert.match(response.body.evalCase?.review.rationale ?? "", new RegExp(outcome));
      });
    }

    await test("duplicate save replays the existing eval case instead of inserting a second row", async () => {
      const fixture = createRunFixture({ taskStatus: "done" });
      const payload = {
        outcome: "accepted",
        rationaleByOutcome: {
          accepted: "This trace is already reviewed and should only be saved once.",
        },
        reviewerAgentId: reviewer.id,
      };

      const first = await postSave(fixture.runId, payload);
      const second = await postSave(fixture.runId, {
        ...payload,
        rationaleByOutcome: {
          accepted: "A replayed rationale should still use the same eval case row.",
        },
      });
      const count = db
        .prepare("SELECT COUNT(*) AS count FROM eval_cases WHERE source_run_id = ?")
        .get(fixture.runId) as { count: number };

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(second.body.evalCase?.id, first.body.evalCase?.id);
      assert.equal(count.count, 1);
      assert.equal(evalActivityRows(fixture.taskId).length, 1);
    });

    await test("missing rationale is rejected before persistence", async () => {
      const fixture = createRunFixture({ taskStatus: "done" });
      const response = await postSave(fixture.runId, {
        outcome: "accepted",
        reviewerAgentId: reviewer.id,
      });

      assert.equal(response.status, 400);
      assert.equal(response.body.error?.code, "missing_rationale");
      assert.equal(evalActivityRows(fixture.taskId).length, 0);
    });

    await test("generic rationale is rejected because rationale must be outcome-specific", async () => {
      const fixture = createRunFixture({ taskStatus: "done" });
      const response = await postSave(fixture.runId, {
        outcome: "accepted",
        rationale: "This generic rationale is not keyed to the accepted outcome.",
        reviewerAgentId: reviewer.id,
      });

      assert.equal(response.status, 400);
      assert.equal(response.body.error?.code, "missing_rationale");
    });

    await test("unreviewed task state is rejected before persistence", async () => {
      const fixture = createRunFixture({ taskStatus: "in-progress" });
      const response = await postSave(fixture.runId, {
        outcome: "returned",
        rationaleByOutcome: {
          returned: "The reviewer is intentionally returning this in-progress trace after inspection.",
        },
        reviewerAgentId: reviewer.id,
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.error?.code, "unreviewed_run");
    });

    await test("request-side reviewed confirmation cannot bypass persisted unreviewed task state", async () => {
      const fixture = createRunFixture({ taskStatus: "in-progress" });
      const response = await postSave(fixture.runId, {
        outcome: "returned",
        rationaleByOutcome: {
          returned: "The request claims review, but the source task is still unreviewed.",
        },
        reviewerAgentId: reviewer.id,
        confirmReviewed: true,
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.error?.code, "unreviewed_run");
    });

    await test("returned reviewer runs can save after a persisted review return event", async () => {
      const fixture = createRunFixture({ taskStatus: "in-progress" });
      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'review', 'in_progress', ?, ?)`,
      ).run(
        `returned-review-event-${fixture.runId}`,
        project.id,
        fixture.taskId,
        reviewer.id,
        JSON.stringify({ source: "engine_action", runId: fixture.runId }),
        "2026-06-06T21:10:00.000Z",
      );

      const response = await postSave(fixture.runId, {
        outcome: "returned",
        rationaleByOutcome: {
          returned: "The reviewer returned this run after inspecting reusable trace evidence.",
        },
        reviewerAgentId: reviewer.id,
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.evalCase?.review.outcome, "returned");
      assert.equal(response.body.evalCase?.sourceRun.traceRoute, response.body.links?.runTrace);
    });

    await test("failed runs require explicit failed-trace confirmation", async () => {
      const fixture = createRunFixture({
        taskStatus: "review",
        runStatus: "failed",
        errorMessage: "Provider command failed after emitting trace evidence.",
      });
      const rejected = await postSave(fixture.runId, {
        outcome: "rejected",
        rationaleByOutcome: {
          rejected: "The failed run is useful as a negative eval case.",
        },
        reviewerAgentId: reviewer.id,
      });
      assert.equal(rejected.status, 409);
      assert.equal(rejected.body.error?.code, "failed_trace_confirmation_required");

      const accepted = await postSave(fixture.runId, {
        outcome: "rejected",
        rationaleByOutcome: {
          rejected: "The failed run is useful as a negative eval case.",
        },
        reviewerAgentId: reviewer.id,
        confirmFailedTrace: true,
      });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.body.evalCase?.review.outcome, "rejected");
      assert.ok(accepted.body.warnings?.some((warning) => warning.includes("failed")));
    });

    await test("partial capture requires explicit low-capture confirmation", async () => {
      const fixture = createRunFixture({
        taskStatus: "review",
        includeWorkspaceVisibility: false,
      });
      const rejected = await postSave(fixture.runId, {
        outcome: "returned",
        rationaleByOutcome: {
          returned: "The trace has enough evidence to document a return decision.",
        },
        reviewerAgentId: reviewer.id,
      });
      assert.equal(rejected.status, 409);
      assert.equal(rejected.body.error?.code, "capture_quality_confirmation_required");

      const accepted = await postSave(fixture.runId, {
        outcome: "returned",
        rationaleByOutcome: {
          returned: "The trace has enough evidence to document a return decision.",
        },
        reviewerAgentId: reviewer.id,
        confirmPartialCapture: true,
      });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.body.evalCase?.captureQuality, "partial");
      assert.ok(accepted.body.warnings?.some((warning) => warning.includes("partial")));
    });
  } finally {
    workspaceIsolation.dispose();
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
