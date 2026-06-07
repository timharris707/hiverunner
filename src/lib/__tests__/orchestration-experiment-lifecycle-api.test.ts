import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { NextRequest } from "next/server";

import { createFixtureAgent, createFixtureProject } from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-experiment-lifecycle-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

function request(url: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function responseBody<T>(response: Response): Promise<{ status: number; body: T }> {
  return {
    status: response.status,
    body: await response.json() as T,
  };
}

function expectApiError(fn: () => unknown, code: string): void {
  assert.throws(
    fn,
    (error) => typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === code,
  );
}

function removeTestDatabaseFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

async function run() {
  console.log("\nOrchestration Experiment Lifecycle Service and API Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  removeTestDatabaseFiles(dbPath);

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-experiment-lifecycle-",
  });

  try {
    const { POST: createRoute, GET: listRoute } = await import("@/app/api/orchestration/companies/[slug]/experiments/route");
    const { GET: detailRoute, PATCH: patchRoute } = await import("@/app/api/orchestration/companies/[slug]/experiments/[experimentId]/route");
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const {
      createExperimentDraft,
      approveExperimentVariants,
      recordExperimentAttempt,
      saveExperimentReport,
    } = await import("@/lib/orchestration/experiments");
    const { createEvalCase, RUN_TRACE_REDACTED_EXPORT_SCHEMA, RUN_TRACE_REDACTION_POLICY } = await import("@/lib/orchestration/eval-cases");
    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);

    const stamp = Date.now();
    const company = createCompany({
      name: `Experiment API ${stamp}`,
      description: "Experiment lifecycle fixture company.",
      status: "active",
    }).company;
    db.prepare("UPDATE companies SET company_code = ? WHERE id = ?").run("INS", company.id);
    const otherCompany = createCompany({
      name: `Other Experiment API ${stamp}`,
      description: "Other company scope fixture.",
      status: "active",
    }).company;

    const project = createFixtureProject(createProject, {
      companyId: company.id,
      namePrefix: "Experiment Lifecycle Project",
      label: "api",
      description: "Experiment lifecycle fixture project.",
      color: "#0ea5e9",
      emoji: "E",
    });
    const agent = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "ExperimentRunner",
      openclawPrefix: "experiment-runner",
      emoji: "R",
      role: "Backend Engineer",
      skills: ["backend"],
    });
    const task = createTask({
      projectId: project.id,
      title: "Reviewed experiment source",
      description: "Source task for experiment lifecycle tests.",
      priority: "P1",
      type: "feature",
      status: "done",
      labels: ["experiments"],
      assignee: agent.id,
      createdBy: agent.id,
    }).task;
    const taskKey = task.key ?? task.id;
    const now = "2026-06-07T18:00:00.000Z";
    const runId = `experiment-run-${randomUUID()}`;
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
          error_message, token_usage_json, duration_ms, idempotency_key, execution_engine,
          runner_provider, runner_model, model_lane, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, 'codex', 'experiment-session', 'completed', ?, ?, NULL, '{}', 42000,
          ?, 'hiverunner', 'openai', 'gpt-5.5', 'default', '{}', ?, ?)`,
    ).run(runId, task.id, agent.id, now, now, `run-${runId}`, now, now);

    const pendingRunId = `experiment-pending-run-${randomUUID()}`;
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
          error_message, token_usage_json, duration_ms, idempotency_key, execution_engine,
          runner_provider, runner_model, model_lane, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, 'codex', 'experiment-session-pending', 'running', ?, NULL, NULL, '{}', NULL,
          ?, 'hiverunner', 'openai', 'gpt-5.5', 'default', '{}', ?, ?)`,
    ).run(pendingRunId, task.id, agent.id, now, `run-${pendingRunId}`, now, now);

    const evalCase = createEvalCase({
      companyId: company.id,
      projectId: project.id,
      sourceTask: {
        id: task.id,
        key: taskKey,
        title: "Reviewed experiment source",
        type: "feature",
      },
      sourceRun: {
        id: runId,
        traceRoute: `/companies/${company.slug}/tasks/${taskKey}/runs/${runId}`,
        executionEngine: "hiverunner",
        runnerProvider: "openai",
        providerId: "codex",
        runnerModel: "gpt-5.5",
        agentId: agent.id,
        agentName: agent.name,
      },
      review: {
        outcome: "accepted",
        rationale: "Reviewed source has enough evidence for an experiment.",
        reviewedAt: now,
      },
      captureQuality: "complete",
      evidenceGaps: [],
      redactedSnapshot: {
        schema: RUN_TRACE_REDACTED_EXPORT_SCHEMA,
        redaction: {
          policy: RUN_TRACE_REDACTION_POLICY,
          redactedAt: now,
          categories: {},
        },
        run: { id: runId, taskKey },
      } as never,
      idempotencyKey: `eval-${runId}`,
      createdByAgentId: agent.id,
      createdAt: now,
    }, db);

    await test("creates idempotent draft experiments from Eval Case sources with snapshot defaults", () => {
      const experiment = createExperimentDraft({
        companyIdOrSlug: company.slug,
        source: { kind: "eval_case", id: evalCase.id },
        objective: "reduce_review_returns",
        variants: [{
          key: "handoff-evidence",
          name: "Evidence-focused handoff",
          changeType: "prompt",
          plannedChange: { promptDelta: "Require source-linked verification." },
        }],
        idempotencyKey: "experiment-eval-source",
        createdByAgentId: agent.id,
      }, db);

      assert.equal(experiment.status, "draft");
      assert.equal(experiment.sourceKind, "eval_case");
      assert.equal(experiment.primarySourceEvalCaseId, evalCase.id);
      assert.equal(experiment.primarySourceRunId, runId);
      assert.equal(experiment.workspaceMode, "snapshot");
      assert.equal(experiment.objective, "reduce_review_returns");
      assert.deepEqual(experiment.limits, { variantCap: 2, attemptLimit: 3, timeboxMinutes: 30 });
      assert.equal(experiment.variants.length, 1);

      const replayed = createExperimentDraft({
        companyIdOrSlug: company.slug,
        source: { kind: "eval_case", id: evalCase.id },
        objective: "reduce_review_returns",
        idempotencyKey: "experiment-eval-source",
      }, db);
      assert.equal(replayed.id, experiment.id);
    });

    await test("rejects invalid sources and company-scope mismatches", () => {
      expectApiError(
        () => createExperimentDraft({
          companyIdOrSlug: otherCompany.slug,
          source: { kind: "eval_case", id: evalCase.id },
          objective: "reduce_review_returns",
        }, db),
        "experiment_source_company_scope_mismatch",
      );
      expectApiError(
        () => createExperimentDraft({
          companyIdOrSlug: company.slug,
          source: { kind: "run_trace", id: pendingRunId },
          objective: "improve_acceptance",
        }, db),
        "run_trace_source_not_terminal",
      );
      expectApiError(
        () => createExperimentDraft({
          companyIdOrSlug: company.slug,
          source: { kind: "eval_case", id: "missing-eval-case" },
          objective: "improve_acceptance",
        }, db),
        "experiment_source_not_found",
      );
    });

    await test("enforces objectives, workspace defaults, live governance, variant caps, and hard limits", () => {
      expectApiError(
        () => createExperimentDraft({
          companyIdOrSlug: company.slug,
          source: { kind: "eval_case", id: evalCase.id },
          objective: "unknown" as never,
        }, db),
        "invalid_experiment_objective",
      );
      expectApiError(
        () => createExperimentDraft({
          companyIdOrSlug: company.slug,
          source: { kind: "eval_case", id: evalCase.id },
          objective: "shorten_runtime",
          workspaceMode: "live",
        }, db),
        "live_workspace_requires_governed_selection",
      );
      expectApiError(
        () => createExperimentDraft({
          companyIdOrSlug: company.slug,
          source: { kind: "eval_case", id: evalCase.id },
          objective: "reduce_cost",
          limits: { variantCap: 4 },
        }, db),
        "experiment_limit_out_of_range",
      );
      expectApiError(
        () => createExperimentDraft({
          companyIdOrSlug: company.slug,
          source: { kind: "eval_case", id: evalCase.id },
          objective: "reduce_cost",
          limits: { variantCap: 3 },
          variants: ["a", "b", "c", "d"].map((key) => ({ key, name: `Variant ${key}` })),
        }, db),
        "experiment_variant_count_out_of_range",
      );
      expectApiError(
        () => createExperimentDraft({
          companyIdOrSlug: company.slug,
          source: { kind: "eval_case", id: evalCase.id },
          objective: "reduce_cost",
          limits: { variantCap: 1 },
          variants: [
            { key: "over-cap-a", name: "Over cap A" },
            { key: "over-cap-b", name: "Over cap B" },
          ],
        }, db),
        "experiment_variant_cap_exceeded",
      );

      const live = createExperimentDraft({
        companyIdOrSlug: company.slug,
        source: { kind: "eval_case", id: evalCase.id },
        objective: "shorten_runtime",
        workspaceMode: "live",
        liveWorkspaceConfirmed: true,
        liveWorkspaceReason: "Operator explicitly selected live workspace mode for governed comparison.",
        variants: [{ key: "live-a", name: "Live variant" }],
      }, db);
      assert.equal(live.workspaceMode, "live");
      expectApiError(
        () => approveExperimentVariants({
          companyIdOrSlug: company.slug,
          experimentId: live.id,
          variantKeys: ["live-a"],
        }, db),
        "live_workspace_requires_governed_selection",
      );
      const liveApproved = approveExperimentVariants({
        companyIdOrSlug: company.slug,
        experimentId: live.id,
        variantKeys: ["live-a"],
        liveWorkspaceConfirmed: true,
        liveWorkspaceReason: "Operator re-confirmed live workspace mode during variant approval.",
      }, db);
      assert.equal(liveApproved.status, "approved");
    });

    let approvedExperimentId = "";
    let approvedVariantA = "";
    let approvedVariantB = "";

    await test("approves one to three selected variants and records attempt lifecycle transitions", () => {
      const experiment = createExperimentDraft({
        companyIdOrSlug: company.slug,
        source: { kind: "run_trace", id: runId },
        objective: "improve_acceptance",
        limits: { variantCap: 3, attemptLimit: 3, timeboxMinutes: 20 },
        variants: [{
          key: "variant-a",
          name: "Variant A",
          changeType: "prompt",
          plannedChange: { promptDelta: "Add explicit verification." },
        }, {
          key: "variant-b",
          name: "Variant B",
          changeType: "runner_model",
          plannedChange: { model: "gpt-5.4-mini" },
        }, {
          key: "variant-c",
          name: "Variant C",
          changeType: "context_package",
          plannedChange: { context: "shorter handoff" },
        }],
      }, db);

      expectApiError(
        () => recordExperimentAttempt({
          companyIdOrSlug: company.slug,
          experimentId: experiment.id,
          variantKey: "variant-a",
          attemptNumber: 1,
          status: "queued",
        }, db),
        "experiment_variant_not_approved",
      );

      expectApiError(
        () => approveExperimentVariants({
          companyIdOrSlug: company.slug,
          experimentId: experiment.id,
          variantKeys: [],
        }, db),
        "experiment_variant_count_out_of_range",
      );

      const approved = approveExperimentVariants({
        companyIdOrSlug: company.slug,
        experimentId: experiment.id,
        variantKeys: ["variant-a", "variant-b"],
        approvedByAgentId: agent.id,
      }, db);
      approvedExperimentId = approved.id;
      approvedVariantA = approved.variants.find((variant) => variant.key === "variant-a")?.id ?? "";
      approvedVariantB = approved.variants.find((variant) => variant.key === "variant-b")?.id ?? "";

      assert.equal(approved.status, "approved");
      assert.equal(approved.variants.find((variant) => variant.key === "variant-a")?.status, "approved");
      assert.equal(approved.variants.find((variant) => variant.key === "variant-c")?.status, "rejected");

      const queued = recordExperimentAttempt({
        companyIdOrSlug: company.slug,
        experimentId: approved.id,
        variantKey: "variant-a",
        attemptNumber: 1,
        status: "queued",
      }, db);
      assert.equal(queued.status, "running");
      assert.equal(queued.attempts[0]?.status, "queued");

      const running = recordExperimentAttempt({
        companyIdOrSlug: company.slug,
        experimentId: approved.id,
        variantKey: "variant-a",
        attemptNumber: 1,
        status: "running",
        workspaceRef: "snapshot:/tmp/experiment-attempt-1",
      }, db);
      assert.equal(running.attempts[0]?.status, "running");

      const succeeded = recordExperimentAttempt({
        companyIdOrSlug: company.slug,
        experimentId: approved.id,
        variantId: approvedVariantA,
        attemptNumber: 1,
        status: "succeeded",
        executionRunId: runId,
        evalCaseId: evalCase.id,
        traceRoute: `/companies/${company.slug}/tasks/${taskKey}/runs/${runId}`,
        comparisonSnapshot: { accepted: true, score: 0.92 },
      }, db);
      assert.equal(succeeded.status, "reporting");
      assert.equal(succeeded.attempts[0]?.status, "succeeded");

      expectApiError(
        () => recordExperimentAttempt({
          companyIdOrSlug: company.slug,
          experimentId: approved.id,
          variantId: approvedVariantA,
          attemptNumber: 1,
          status: "running",
        }, db),
        "invalid_attempt_lifecycle_transition",
      );
      expectApiError(
        () => recordExperimentAttempt({
          companyIdOrSlug: company.slug,
          experimentId: approved.id,
          variantId: approvedVariantB,
          attemptNumber: 4,
          status: "queued",
        }, db),
        "experiment_attempt_limit_exceeded",
      );
    });

    await test("stores redacted comparison report state and evidence links", () => {
      const report = saveExperimentReport({
        companyIdOrSlug: company.slug,
        experimentId: approvedExperimentId,
        status: "generated",
        summary: "Variant A produced stronger source-linked evidence.",
        report: {
          title: "Comparison report",
          summary: "The better variant did not leak sk-proj-1234567890abcdefghijklmnop.",
          variants: [{ id: approvedVariantA, outcome: "better" }],
        },
        conclusion: {
          outcome: "variant_wins",
          reason: "Stronger verification evidence.",
        },
        winningVariantId: approvedVariantA,
        generatedByAgentId: agent.id,
      }, db);

      assert.equal(report.status, "generated");
      assert.equal(report.winningVariantId, approvedVariantA);
      assert.doesNotMatch(JSON.stringify(report.redactedPayload), /sk-proj-1234567890abcdefghijklmnop/);
      const evidence = db
        .prepare("SELECT report_id, evidence_type FROM experiment_evidence_attachments WHERE report_id = ?")
        .get(report.id) as { report_id: string; evidence_type: string } | undefined;
      assert.equal(evidence?.report_id, report.id);
      assert.equal(evidence?.evidence_type, "comparison_report");
    });

    await test("company experiment API creates, lists, updates, and scopes lifecycle records", async () => {
      const created = await responseBody<{
        experiment: { id: string; sourceKind: string; variants: Array<{ key: string }> };
      }>(
        await createRoute(request(`http://localhost/api/orchestration/companies/${company.slug}/experiments`, "POST", {
          source: { kind: "eval_case", id: evalCase.id },
          objective: "reduce_review_returns",
          variants: [{ key: "api-variant", name: "API Variant" }],
          idempotencyKey: "api-experiment",
        }), { params: Promise.resolve({ slug: company.slug }) }),
      );
      assert.equal(created.status, 201);
      assert.equal(created.body.experiment.sourceKind, "eval_case");

      const invalidVariants = await responseBody<{ error: { code: string } }>(
        await createRoute(request(`http://localhost/api/orchestration/companies/${company.slug}/experiments`, "POST", {
          source: { kind: "eval_case", id: evalCase.id },
          objective: "reduce_review_returns",
          limits: { variantCap: 3 },
          variants: ["api-a", "api-b", "api-c", "api-d"].map((key) => ({ key, name: key })),
        }), { params: Promise.resolve({ slug: company.slug }) }),
      );
      assert.equal(invalidVariants.status, 400);
      assert.equal(invalidVariants.body.error.code, "experiment_variant_count_out_of_range");

      const listed = await responseBody<{ experiments: Array<{ id: string }> }>(
        await listRoute(request(`http://localhost/api/orchestration/companies/${company.slug}/experiments?sourceKind=eval_case`), {
          params: Promise.resolve({ slug: company.slug }),
        }),
      );
      assert.equal(listed.status, 200);
      assert.ok(listed.body.experiments.some((experiment) => experiment.id === created.body.experiment.id));

      const approved = await responseBody<{ experiment: { status: string; variants: Array<{ key: string; status: string }> } }>(
        await patchRoute(request(`http://localhost/api/orchestration/companies/${company.slug}/experiments/${created.body.experiment.id}`, "PATCH", {
          action: "approve_variants",
          variantKeys: ["api-variant"],
          approvedByAgentId: agent.id,
        }), { params: Promise.resolve({ slug: company.slug, experimentId: created.body.experiment.id }) }),
      );
      assert.equal(approved.status, 200);
      assert.equal(approved.body.experiment.status, "approved");

      const attempt = await responseBody<{ experiment: { attempts: Array<{ status: string }> } }>(
        await patchRoute(request(`http://localhost/api/orchestration/companies/${company.slug}/experiments/${created.body.experiment.id}`, "PATCH", {
          action: "record_attempt",
          variantKey: "api-variant",
          attemptNumber: 1,
          status: "cancelled",
          traceRoute: `/companies/${company.slug}/tasks/${taskKey}/runs/${runId}`,
        }), { params: Promise.resolve({ slug: company.slug, experimentId: created.body.experiment.id }) }),
      );
      assert.equal(attempt.status, 200);
      assert.equal(attempt.body.experiment.attempts[0]?.status, "cancelled");

      const detail = await responseBody<{ experiment: { id: string; status: string } }>(
        await detailRoute(request(`http://localhost/api/orchestration/companies/${company.slug}/experiments/${created.body.experiment.id}`), {
          params: Promise.resolve({ slug: company.slug, experimentId: created.body.experiment.id }),
        }),
      );
      assert.equal(detail.status, 200);
      assert.equal(detail.body.experiment.id, created.body.experiment.id);

      const scoped = await responseBody<{ error: { code: string } }>(
        await detailRoute(request(`http://localhost/api/orchestration/companies/${otherCompany.slug}/experiments/${created.body.experiment.id}`), {
          params: Promise.resolve({ slug: otherCompany.slug, experimentId: created.body.experiment.id }),
        }),
      );
      assert.equal(scoped.status, 403);
      assert.equal(scoped.body.error.code, "experiment_company_scope_mismatch");
    });
  } finally {
    workspaceIsolation.dispose();
    removeTestDatabaseFiles(dbPath);
  }
}

run()
  .then(() => finish())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
