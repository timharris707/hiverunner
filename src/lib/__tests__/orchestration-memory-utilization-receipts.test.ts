import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-memory-utilization-receipts-${Date.now()}.db`,
  );
}
if (!process.env.MC_WORKSPACE_ROOT) {
  process.env.MC_WORKSPACE_ROOT = path.join(
    os.tmpdir(),
    `mc-memory-utilization-workspaces-${Date.now()}`,
  );
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  pass ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  fail ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nMemory utilization receipt metadata tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH!;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { getMemoryInjectionEvidenceForRun } = await import("@/lib/orchestration/memory-vault");
  const { importAssistantTextAndExecuteActions, parseActionsFromText } = await import("@/lib/orchestration/engine/engine");

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Memory Receipt Co ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Memory Receipt Project ${stamp}`,
    description: "fixture",
    color: "#0ea5e9",
    emoji: "R",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Receipt Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Implementation Engineer",
    personality: "Uses receipts.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Receipt fixture task",
    description: "Records memory utilization receipts.",
    priority: "P1",
    type: "feature",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  const executionRunId = `exec-memory-receipt-${stamp}`;
  const heartbeatRunId = `heartbeat-memory-receipt-${stamp}`;
  const now = new Date().toISOString();
  const injectedMemorySha = "a".repeat(64);
  const existingMetadata = {
    existingKey: "preserved",
    injected_memory_sha256: injectedMemorySha,
    injectedMemoryEvidence: {
      source: "memory_source_index",
      recordCount: 2,
      records: [
        {
          recordId: "receipt-used-record",
          sourcePath: "/tmp/memory/used.md",
          title: "Receipt Used Record",
          layer: "project",
          inclusionReasons: ["fixture used record"],
          evidenceEnvelope: {
            version: 1,
            envelopeId: "used-envelope-id",
            recordId: "receipt-used-record",
          },
        },
        {
          recordId: "receipt-ignored-record",
          sourcePath: "/tmp/memory/ignored.md",
          title: "Receipt Ignored Record",
          layer: "company",
          inclusionReasons: ["fixture ignored record"],
          evidenceEnvelope: {
            version: 1,
            envelopeId: "ignored-envelope-id",
            recordId: "receipt-ignored-record",
          },
        },
      ],
    },
    injectedMemoryQuality: {
      status: "accepted",
      score: 96,
      warnings: [],
      refusals: [],
    },
  };
  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, status, started_at, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', 'running', ?, ?, ?, ?)`,
  ).run(
    executionRunId,
    task.id,
    agent.id,
    now,
    JSON.stringify(existingMetadata),
    now,
    now,
  );

  await test("memory_receipt action validates at parse time", () => {
    const parsed = parseActionsFromText(`\`\`\`mc-action\n${JSON.stringify({
      action: "memory_receipt",
      used: ["receipt-used-record"],
    })}\n\`\`\``);
    assert.deepStrictEqual(parsed.parseErrors, []);
    assert.strictEqual(parsed.actions.length, 1);

    const missingClaims = parseActionsFromText('```mc-action\n{"action":"memory_receipt"}\n```');
    assert.ok(missingClaims.parseErrors[0]?.includes("used"));
  });

  await test("memory_receipt persists agent claims without dropping injected metadata", async () => {
    const assistantText = [
      "Recorded memory usage.",
      "```mc-action",
      JSON.stringify({
        action: "memory_receipt",
        taskKey: task.key,
        used: [{ recordId: "receipt-used-record", reason: "Used to preserve existing evidence metadata." }],
        ignored: ["receipt-ignored-record"],
        irrelevant: [{ recordId: "receipt-missing-record", reason: "Not part of this run's injected context." }],
      }),
      "```",
    ].join("\n");

    const result = await importAssistantTextAndExecuteActions({
      assistantTexts: [assistantText],
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: task.id,
      runId: heartbeatRunId,
      executionRunId,
      db,
      source: "unit-test",
    });
    assert.strictEqual(result.actionsFound, 1);
    assert.strictEqual(result.actionsExecuted, 1);

    const stored = db
      .prepare("SELECT metadata_json FROM execution_runs WHERE id = ?")
      .get(executionRunId) as { metadata_json: string };
    const metadata = JSON.parse(stored.metadata_json) as Record<string, any>;
    assert.strictEqual(metadata.existingKey, "preserved");
    assert.strictEqual(metadata.injected_memory_sha256, injectedMemorySha);
    assert.strictEqual(metadata.injectedMemoryEvidence.recordCount, 2);
    assert.strictEqual(metadata.injectedMemoryQuality.score, 96);

    assert.strictEqual(metadata.memoryUtilizationReceipts.version, 1);
    assert.strictEqual(metadata.memoryUtilizationReceipts.receipts.length, 1);
    const receipt = metadata.memoryUtilizationReceipts.receipts[0];
    assert.strictEqual(receipt.source, "agent_claim");
    assert.strictEqual(receipt.runId, executionRunId);
    assert.strictEqual(receipt.heartbeatRunId, heartbeatRunId);
    assert.strictEqual(receipt.injectedMemorySha256, injectedMemorySha);
    assert.strictEqual(receipt.claims.used[0].recordId, "receipt-used-record");
    assert.strictEqual(receipt.claims.used[0].evidenceEnvelopeId, "used-envelope-id");
    assert.strictEqual(receipt.claims.used[0].availableInInjection, true);
    assert.strictEqual(receipt.claims.ignored[0].evidenceEnvelopeId, "ignored-envelope-id");
    assert.strictEqual(receipt.claims.irrelevant[0].availableInInjection, false);
    assert.strictEqual(metadata.memoryUtilizationMatchedUse.status, "not_evaluated");
    assert.deepStrictEqual(metadata.memoryUtilizationMatchedUse.matches, []);
  });

  await test("memory evidence route exposes utilization receipts beside injection evidence", () => {
    const payload = getMemoryInjectionEvidenceForRun(company.id, executionRunId, {
      db,
      includeDiagnostics: true,
    }) as any;
    assert.strictEqual(payload.run.injectedMemorySha256, injectedMemorySha);
    assert.strictEqual(payload.utilization.receipts.receipts.length, 1);
    assert.strictEqual(payload.utilization.receipts.receipts[0].claims.used[0].recordId, "receipt-used-record");
    assert.strictEqual(payload.utilization.matchedUse.status, "not_evaluated");
    assert.strictEqual(payload.evidence.length, 2);
  });

  await test("direct memory_receipt execution can target an execution run id as runId", async () => {
    const { executeMcAction } = await import("@/lib/orchestration/engine/engine");
    const outcome = await executeMcAction(
      {
        action: "memory_receipt",
        used: [{ evidenceEnvelopeId: "used-envelope-id", reason: "Direct execution fixture." }],
      },
      {
        agentId: agent.id,
        agentName: agent.name,
        companyId: company.id,
        taskKey: task.id,
        runId: executionRunId,
      },
      db,
    );
    assert.strictEqual(outcome.kind, "recorded_memory_receipt");
  });

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
