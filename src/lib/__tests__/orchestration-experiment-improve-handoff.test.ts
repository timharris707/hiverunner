import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createFixtureAgent, createFixtureProject } from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-experiment-improve-handoff-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

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

const CREDENTIAL_SHAPED = "sk-proj-1234567890abcdefghijklmnop";

async function run() {
  console.log("\nOrchestration Experiment Comparison Report and Improve Handoff Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  removeTestDatabaseFiles(dbPath);

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-experiment-handoff-",
  });

  try {
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const {
      createExperimentDraft,
      approveExperimentVariants,
      recordExperimentAttempt,
      saveExperimentReport,
      buildExperimentComparisonReport,
      createImproveRecommendationFromExperimentReport,
    } = await import("@/lib/orchestration/experiments");
    const { listImproveRecommendations } = await import("@/lib/orchestration/improvement-recommendations");
    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);

    const stamp = Date.now();
    const company = createCompany({
      name: `Experiment Handoff ${stamp}`,
      description: "Experiment Improve handoff fixture company.",
      status: "active",
    }).company;
    db.prepare("UPDATE companies SET company_code = ? WHERE id = ?").run("INS", company.id);

    const project = createFixtureProject(createProject, {
      companyId: company.id,
      namePrefix: "Experiment Handoff Project",
      label: "handoff",
      description: "Experiment handoff fixture project.",
      color: "#0ea5e9",
      emoji: "H",
    });
    const agent = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "HandoffRunner",
      openclawPrefix: "handoff-runner",
      emoji: "R",
      role: "Backend Engineer",
      skills: ["backend"],
    });
    const task = createTask({
      projectId: project.id,
      title: "Reviewed experiment source",
      description: "Source task for experiment handoff tests.",
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
       VALUES (?, ?, ?, 'codex', 'handoff-session', 'completed', ?, ?, NULL, ?, 42000,
          ?, 'hiverunner', 'openai', 'gpt-5.5', 'default', '{}', ?, ?)`,
    ).run(runId, task.id, agent.id, now, now, JSON.stringify({ totalTokens: 18000, costUsd: 0.21 }), `run-${runId}`, now, now);

    function countRecommendations(): number {
      return listImproveRecommendations(company.slug, { includeSuppressed: true, limit: 200 }, db).total;
    }

    // Build an approved experiment with two attempts across two variants.
    const experiment = createExperimentDraft({
      companyIdOrSlug: company.slug,
      source: { kind: "run_trace", id: runId },
      objective: "improve_acceptance",
      limits: { variantCap: 3, attemptLimit: 3, timeboxMinutes: 20 },
      variants: [
        { key: "variant-a", name: "Variant A", changeType: "prompt", plannedChange: { promptDelta: "Add verification." } },
        { key: "variant-b", name: "Variant B", changeType: "runner_model", plannedChange: { model: "gpt-5.4-mini" } },
      ],
      createdByAgentId: agent.id,
    }, db);

    const approved = approveExperimentVariants({
      companyIdOrSlug: company.slug,
      experimentId: experiment.id,
      variantKeys: ["variant-a", "variant-b"],
      approvedByAgentId: agent.id,
    }, db);
    const variantA = approved.variants.find((variant) => variant.key === "variant-a")?.id ?? "";
    const variantB = approved.variants.find((variant) => variant.key === "variant-b")?.id ?? "";

    const traceRoute = `/companies/${company.slug}/tasks/${taskKey}/runs/${runId}`;
    recordExperimentAttempt({
      companyIdOrSlug: company.slug,
      experimentId: approved.id,
      variantId: variantA,
      attemptNumber: 1,
      status: "succeeded",
      executionRunId: runId,
      traceRoute,
      comparisonSnapshot: { accepted: true, score: 0.92, outcome: "better_evidence", evidenceQuality: "strong" },
    }, db);
    recordExperimentAttempt({
      companyIdOrSlug: company.slug,
      experimentId: approved.id,
      variantId: variantB,
      attemptNumber: 1,
      status: "failed",
      executionRunId: runId,
      traceRoute,
      errorMessage: "Runner timed out reaching the tool runtime.",
      comparisonSnapshot: { accepted: false, score: 0.41, outcome: "regressed" },
    }, db);

    let reportId = "";

    await test("generated report is redacted, source-linked, evidence-attached, and includes all attempts", () => {
      const payload = buildExperimentComparisonReport(company.slug, approved.id, db);
      // Built report covers every recorded attempt plus the original-source baseline.
      assert.equal((payload.attempts as unknown[]).length, 2);
      assert.equal(payload.attemptCount, 2);
      assert.ok(payload.baseline, "baseline (original source) should be present");
      const variantKeys = (payload.attempts as Array<{ variantKey: string }>).map((entry) => entry.variantKey).sort();
      assert.deepEqual(variantKeys, ["variant-a", "variant-b"]);

      // Inject a credential-shaped value to prove save-time redaction.
      const report = saveExperimentReport({
        companyIdOrSlug: company.slug,
        experimentId: approved.id,
        status: "generated",
        summary: `Variant A wins. Operator note leaked ${CREDENTIAL_SHAPED} but it must be redacted.`,
        report: { ...payload, operatorNote: `secret ${CREDENTIAL_SHAPED}` },
        conclusion: { outcome: "variant_wins", reason: "Stronger verification evidence." },
        winningVariantId: variantA,
        generatedByAgentId: agent.id,
      }, db);
      reportId = report.id;

      assert.equal(report.status, "generated");
      assert.doesNotMatch(JSON.stringify(report.redactedPayload), new RegExp(CREDENTIAL_SHAPED));
      assert.doesNotMatch(JSON.stringify(report.redactionSummary ?? {}), new RegExp(CREDENTIAL_SHAPED));

      // Source-linked: run trace + task links resolved on the report.
      const linkTypes = report.links.map((entry) => entry.type);
      assert.ok(linkTypes.includes("run_trace"), "report should link the source run trace");
      assert.ok(linkTypes.includes("task"), "report should link the source task");

      // Attached as evidence on the experiment.
      const evidence = db
        .prepare("SELECT report_id, evidence_type FROM experiment_evidence_attachments WHERE report_id = ?")
        .get(report.id) as { report_id: string; evidence_type: string } | undefined;
      assert.equal(evidence?.report_id, report.id);
      assert.equal(evidence?.evidence_type, "comparison_report");

      // The saved report payload still references all attempts after redaction.
      const redactedReport = (report.redactedPayload as { report?: { attempts?: unknown[] } } | undefined)?.report;
      assert.equal(redactedReport?.attempts?.length, 2);
    });

    await test("generating a report does not create an Improve recommendation by default", () => {
      assert.equal(countRecommendations(), 0);
      const report = saveExperimentReport({
        companyIdOrSlug: company.slug,
        experimentId: approved.id,
        id: reportId,
        status: "generated",
        summary: "Regenerated without a recommendation.",
        report: buildExperimentComparisonReport(company.slug, approved.id, db),
        winningVariantId: variantA,
        generatedByAgentId: agent.id,
      }, db);
      assert.equal(report.recommendationId, null);
      assert.equal(countRecommendations(), 0);
    });

    await test("Improve handoff is refused until the report is accepted or a trigger is configured", () => {
      expectApiError(
        () => createImproveRecommendationFromExperimentReport({
          companyIdOrSlug: company.slug,
          experimentId: approved.id,
          reportId,
        }, db),
        "experiment_report_handoff_not_governed",
      );
      assert.equal(countRecommendations(), 0);
    });

    await test("configured trigger evidence is a governed creation path", () => {
      const result = createImproveRecommendationFromExperimentReport({
        companyIdOrSlug: company.slug,
        experimentId: approved.id,
        reportId,
        trigger: { configured: true, triggerKey: "experiment_triggered_report", reason: "Configured acceptance trigger." },
        createdByAgentId: agent.id,
      }, db);
      assert.equal(result.pathway, "triggered");
      assert.equal(countRecommendations(), 1);
      assert.equal(result.recommendation.evidence.summaries[0]?.sourceType, "experiment_report");

      // Report is linked back to the recommendation, and the call is idempotent.
      assert.equal(result.report.recommendationId, result.recommendation.id);
      const replay = createImproveRecommendationFromExperimentReport({
        companyIdOrSlug: company.slug,
        experimentId: approved.id,
        reportId,
        trigger: { configured: true },
      }, db);
      assert.equal(replay.recommendation.id, result.recommendation.id);
      assert.equal(countRecommendations(), 1);

      const linkedEvidence = db
        .prepare("SELECT recommendation_id FROM experiment_evidence_attachments WHERE report_id = ?")
        .get(reportId) as { recommendation_id: string | null } | undefined;
      assert.equal(linkedEvidence?.recommendation_id, result.recommendation.id);
    });

    await test("operator acceptance is the second governed creation path", () => {
      // A fresh accepted report (no recommendation yet) hands off via the accepted path.
      const acceptedReport = saveExperimentReport({
        companyIdOrSlug: company.slug,
        experimentId: approved.id,
        status: "accepted",
        summary: "Operator-accepted comparison report.",
        report: buildExperimentComparisonReport(company.slug, approved.id, db),
        winningVariantId: variantA,
        generatedByAgentId: agent.id,
      }, db);
      assert.equal(acceptedReport.status, "accepted");
      assert.equal(acceptedReport.recommendationId, null);

      const result = createImproveRecommendationFromExperimentReport({
        companyIdOrSlug: company.slug,
        experimentId: approved.id,
        reportId: acceptedReport.id,
        createdByAgentId: agent.id,
      }, db);
      assert.equal(result.pathway, "accepted");
      assert.equal(result.report.recommendationId, result.recommendation.id);
      assert.equal(countRecommendations(), 2);
    });

    await test("handoff rejects reports from another experiment scope", () => {
      expectApiError(
        () => createImproveRecommendationFromExperimentReport({
          companyIdOrSlug: company.slug,
          experimentId: approved.id,
          reportId: "missing-report",
          trigger: { configured: true },
        }, db),
        "experiment_report_not_found",
      );
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
