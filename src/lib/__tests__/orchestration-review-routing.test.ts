import assert from "node:assert";
import { rmSync } from "node:fs";

import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

const isolation = createIsolatedOrchestrationWorkspace({
  prefix: "mc-review-routing-",
});

import { POST as routeReviewsRoute } from "@/app/api/orchestration/companies/[slug]/reviews/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { createCompanyMemoryRecord, listCompanyMemoryRecords } from "@/lib/orchestration/company-memory";
import { createCompanySkill, listCompanySkills } from "@/lib/orchestration/company-skills";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createProject, createProjectAgent, createTask, listTasks } from "@/lib/orchestration/service";

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
  console.log("\nOrchestration Review Routing Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  isolation.syncDatabase(getOrchestrationDb());
  const stamp = Date.now();
  const company = createCompany({
    name: `Review Routing Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `LoanMeld Review Routing ${stamp}`,
    description: "fixture project",
    color: "#22d3ee",
    emoji: "icon:folder",
    status: "active",
  }).project;

  const bruce = createProjectAgent({
    projectId: project.id,
    name: "Bruce (Lead)",
    emoji: "icon:crown",
    role: "Lead",
    personality: "Lead fixture.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const ralph = createProjectAgent({
    projectId: project.id,
    name: "Ralph (Repo Steward)",
    emoji: "icon:git-branch",
    role: "Repo Steward",
    personality: "Release fixture.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const castor = createProjectAgent({
    projectId: project.id,
    name: "Castor (Legal)",
    emoji: "icon:scale",
    role: "Legal",
    personality: "Legal fixture.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Legal review fixture",
    description: "Fixture task.",
    priority: "P2",
    type: "research",
    status: "done",
    assignee: bruce.id,
    labels: [],
    createdBy: "test",
  }).task;

  const legalMemory = createCompanyMemoryRecord(company.id, {
    title: "Loan agreement compliance note",
    body: "Loan agreement disclosure and lending compliance constraints need legal review before reuse.",
    kind: "domain_constraint",
    scope: "project",
    status: "draft",
    source: "extractor",
    confidence: 0.76,
    projectId: project.id,
    agentId: bruce.id,
    taskId: task.id,
    reviewRequired: true,
    reviewState: "requested",
  }).memory;
  const releaseSkill = createCompanySkill(company.id, {
    name: "Release Steward Workflow",
    description: "Before pushing code, inspect git status, run tests, and report the commit.",
    slug: "release-steward-workflow",
    source: "learned",
    scope: "project",
    status: "draft",
    reviewRequired: true,
    reviewState: "requested",
  }).skill;

  await test("review routing dry-run assigns draft memory and skills to specialists", async () => {
    const res = await routeReviewsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/reviews`, {
        dryRun: true,
      }) as never,
      { params: Promise.resolve({ slug: company.code }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      dryRun: boolean;
      scannedCount: number;
      routedCount: number;
      assignments: Array<{ targetType: string; targetId: string; reviewerAgentName: string; reviewerRule: string }>;
    };
    assert.strictEqual(payload.dryRun, true);
    assert.strictEqual(payload.scannedCount, 2);
    assert.strictEqual(payload.routedCount, 2);
    assert.deepStrictEqual(
      payload.assignments.map((assignment) => [assignment.targetType, assignment.targetId, assignment.reviewerAgentName, assignment.reviewerRule]).sort(),
      [
        ["memory", legalMemory.id, castor.name, "legal"],
        ["skill", releaseSkill.id, ralph.name, "release"],
      ].sort(),
    );

    const memory = listCompanyMemoryRecords(company.id, { status: "draft" }).memories[0];
    assert.strictEqual(memory.metadata.reviewRouting, undefined);
  });

  await test("review routing persists metadata and skill owner without activating candidates", async () => {
    const res = await routeReviewsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/reviews`, {}) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { routedCount: number; skippedCount: number; reviewTaskCreatedCount: number };
    assert.strictEqual(payload.routedCount, 2);
    assert.strictEqual(payload.skippedCount, 0);
    assert.strictEqual(payload.reviewTaskCreatedCount, 2);

    const memory = listCompanyMemoryRecords(company.id, { status: "draft" }).memories.find((item) => item.id === legalMemory.id);
    assert.strictEqual((memory?.metadata.reviewRouting as { reviewerAgentId?: string } | undefined)?.reviewerAgentId, castor.id);
    assert.ok((memory?.metadata.reviewTask as { taskId?: string } | undefined)?.taskId, "memory should store routed review task");
    assert.ok((memory?.metadata.reviewContext as { decisionEndpoint?: string } | undefined)?.decisionEndpoint, "memory should store full review context");
    assert.strictEqual(memory?.reviewState, "requested");
    assert.strictEqual(memory?.status, "draft");

    const skill = listCompanySkills(company.id, { status: "draft" }).skills.find((item) => item.id === releaseSkill.id);
    assert.strictEqual(skill?.ownerAgentId, ralph.id);
    assert.strictEqual((skill?.metadata.reviewRouting as { reviewerAgentId?: string } | undefined)?.reviewerAgentId, ralph.id);
    assert.ok((skill?.metadata.reviewTask as { taskId?: string } | undefined)?.taskId, "skill should store routed review task");
    assert.ok((skill?.metadata.reviewContext as { decisionPayload?: unknown } | undefined)?.decisionPayload, "skill should store decision payload context");
    assert.strictEqual(skill?.reviewState, "requested");
    assert.strictEqual(skill?.status, "draft");
    assert.strictEqual(skill?.version, 1);

    const reviewTasks = listTasks({ companyIdOrSlug: company.id, includeNonProduction: true }).tasks
      .filter((item) => item.tags.includes("learning-review"));
    assert.strictEqual(reviewTasks.length, 2);
    assert.ok(reviewTasks.every((item) => item.status === "to-do"));
    assert.ok(reviewTasks.every((item) => item.executionEngine === "symphony"));
    assert.ok(reviewTasks.some((item) => item.assignee === castor.name));
    assert.ok(reviewTasks.some((item) => item.assignee === ralph.name));
  });

  await test("review routing is idempotent unless reroute is requested", async () => {
    const res = await routeReviewsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/reviews`, {}) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { routedCount: number; skipped: Array<{ reason: string }> };
    assert.strictEqual(payload.routedCount, 0);
    assert.strictEqual(payload.skipped.length, 2);
    assert.ok(payload.skipped.every((item) => item.reason === "already_routed"));
  });

  await test("review routing validates target", async () => {
    const res = await routeReviewsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/reviews`, {
        target: "bad",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 400);
    const payload = await res.json() as { error?: { code?: string } };
    assert.strictEqual(payload.error?.code, "invalid_target");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
