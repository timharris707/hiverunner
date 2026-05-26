import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { createApproval } from "@/lib/orchestration/service/approval";
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

async function run() {
  console.log("\nOrchestration Approval Routing Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

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

  const oracle = createProjectAgent({
    projectId: project.id,
    name: "Oracle",
    emoji: "icon:radar",
    role: "Lead / Product Orchestrator",
    personality: "Runtime owner.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const ralph = createProjectAgent({
    projectId: project.id,
    name: "Ralph",
    emoji: "icon:git-branch",
    role: "Repo Steward / Release Engineer",
    personality: "Release owner.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const castor = createProjectAgent({
    projectId: project.id,
    name: "Castor",
    emoji: "icon:scale",
    role: "Lending Legal / Compliance Specialist",
    personality: "Compliance owner.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const scout = createProjectAgent({
    projectId: project.id,
    name: "Scout",
    emoji: "icon:search",
    role: "Research Specialist",
    personality: "Research owner.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;

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

  if (failed > 0) {
    throw new Error(`${failed} approval routing test(s) failed`);
  }
  console.log(`\n${passed} approval routing test(s) passed`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
