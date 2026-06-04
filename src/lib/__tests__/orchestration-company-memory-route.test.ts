import assert from "node:assert";

import {
  GET as listCompanyMemoryRoute,
  PATCH as patchCompanyMemoryRoute,
  POST as createCompanyMemoryRoute,
} from "@/app/api/orchestration/companies/[slug]/memory/route";
import {
  assertJsonErrorCode,
  createCompanyProjectAgentFixture,
  jsonRequest,
  resetLearningTestDatabase,
} from "@/lib/__tests__/helpers/orchestration-learning-fixtures";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { createTask } from "@/lib/orchestration/service";

const { finish, test } = createTestRunner();

async function run() {
  console.log("\nOrchestration Company Memory Route Tests\n");

  resetLearningTestDatabase();

  const { agent, company, project } = createCompanyProjectAgentFixture({
    companyName: (stamp) => `Memory Registry Company ${stamp}`,
    projectName: (stamp) => `Memory Registry Project ${stamp}`,
    agentName: (stamp) => `Memory Registry Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Researcher",
  });
  const task = createTask({
    projectId: project.id,
    title: "Capture durable memory",
    description: "Fixture task.",
    priority: "P2",
    type: "research",
    status: "review",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  let memoryId = "";

  await test("GET returns an empty memory registry", async () => {
    const req = { nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/memory`) };
    const res = await listCompanyMemoryRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { memories: unknown[] };
    assert.deepStrictEqual(payload.memories, []);
  });

  await test("POST creates a draft memory record with provenance", async () => {
    const res = await createCompanyMemoryRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory`, {
        title: "LoanMeld borrower eligibility rule",
        body: "Borrower eligibility calculations should be treated as financial-domain logic and reviewed before durable reuse.",
        kind: "domain_constraint",
        scope: "project",
        source: "task",
        confidence: 0.84,
        projectId: project.id,
        agentId: agent.id,
        taskId: task.id,
        metadata: { evidence: "fixture" },
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 201);
    const payload = await res.json() as {
      memory: {
        id: string;
        slug: string;
        status: string;
        reviewState: string;
        kind: string;
        scope: string;
        source: string;
        confidence: number;
        projectId: string;
        agentId: string;
        taskId: string;
        taskKey: string;
        metadata: { evidence?: string };
      };
    };
    memoryId = payload.memory.id;
    assert.strictEqual(payload.memory.slug, "loanmeld-borrower-eligibility-rule");
    assert.strictEqual(payload.memory.status, "draft");
    assert.strictEqual(payload.memory.reviewState, "not_requested");
    assert.strictEqual(payload.memory.kind, "domain_constraint");
    assert.strictEqual(payload.memory.scope, "project");
    assert.strictEqual(payload.memory.source, "task");
    assert.strictEqual(payload.memory.confidence, 0.84);
    assert.strictEqual(payload.memory.projectId, project.id);
    assert.strictEqual(payload.memory.agentId, agent.id);
    assert.strictEqual(payload.memory.taskId, task.id);
    assert.strictEqual(payload.memory.taskKey, "MEM-1");
    assert.strictEqual(payload.memory.metadata.evidence, "fixture");
  });

  await test("PATCH rejects activation before approval", async () => {
    const res = await patchCompanyMemoryRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory`, {
        id: memoryId,
        status: "active",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    await assertJsonErrorCode(res, 400, "memory_review_required");
  });

  await test("PATCH approves and activates memory", async () => {
    const res = await patchCompanyMemoryRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory`, {
        id: memoryId,
        status: "active",
        reviewState: "approved",
        reviewedByAgentId: agent.id,
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      memory: { status: string; reviewState: string; reviewedByAgentId: string; reviewedAt: string | null };
    };
    assert.strictEqual(payload.memory.status, "active");
    assert.strictEqual(payload.memory.reviewState, "approved");
    assert.strictEqual(payload.memory.reviewedByAgentId, agent.id);
    assert.ok(payload.memory.reviewedAt);
  });

  await test("GET filters active project memory", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/memory?status=active&scope=project&kind=domain_constraint`),
    };
    const res = await listCompanyMemoryRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { memories: Array<{ id: string; status: string }> };
    assert.strictEqual(payload.memories.length, 1);
    assert.strictEqual(payload.memories[0].id, memoryId);
    assert.strictEqual(payload.memories[0].status, "active");
  });

  await test("GET accepts stable company code aliases", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.code}/memory?status=active`),
    };
    const res = await listCompanyMemoryRoute(req as never, {
      params: Promise.resolve({ slug: company.code }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { memories: Array<{ id: string; taskKey: string }> };
    assert.strictEqual(payload.memories.length, 1);
    assert.strictEqual(payload.memories[0].id, memoryId);
    assert.strictEqual(payload.memories[0].taskKey, "MEM-1");
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
