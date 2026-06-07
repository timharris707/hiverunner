import assert from "node:assert";

import { createCompany } from "@/lib/orchestration/company-service";
import { createProject, createTask } from "@/lib/orchestration/service";
import {
  acceptImprovementRecommendationsForApproval,
  createImprovementApprovalBridgeRecommendation,
  getImprovementApprovalBridgeRecommendation,
  listImprovementApprovalLinksForApproval,
} from "@/lib/orchestration/service/improvement-approval";
import { updateImproveRecommendation } from "@/lib/orchestration/improvement-recommendations";
import { updateApprovalStatus } from "@/lib/orchestration/service/approval";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner();

function createFixture() {
  const stamp = Date.now();
  const company = createCompany({
    name: `Improve Approval Bridge ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Improve Project ${stamp}`,
    description: "fixture project",
    color: "#0ea5e9",
    emoji: "icon:sparkles",
    status: "active",
  }).project;
  const task = createTask({
    projectId: project.id,
    title: "Keep existing task title",
    description: "Durable task state should not change when approval is denied.",
    priority: "P2",
    type: "feature",
    status: "in-progress",
    labels: [],
    createdBy: "test",
  }).task;

  return { company, project, task };
}

function createRecommendation(input: {
  companyId: string;
  projectId: string;
  title: string;
  evidenceId: string;
}) {
  return createImprovementApprovalBridgeRecommendation({
    companyIdOrSlug: input.companyId,
    triggerKey: "repeated_review_return",
    scopeType: "project",
    scopeKey: input.projectId,
    title: input.title,
    rationale: "Repeated review findings show this change would reduce operator rework.",
    proposedChange: "Stage a low-risk template guidance update.",
    severity: "high",
    confidence: "high",
    evidence: [
      {
        id: input.evidenceId,
        kind: "eval_case",
        summary: "Reviewer returned the same missing-guidance issue twice with token sk-proj-1234567890abcdefghijklmnop.",
        redacted: true,
      },
    ],
    currentRecommendation: {
      preview: {
        kind: "text_diff",
        before: "No guidance",
        after: "Add explicit review guidance",
      },
    },
  }).recommendation;
}

