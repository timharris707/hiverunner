import assert from "node:assert";

import { createCompany } from "@/lib/orchestration/company-service";
import { createApproval } from "@/lib/orchestration/service/approval";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner();

function createApprovalRoutingProject() {
  const stamp = Date.now();
  const company = createCompany({
    name: `Approval Routing Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Approval Routing Project ${stamp}`,
    description: "fixture project",
    color: "#22d3ee",
    emoji: "icon:folder",
    status: "active",
  }).project;

  return { company, project };
}

function createApprovalAgent(
  projectId: string,
  input: { emoji: string; name: string; personality: string; role: string },
) {
  return createProjectAgent({
    projectId,
    name: input.name,
    emoji: input.emoji,
    role: input.role,
    personality: input.personality,
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
}

async function run() {
  console.log("\nOrchestration Approval Routing Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const { company, project } = createApprovalRoutingProject();

  const oracle = createApprovalAgent(project.id, {
    name: "Oracle",
    emoji: "icon:radar",
    role: "Lead / Product Orchestrator",
    personality: "Runtime owner.",
  });
  const ralph = createApprovalAgent(project.id, {
    name: "Ralph",
    emoji: "icon:git-branch",
    role: "Repo Steward / Release Engineer",
    personality: "Release owner.",
  });
  const castor = createApprovalAgent(project.id, {
    name: "Castor",
    emoji: "icon:scale",
    role: "Lending Legal / Compliance Specialist",
    personality: "Compliance owner.",
  });
  const scout = createApprovalAgent(project.id, {
    name: "Scout",
    emoji: "icon:search",
    role: "Research Specialist",
    personality: "Research owner.",
  });

  const releaseTask = createTask({
    projectId: project.id,
    title: "LoanMeld production dry run - release steward verification",
    description: "Production dry run only. Do not edit files.",
    priority: "P2",
    type: "maintenance",
    status: "in-progress",
    assignee: ralph.id,
    labels: [],
    createdBy: "test",
  }).task;
  const policyTask = createTask({
    projectId: project.id,
    title: "Decide production-approved providers by LoanMeld role",
    description: "Map which providers/models are allowed for implementation, QA, release, legal, financial audit, research, and writing roles.",
    priority: "P2",
    type: "research",
    status: "in-progress",
    assignee: scout.id,
    labels: [],
    createdBy: "test",
  }).task;
  const complianceTask = createTask({
    projectId: project.id,
    title: "Review lending compliance production checklist",
    description: "Confirm legal disclosure and financial audit requirements.",
    priority: "P2",
    type: "research",
    status: "in-progress",
    assignee: scout.id,
    labels: [],
    createdBy: "test",
  }).task;

  await test("provider switch routes to runtime governance owner", () => {
    const approval = createApproval({
      companyIdOrSlug: company.id,
      type: "provider_switch",
      requestedByAgentId: scout.id,
      payload: {
        agentId: scout.id,
        agentName: "Scout",
        currentProvider: "codex",
        targetProvider: "anthropic",
      },
    }).approval;

    assert.strictEqual(approval.approverAgentId, oracle.id);
    assert.strictEqual(approval.approverAgentName, "Oracle");
    assert.match(approval.approvalRouteReason ?? "", /runtime governance/i);
  });

  await test("production release runtime request routes to release steward", () => {
    const approval = createApproval({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      requestedByAgentId: oracle.id,
      linkedTaskId: releaseTask.id,
      payload: {
        fingerprint: "release-route",
        summary: "codex execution for release dry run",
        provider: "codex",
        risks: [{ code: "production_target" }],
      },
    }).approval;

    assert.strictEqual(approval.approverAgentId, ralph.id);
    assert.strictEqual(approval.approverAgentName, "Ralph");
    assert.match(approval.approvalRouteReason ?? "", /release stewardship/i);
  });

  await test("provider policy runtime request routes to orchestration owner", () => {
    const approval = createApproval({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      requestedByAgentId: scout.id,
      linkedTaskId: policyTask.id,
      payload: {
        fingerprint: "policy-route",
        summary: "codex execution for providers policy",
        provider: "codex",
        risks: [{ code: "production_target" }],
      },
    }).approval;

    assert.strictEqual(approval.approverAgentId, oracle.id);
    assert.strictEqual(approval.approverAgentName, "Oracle");
    assert.match(approval.approvalRouteReason ?? "", /runtime policy/i);
  });

  await test("compliance runtime request routes to compliance owner", () => {
    const approval = createApproval({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      requestedByAgentId: scout.id,
      linkedTaskId: complianceTask.id,
      payload: {
        fingerprint: "compliance-route",
        summary: "codex execution for lending checklist",
        provider: "codex",
        risks: [{ code: "production_target" }],
      },
    }).approval;

    assert.strictEqual(approval.approverAgentId, castor.id);
    assert.strictEqual(approval.approverAgentName, "Castor");
    assert.match(approval.approvalRouteReason ?? "", /compliance/i);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
