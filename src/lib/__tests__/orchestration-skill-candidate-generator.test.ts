import assert from "node:assert";
import { rmSync } from "node:fs";

import { POST as generateSkillCandidatesRoute } from "@/app/api/orchestration/companies/[slug]/skills/candidates/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { createCompanyMemoryRecord, listCompanyMemoryRecords } from "@/lib/orchestration/company-memory";
import { listCompanySkills } from "@/lib/orchestration/company-skills";
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

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function run() {
  console.log("\nOrchestration Skill Candidate Generator Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const stamp = Date.now();
  const company = createCompany({
    name: `Skill Candidate Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `LoanMeld Release Project ${stamp}`,
    description: "fixture project",
    color: "#22d3ee",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Release Agent ${stamp}`,
    emoji: "icon:git-branch",
    role: "Repo Steward",
    personality: "Precise release fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const firstTask = createTask({
    projectId: project.id,
    title: "Release verification one",
    description: "Fixture task.",
    priority: "P2",
    type: "infrastructure",
    status: "done",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;
  const secondTask = createTask({
    projectId: project.id,
    title: "Release verification two",
    description: "Fixture task.",
    priority: "P2",
    type: "infrastructure",
    status: "done",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  const firstMemory = createCompanyMemoryRecord(company.id, {
    title: "Release verification requires clean git state",
    body: "Release workflow should inspect git status, run focused tests, and run git diff --check before pushing.",
    kind: "workflow_note",
    scope: "project",
    status: "active",
    source: "extractor",
    confidence: 0.82,
    projectId: project.id,
    agentId: agent.id,
    taskId: firstTask.id,
    reviewRequired: true,
    reviewState: "approved",
    metadata: { fixture: "first" },
  }).memory;
  const secondMemory = createCompanyMemoryRecord(company.id, {
    title: "Release steward should report pushed checkpoint",
    body: "Repo steward release process should commit intentionally, push the branch or tag, and report the exact checkpoint.",
    kind: "skill_evidence",
    scope: "project",
    status: "active",
    source: "extractor",
    confidence: 0.78,
    projectId: project.id,
    agentId: agent.id,
    taskId: secondTask.id,
    reviewRequired: true,
    reviewState: "approved",
    metadata: { fixture: "second" },
  }).memory;
  createCompanyMemoryRecord(company.id, {
    title: "Draft memory is not candidate evidence by default",
    body: "Release workflow draft evidence should not count until review is complete.",
    kind: "workflow_note",
    scope: "project",
    status: "draft",
    source: "extractor",
    confidence: 0.74,
    projectId: project.id,
    agentId: agent.id,
    taskId: secondTask.id,
    reviewRequired: true,
    reviewState: "requested",
  });

  await test("candidate generator dry-runs learned skill drafts from repeated reviewed memory", async () => {
    const res = await generateSkillCandidatesRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills/candidates`, {
        dryRun: true,
        minEvidence: 2,
      }) as never,
      { params: Promise.resolve({ slug: company.code }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      dryRun: boolean;
      scannedMemoryCount: number;
      createdCount: number;
      candidates: Array<{
        slug: string;
        name: string;
        description: string;
        topic: string;
        supportingMemoryIds: string[];
        supportingTaskKeys: string[];
        metadata: { candidateVersion?: string; evidenceCount?: number };
      }>;
    };
    assert.strictEqual(payload.dryRun, true);
    assert.strictEqual(payload.scannedMemoryCount, 2);
    assert.strictEqual(payload.createdCount, 0);
    assert.strictEqual(payload.candidates.length, 1);
    assert.strictEqual(payload.candidates[0].slug, "release-steward-workflow");
    assert.strictEqual(payload.candidates[0].name, "Release Steward Workflow");
    assert.strictEqual(payload.candidates[0].topic, "release-steward");
    assert.deepStrictEqual(payload.candidates[0].supportingMemoryIds.sort(), [firstMemory.id, secondMemory.id].sort());
    assert.deepStrictEqual(payload.candidates[0].supportingTaskKeys.sort(), [firstTask.key, secondTask.key].sort());
    assert.match(payload.candidates[0].description, /## Steps/);
    assert.match(payload.candidates[0].description, /git diff --check/);
    assert.strictEqual(payload.candidates[0].metadata.candidateVersion, "skill-candidate-generator.v1");
    assert.strictEqual(payload.candidates[0].metadata.evidenceCount, 2);
  });

  await test("candidate generator detects repeated failure and correction patterns", async () => {
    const failureCompany = createCompany({
      name: `Failure Pattern Company ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;
    const failureProject = createProject({
      companyId: failureCompany.id,
      name: `Failure Pattern Project ${stamp}`,
      description: "fixture project",
      color: "#f97316",
      emoji: "icon:alert-triangle",
      status: "active",
    }).project;
    const failureAgent = createProjectAgent({
      projectId: failureProject.id,
      name: `Failure Agent ${stamp}`,
      emoji: "icon:wrench",
      role: "QA / Verification Lead",
      personality: "Careful failure fixture agent.",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const failureTaskOne = createTask({
      projectId: failureProject.id,
      title: "Failure correction one",
      description: "Fixture task.",
      priority: "P2",
      type: "maintenance",
      status: "done",
      assignee: failureAgent.id,
      labels: [],
      createdBy: "test",
    }).task;
    const failureTaskTwo = createTask({
      projectId: failureProject.id,
      title: "Failure correction two",
      description: "Fixture task.",
      priority: "P2",
      type: "maintenance",
      status: "done",
      assignee: failureAgent.id,
      labels: [],
      createdBy: "test",
    }).task;
    const firstFailure = createCompanyMemoryRecord(failureCompany.id, {
      title: "Inbox approval failure was corrected with alias guard",
      body: "The approval link failed when multiple approvals shared a task alias. The correction resolved it by using the UUID URL and adding a guard to prevent ambiguous routing.",
      kind: "workflow_note",
      scope: "project",
      status: "active",
      source: "extractor",
      confidence: 0.81,
      projectId: failureProject.id,
      agentId: failureAgent.id,
      taskId: failureTaskOne.id,
      reviewRequired: true,
      reviewState: "approved",
    }).memory;
    const secondFailure = createCompanyMemoryRecord(failureCompany.id, {
      title: "Runtime review loop failure recovered with reassignment guard",
      body: "The task failed by looping in review after QA. The recovered workflow corrected the assignee return path and added a prevention guard for future review completion.",
      kind: "skill_evidence",
      scope: "project",
      status: "active",
      source: "extractor",
      confidence: 0.79,
      projectId: failureProject.id,
      agentId: failureAgent.id,
      taskId: failureTaskTwo.id,
      reviewRequired: true,
      reviewState: "approved",
    }).memory;

    const res = await generateSkillCandidatesRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${failureCompany.slug}/skills/candidates`, {
        dryRun: true,
        minEvidence: 2,
      }) as never,
      { params: Promise.resolve({ slug: failureCompany.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      candidates: Array<{
        slug: string;
        name: string;
        topic: string;
        supportingMemoryIds: string[];
        description: string;
      }>;
    };
    assert.strictEqual(payload.candidates.length, 1);
    assert.strictEqual(payload.candidates[0].slug, "failure-recovery-workflow");
    assert.strictEqual(payload.candidates[0].name, "Failure Recovery Workflow");
    assert.strictEqual(payload.candidates[0].topic, "failure-recovery");
    assert.deepStrictEqual(payload.candidates[0].supportingMemoryIds.sort(), [firstFailure.id, secondFailure.id].sort());
    assert.match(payload.candidates[0].description, /prevention/i);
  });

  await test("candidate generator creates a review-requested learned draft skill", async () => {
    const res = await generateSkillCandidatesRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills/candidates`, {
        minEvidence: 2,
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      createdCount: number;
      skills: Array<{
        slug: string;
        status: string;
        source: string;
        reviewState: string;
        metadata: { candidateTopic?: string; supportingMemoryIds?: string[] };
      }>;
    };
    assert.strictEqual(payload.createdCount, 1);
    assert.strictEqual(payload.skills[0].slug, "release-steward-workflow");
    assert.strictEqual(payload.skills[0].status, "draft");
    assert.strictEqual(payload.skills[0].source, "learned");
    assert.strictEqual(payload.skills[0].reviewState, "requested");
    assert.deepStrictEqual(payload.skills[0].metadata.supportingMemoryIds?.sort(), [firstMemory.id, secondMemory.id].sort());

    const registry = listCompanySkills(company.id, { status: "draft" });
    assert.strictEqual(registry.skills.length, 1);
    assert.strictEqual(registry.skills[0].metadata.candidateTopic, "release-steward");
  });

  await test("candidate generator is idempotent for existing learned skill slugs", async () => {
    const res = await generateSkillCandidatesRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills/candidates`, {
        minEvidence: 2,
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      createdCount: number;
      skipped: Array<{ reason: string; slug?: string; evidenceCount: number }>;
    };
    assert.strictEqual(payload.createdCount, 0);
    assert.strictEqual(payload.skipped[0]?.reason, "duplicate");
    assert.strictEqual(payload.skipped[0]?.slug, "release-steward-workflow");
    assert.strictEqual(payload.skipped[0]?.evidenceCount, 2);

    const memories = listCompanyMemoryRecords(company.id, { status: "draft" });
    assert.strictEqual(memories.memories.length, 1);
  });

  await test("candidate generator rejects single-example thresholds", async () => {
    const res = await generateSkillCandidatesRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills/candidates`, {
        minEvidence: 1,
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 400);
    const payload = await res.json() as { error?: { code?: string } };
    assert.strictEqual(payload.error?.code, "invalid_min_evidence");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