async function run() {
  console.log("\nOrchestration Improvement Approval Bridge Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const { company, project, task } = createFixture();

  await test("accepted recommendations create governed approval packages with evidence and rollback notes", () => {
    const recommendation = createRecommendation({
      companyId: company.id,
      projectId: project.id,
      title: "Add review-backed template guidance",
      evidenceId: "eval-evidence-1",
    });

    const result = acceptImprovementRecommendationsForApproval({
      companyIdOrSlug: company.id,
      recommendationIds: [recommendation.id],
      title: "Approve Improve package: template guidance",
      riskNotes: "Low risk because the package only stages a guidance update for approval.",
      rollbackNotes: "Rollback by restoring the prior template guidance version.",
      preview: {
        kind: "text_diff",
        before: "No guidance",
        after: "Add explicit review guidance",
      },
    });

    assert.strictEqual(result.approval.type, "approve_ceo_strategy");
    assert.strictEqual(result.approval.status, "pending");
    assert.strictEqual(result.approval.payload.source, "improve");
    assert.strictEqual(result.approval.payload.title, "Approve Improve package: template guidance");
    assert.strictEqual(result.approval.payload.improvementRecommendationId, recommendation.id);
    assert.deepStrictEqual(result.approval.payload.improvementRecommendationIds, [recommendation.id]);
    assert.deepStrictEqual(result.approval.payload.recommendationIds, [recommendation.id]);

    const approvalPackage = result.approval.payload.approvalPackage as Record<string, unknown>;
    assert.strictEqual(approvalPackage.schema, "hiverunner.improvement_approval_package.v1");
    assert.strictEqual(approvalPackage.rollbackNotes, "Rollback by restoring the prior template guidance version.");
    assert.strictEqual(approvalPackage.riskNotes, "Low risk because the package only stages a guidance update for approval.");
    assert.ok(Array.isArray(approvalPackage.evidence));
    assert.strictEqual((approvalPackage.evidence as unknown[]).length, 1);
    assert.doesNotMatch(JSON.stringify(result.approval.payload), /sk-proj-/);
    assert.match(JSON.stringify(result.approval.payload), /\[redacted\]/);

    const links = approvalPackage.improveBackLinks as Array<{ href: string }>;
    assert.ok(links[0]?.href.includes("/improve?recommendation="));
    assert.deepStrictEqual(result.approval.payload.improveBackLinks, links);
    assert.strictEqual(result.links[0]?.status, "submitted");

    const accepted = getImprovementApprovalBridgeRecommendation({
      companyIdOrSlug: company.id,
      recommendationId: recommendation.id,
    }).recommendation;
    assert.strictEqual(accepted.status, "accepted-for-approval");
    assert.strictEqual(accepted.approvalId, result.approval.id);
  });

  await test("approval rejection syncs back without changing durable task state", () => {
    const recommendation = createRecommendation({
      companyId: company.id,
      projectId: project.id,
      title: "Rename task after review pattern",
      evidenceId: "eval-evidence-2",
    });
    const result = acceptImprovementRecommendationsForApproval({
      companyIdOrSlug: company.id,
      recommendationIds: [recommendation.id],
      rollbackNotes: "Rollback by leaving the current task title unchanged.",
      riskNotes: "Risk is limited to task metadata if later applied.",
    });

    updateApprovalStatus({
      approvalId: result.approval.id,
      status: "rejected",
      decidedByUserId: "operator",
      decisionNote: "Not the right fix.",
    });

    const db = getOrchestrationDb();
    const taskRow = db.prepare("SELECT title FROM tasks WHERE id = ?").get(task.id) as { title: string };
    assert.strictEqual(taskRow.title, "Keep existing task title");

    const synced = getImprovementApprovalBridgeRecommendation({
      companyIdOrSlug: company.id,
      recommendationId: recommendation.id,
    }).recommendation;
    assert.strictEqual(synced.status, "accepted-for-approval");
    assert.strictEqual(synced.approvalId, result.approval.id);

    const links = listImprovementApprovalLinksForApproval({ approvalId: result.approval.id }).links;
    assert.strictEqual(links[0]?.status, "rejected");
  });

  await test("approval approval syncs decision without applying; explicit apply is separate", () => {
    const recommendation = createRecommendation({
      companyId: company.id,
      projectId: project.id,
      title: "Apply only after explicit Improve transition",
      evidenceId: "eval-evidence-approved",
    });
    const result = acceptImprovementRecommendationsForApproval({
      companyIdOrSlug: company.id,
      recommendationIds: [recommendation.id],
      rollbackNotes: "Rollback by leaving the current task title unchanged unless a later apply is explicitly executed.",
      riskNotes: "Approval records governance only; it must not auto-apply durable Improve changes.",
    });

    updateApprovalStatus({
      approvalId: result.approval.id,
      status: "approved",
      decidedByUserId: "operator",
      decisionNote: "Approved for a separate governed apply step.",
    });

    const db = getOrchestrationDb();
    const taskRow = db.prepare("SELECT title FROM tasks WHERE id = ?").get(task.id) as { title: string };
    assert.strictEqual(taskRow.title, "Keep existing task title");

    const approved = getImprovementApprovalBridgeRecommendation({
      companyIdOrSlug: company.id,
      recommendationId: recommendation.id,
    }).recommendation;
    assert.strictEqual(approved.status, "accepted-for-approval");
    assert.strictEqual(approved.approvalId, result.approval.id);
    const approvedRow = db
      .prepare("SELECT status, applied_at FROM improvement_recommendations WHERE id = ?")
      .get(recommendation.id) as { status: string; applied_at: string | null };
    assert.strictEqual(approvedRow.status, "accepted-for-approval");
    assert.strictEqual(approvedRow.applied_at, null);

    const links = listImprovementApprovalLinksForApproval({ approvalId: result.approval.id }).links;
    assert.strictEqual(links[0]?.status, "approved");

    const applied = updateImproveRecommendation(company.id, recommendation.id, {
      action: "transition",
      status: "applied",
      approvalId: result.approval.id,
      reason: "Operator completed the separate governed apply step.",
      actorUserId: "operator",
    }).recommendation;
    assert.strictEqual(applied.status, "applied");
    assert.ok(applied.appliedAt);
    assert.strictEqual(applied.approvalId, result.approval.id);
  });

  await test("cancelled approval state syncs separately from Improve status", () => {
    const recommendation = createRecommendation({
      companyId: company.id,
      projectId: project.id,
      title: "Suppress stale recommendation after package review",
      evidenceId: "eval-evidence-3",
    });
    const result = acceptImprovementRecommendationsForApproval({
      companyIdOrSlug: company.id,
      recommendationIds: [recommendation.id],
      rollbackNotes: "Correction path is to leave the recommendation un-applied and reopen only with new evidence.",
      riskNotes: "Cancelling the approval should not dismiss or apply the recommendation.",
    });

    updateApprovalStatus({
      approvalId: result.approval.id,
      status: "cancelled",
      decidedByUserId: "operator",
      decisionNote: "Approval package no longer applies.",
    });

    const synced = getImprovementApprovalBridgeRecommendation({
      companyIdOrSlug: company.id,
      recommendationId: recommendation.id,
    }).recommendation;
    assert.strictEqual(synced.status, "accepted-for-approval");
    assert.strictEqual(synced.approvalId, result.approval.id);

    const links = listImprovementApprovalLinksForApproval({ approvalId: result.approval.id }).links;
    assert.strictEqual(links[0]?.status, "cancelled");
  });

  await test("approval packages require rollback notes before governance submission", () => {
    const recommendation = createRecommendation({
      companyId: company.id,
      projectId: project.id,
      title: "Require rollback notes",
      evidenceId: "eval-evidence-4",
    });

    assert.throws(
      () => acceptImprovementRecommendationsForApproval({
        companyIdOrSlug: company.id,
        recommendationIds: [recommendation.id],
      }),
      /rollback or correction notes/,
    );
  });

  await test("approval packages require concrete present evidence before governance submission", () => {
    const recommendation = createImprovementApprovalBridgeRecommendation({
      companyIdOrSlug: company.id,
      triggerKey: "repeated_review_return",
      scopeType: "project",
      scopeKey: project.id,
      title: "Reject placeholder-only evidence",
      rationale: "The package should not be governable without concrete evidence.",
      proposedChange: "Do not submit this approval package.",
      severity: "medium",
      confidence: "medium",
      evidence: [{}],
      currentRecommendation: {
        rollbackNotes: "Correction path is to collect evidence before approval.",
      },
    }).recommendation;

    assert.throws(
      () => acceptImprovementRecommendationsForApproval({
        companyIdOrSlug: company.id,
        recommendationIds: [recommendation.id],
      }),
      /at least one evidence item/,
    );
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
