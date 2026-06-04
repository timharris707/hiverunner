import assert from "node:assert";

import { POST as extractMemoryRoute } from "@/app/api/orchestration/companies/[slug]/memory/extract/route";
import {
  createCompanyProjectAgentFixture,
  jsonRequest,
  resetLearningTestDatabase,
} from "@/lib/__tests__/helpers/orchestration-learning-fixtures";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { listCompanyMemoryRecords } from "@/lib/orchestration/company-memory";
import { createTask, createTaskComment } from "@/lib/orchestration/service";

const { finish, test } = createTestRunner();

async function run() {
  console.log("\nOrchestration Memory Extractor Tests\n");

  resetLearningTestDatabase();

  const { agent, company, project } = createCompanyProjectAgentFixture({
    companyName: (stamp) => `Memory Extractor Company ${stamp}`,
    projectName: (stamp) => `LoanMeld Memory Project ${stamp}`,
    agentName: (stamp) => `Memory Extractor QA ${stamp}`,
    emoji: "icon:shield",
    role: "QA",
  });
  const doneTask = createTask({
    projectId: project.id,
    title: "Verify durable repo workflow",
    description: "Fixture task.",
    priority: "P2",
    type: "research",
    status: "done",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;
  createTaskComment({
    taskId: doneTask.id,
    body: [
      "Codex execution completed.",
      "Command: codex exec --json --full-auto",
      "Stdout: noisy runtime detail",
      "```mc-action",
      "{\"operation\":\"update_task\"}",
      "```",
    ].join("\n"),
    type: "status_update",
    authorAgentId: agent.id,
    source: "codex",
    externalRef: "codex:runtime-log",
  });
  createTaskComment({
    taskId: doneTask.id,
    body: "QA accepted. Use the project source workspace for LoanMeld code changes, and keep release verification as a separate handoff before pushing.",
    type: "review",
    authorAgentId: agent.id,
    source: "mission_control",
  });
  const reviewTask = createTask({
    projectId: project.id,
    title: "Review-only task",
    description: "Not completed yet.",
    priority: "P2",
    type: "research",
    status: "review",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;
  createTaskComment({
    taskId: reviewTask.id,
    body: "This should not be extracted until the task is completed.",
    type: "comment",
    authorAgentId: agent.id,
    source: "mission_control",
  });

  await test("extractor creates a review-requested draft from completed task evidence", async () => {
    const res = await extractMemoryRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory/extract`, {
        taskId: doneTask.key,
      }) as never,
      { params: Promise.resolve({ slug: company.code }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      createdCount: number;
      skippedCount: number;
      memories: Array<{
        slug: string;
        body: string;
        status: string;
        reviewState: string;
        source: string;
        kind: string;
        taskId: string;
        taskKey: string;
        metadata: { extractionVersion?: string; sourceCommentId?: string; skippedRuntimeLogCommentCount?: number };
      }>;
    };

    assert.strictEqual(payload.createdCount, 1);
    assert.strictEqual(payload.skippedCount, 0);
    assert.strictEqual(payload.memories.length, 1);
    assert.strictEqual(payload.memories[0].status, "draft");
    assert.strictEqual(payload.memories[0].reviewState, "requested");
    assert.strictEqual(payload.memories[0].source, "extractor");
    assert.strictEqual(payload.memories[0].kind, "decision");
    assert.strictEqual(payload.memories[0].taskId, doneTask.id);
    assert.strictEqual(payload.memories[0].taskKey, doneTask.key);
    assert.match(payload.memories[0].body, /release verification as a separate handoff/);
    assert.doesNotMatch(payload.memories[0].body, /Command: codex exec/);
    assert.doesNotMatch(payload.memories[0].body, /```mc-action/);
    assert.strictEqual(payload.memories[0].metadata.extractionVersion, "company-memory-extractor.v1");
    assert.ok(payload.memories[0].metadata.sourceCommentId);
    assert.strictEqual(payload.memories[0].metadata.skippedRuntimeLogCommentCount, 0);
  });

  await test("extractor is idempotent for the same completed task evidence", async () => {
    const res = await extractMemoryRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory/extract`, {
        taskId: doneTask.id,
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { createdCount: number; skipped: Array<{ reason: string }> };
    assert.strictEqual(payload.createdCount, 0);
    assert.strictEqual(payload.skipped[0]?.reason, "duplicate");

    const registry = listCompanyMemoryRecords(company.id, { status: "draft" });
    assert.strictEqual(registry.memories.length, 1);
  });

  await test("extractor skips tasks that are not done", async () => {
    const res = await extractMemoryRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/memory/extract`, {
        taskId: reviewTask.key,
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { createdCount: number; skipped: Array<{ reason: string }> };
    assert.strictEqual(payload.createdCount, 0);
    assert.strictEqual(payload.skipped[0]?.reason, "not_completed");
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
