import assert from "node:assert";
import { rmSync } from "node:fs";

import { POST as extractMemoryRoute } from "@/app/api/orchestration/companies/[slug]/memory/extract/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { listCompanyMemoryRecords } from "@/lib/orchestration/company-memory";
import { createProject, createProjectAgent, createTask, createTaskComment } from "@/lib/orchestration/service";

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
  console.log("\nOrchestration Memory Extractor Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const stamp = Date.now();
  const company = createCompany({
    name: `Memory Extractor Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `LoanMeld Memory Project ${stamp}`,
    description: "fixture project",
    color: "#22d3ee",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Memory Extractor QA ${stamp}`,
    emoji: "icon:shield",
    role: "QA",
    personality: "Precise test fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
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

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
