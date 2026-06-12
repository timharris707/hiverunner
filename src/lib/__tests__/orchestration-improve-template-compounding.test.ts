/**
 * H4 — Improve → template compounding contract test.
 *
 * Approved agent-scoped improvement recommendations auto-patch the
 * originating role's onboarding-asset bucket: patch row (audit trail),
 * recommendation -> 'applied', loadOnboardingAssets merge, content-hash
 * dedupe, rollback, and the non-agent-scope terminus exemption.
 *
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-improve-template-compounding.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-improve-template-compounding.test.ts
 */

import assert from "node:assert/strict";

import { createCompany } from "@/lib/orchestration/company-service";
import { setCompanyLeadAgent } from "@/lib/orchestration/company-lead";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { loadOnboardingAssets } from "@/lib/orchestration/engine/engine";
import {
  listRoleTemplatePatches,
  rollbackRoleTemplatePatch,
} from "@/lib/orchestration/role-template-patches";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";
import { updateApprovalStatus } from "@/lib/orchestration/service/approval";
import {
  acceptImprovementRecommendationsForApproval,
  createImprovementApprovalBridgeRecommendation,
  getImprovementApprovalBridgeRecommendation,
} from "@/lib/orchestration/service/improvement-approval";
import { createIsolatedOrchestrationWorkspace, resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner();

function createRecommendation(input: {
  companyId: string;
  scopeType: "agent" | "project";
  scopeKey: string;
  title: string;
  proposedChange: string;
}) {
  return createImprovementApprovalBridgeRecommendation({
    companyIdOrSlug: input.companyId,
    triggerKey: "slow_expensive_run",
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    title: input.title,
    rationale: "Run evidence shows the role needs this playbook rule.",
    proposedChange: input.proposedChange,
    severity: "high",
    confidence: "high",
    evidence: [
      {
        id: `evidence-${Math.random().toString(36).slice(2, 8)}`,
        kind: "eval_case",
        summary: "Run outline repeated the same expensive detour twice.",
        redacted: true,
      },
    ],
    currentRecommendation: {},
  }).recommendation;
}

function acceptAndApprove(companyId: string, recommendationId: string) {
  const accepted = acceptImprovementRecommendationsForApproval({
    companyIdOrSlug: companyId,
    recommendationIds: [recommendationId],
    riskNotes: "Additive prompt guidance only.",
    rollbackNotes: "Roll back the template patch row via the template-patches API.",
  });
  updateApprovalStatus({
    approvalId: accepted.approval.id,
    status: "approved",
    decidedByUserId: "operator",
    decisionNote: "Approved for compounding.",
  });
  return accepted.approval;
}

async function run() {
  console.log("\nOrchestration Improve Template Compounding (H4) Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-template-compounding-",
  });

  try {
    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);

    const company = createCompany({
      name: `Compounding Co ${Date.now()}`,
      description: "H4 fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Compounding Project",
      description: "H4 fixture project",
      color: "#0ea5e9",
      emoji: "icon:sparkles",
      status: "active",
    }).project;
    const lead = createProjectAgent({
      projectId: project.id,
      companyId: company.id,
      name: "Oracle",
      emoji: "icon:eye",
      role: "Lead / Product Orchestrator",
      personality: "Strategic",
      status: "idle",
      skills: [],
    }).agent;
    const builder = createProjectAgent({
      projectId: project.id,
      companyId: company.id,
      name: "Ralph",
      emoji: "icon:wrench",
      role: "Backend Engineer",
      personality: "Methodical",
      status: "idle",
      skills: [],
    }).agent;
    setCompanyLeadAgent({ companyId: company.id, agentId: lead.id }, db);

    await test("approved agent-scoped recommendation patches the role bucket and flips to applied", () => {
      const recommendation = createRecommendation({
        companyId: company.id,
        scopeType: "agent",
        scopeKey: builder.id,
        title: "Run focused tests before registering artifacts",
        proposedChange: "Before registering any artifact, run the focused test suite for the touched module and include the pass count in the completion comment.",
      });
      const approval = acceptAndApprove(company.id, recommendation.id);

      const patches = listRoleTemplatePatches(db, { companyId: company.id });
      assert.equal(patches.length, 1);
      assert.equal(patches[0].role_bucket, "default", "builder recommendation must patch the default bucket");
      assert.equal(patches[0].target_file, "AGENTS.md");
      assert.equal(patches[0].recommendation_id, recommendation.id);
      assert.equal(patches[0].approval_id, approval.id);

      const applied = getImprovementApprovalBridgeRecommendation({
        companyIdOrSlug: company.id,
        recommendationId: recommendation.id,
      }).recommendation;
      assert.equal(applied.status, "applied");
    });

    await test("loadOnboardingAssets merges active patches into the bucket's AGENTS.md", () => {
      const assets = loadOnboardingAssets("backend engineer", {
        db,
        companyId: company.id,
        agentId: builder.id,
      });
      assert.match(assets["AGENTS.md"], /Learned Playbook Updates/);
      assert.match(assets["AGENTS.md"], /Run focused tests before registering artifacts/);

      const leadAssets = loadOnboardingAssets("lead / product orchestrator", {
        db,
        companyId: company.id,
        agentId: lead.id,
      });
      assert.ok(!leadAssets["AGENTS.md"].includes("Run focused tests before registering artifacts"), "default-bucket patch must not leak into the ceo bucket");
    });

    await test("identical approved content dedupes onto the existing active patch", () => {
      const duplicate = createRecommendation({
        companyId: company.id,
        scopeType: "agent",
        scopeKey: builder.id,
        title: "Run focused tests before registering artifacts (again)",
        proposedChange: "Before registering any artifact, run the focused test suite for the touched module and include the pass count in the completion comment.",
      });
      acceptAndApprove(company.id, duplicate.id);

      const patches = listRoleTemplatePatches(db, { companyId: company.id });
      assert.equal(patches.length, 1, "duplicate content must not create a second active patch");

      const applied = getImprovementApprovalBridgeRecommendation({
        companyIdOrSlug: company.id,
        recommendationId: duplicate.id,
      }).recommendation;
      assert.equal(applied.status, "applied", "duplicate is still applied — the lesson already lives in the template");
    });

    await test("lead-scoped recommendation patches the ceo bucket (designation-aware)", () => {
      const recommendation = createRecommendation({
        companyId: company.id,
        scopeType: "agent",
        scopeKey: lead.id,
        title: "Digest before delegating",
        proposedChange: "Open every planning run with a one-paragraph board digest before any delegation.",
      });
      acceptAndApprove(company.id, recommendation.id);

      const ceoPatches = listRoleTemplatePatches(db, { companyId: company.id, bucket: "ceo" });
      assert.equal(ceoPatches.length, 1);
      const leadAssets = loadOnboardingAssets("lead / product orchestrator", {
        db,
        companyId: company.id,
        agentId: lead.id,
      });
      assert.match(leadAssets["AGENTS.md"], /Digest before delegating/);
    });

    await test("rollback deactivates the patch and removes it from prompt assembly", () => {
      const patches = listRoleTemplatePatches(db, { companyId: company.id, bucket: "default" });
      const rolled = rollbackRoleTemplatePatch({
        companyId: company.id,
        patchId: patches[0].id,
        reason: "Guidance regressed run quality.",
        actorUserId: "operator",
        db,
      });
      assert.equal(rolled.status, "rolled_back");
      assert.equal(rolled.rollback_reason, "Guidance regressed run quality.");

      const assets = loadOnboardingAssets("backend engineer", {
        db,
        companyId: company.id,
        agentId: builder.id,
      });
      assert.ok(!assets["AGENTS.md"].includes("Run focused tests before registering artifacts"), "rolled-back patch must leave prompt assembly");

      const audit = listRoleTemplatePatches(db, { companyId: company.id, bucket: "default", includeRolledBack: true });
      assert.equal(audit.length, 1, "rollback preserves the row as audit trail");
    });

    await test("non-agent scopes keep the pre-H4 terminus (no auto-apply)", () => {
      const recommendation = createRecommendation({
        companyId: company.id,
        scopeType: "project",
        scopeKey: project.id,
        title: "Project-scoped guidance",
        proposedChange: "Some project-level change that has no single role bucket.",
      });
      acceptAndApprove(company.id, recommendation.id);

      const after = getImprovementApprovalBridgeRecommendation({
        companyIdOrSlug: company.id,
        recommendationId: recommendation.id,
      }).recommendation;
      assert.equal(after.status, "accepted-for-approval", "non-agent scope must not auto-apply");
      const ceoPlusDefault = listRoleTemplatePatches(db, { companyId: company.id, includeRolledBack: true });
      assert.equal(ceoPlusDefault.length, 2, "no new patch rows for non-agent scopes");
    });
  } finally {
    workspaceIsolation.dispose();
  }

  finish();
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
