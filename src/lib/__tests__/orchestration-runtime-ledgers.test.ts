/**
 * Focused runtime usage/context ledger tests.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-runtime-ledgers.db node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-runtime-ledgers.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  pass ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  fail ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

console.log("\nRuntime Ledger Tests\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for runtime ledger tests");
  }
  rmSync(dbPath, { force: true });

  const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
  const {
    normalizedRuntimeUsageTotals,
    recordRuntimeUsageLedgerEntry,
  } = await import("@/lib/orchestration/runtime-usage-ledger");
  const {
    evaluateRuntimeBudgetAdmission,
    normalizeRuntimeBudgetPolicy,
  } = await import("@/lib/orchestration/runtime-budget-policy");
  const { recordRuntimeContextManifest } = await import("@/lib/orchestration/context-manifest");
  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { configureCompanyExecutionHive, ensureCompanyExecutionHives } = await import("@/lib/orchestration/service/execution-hives");
  const { enqueueWakeup, executeHeartbeatRun } = await import("@/lib/orchestration/engine/engine");

  const db = getOrchestrationDb();

  await test("migration creates runtime ledger tables", () => {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('runtime_usage_ledger', 'runtime_context_manifests')`
    ).all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((row) => row.name).sort(), [
      "runtime_context_manifests",
      "runtime_usage_ledger",
    ]);
  });

  await test("usage ledger normalizes fresh input and idempotently replaces rows", () => {
    const totals = normalizedRuntimeUsageTotals({
      inputTokens: 100,
      cacheReadInputTokens: 80,
      outputTokens: 12,
      estimatedCostUsd: 0.0042,
    });
    assert.equal(totals.freshInputTokens, 20);
    assert.equal(totals.totalTokens, 112);
    assert.equal(totals.costCents, 0.42);

    const first = recordRuntimeUsageLedgerEntry(db, {
      sourceType: "manual",
      idempotencyKey: "ledger-test:usage",
      provider: "codex",
      model: "gpt-5.5",
      usage: {
        inputTokens: 100,
        cacheReadInputTokens: 80,
        outputTokens: 12,
        estimatedCostUsd: 0.0042,
      },
    });
    const second = recordRuntimeUsageLedgerEntry(db, {
      sourceType: "manual",
      idempotencyKey: "ledger-test:usage",
      provider: "codex",
      model: "gpt-5.5",
      usage: {
        inputTokens: 120,
        cacheReadInputTokens: 90,
        outputTokens: 10,
      },
    });
    assert.ok(first);
    assert.ok(second);

    const row = db.prepare(
      `SELECT COUNT(*) AS count, fresh_input_tokens, total_tokens
       FROM runtime_usage_ledger
       WHERE idempotency_key = ?`
    ).get("ledger-test:usage") as { count: number; fresh_input_tokens: number; total_tokens: number };
    assert.equal(row.count, 1);
    assert.equal(row.fresh_input_tokens, 30);
    assert.equal(row.total_tokens, 130);
  });

  await test("context manifest stores prompt hash and size, not raw prompt text", () => {
    const prompt = "System: secret context should not be duplicated in ledger.";
    recordRuntimeContextManifest(db, {
      sourceType: "manual",
      idempotencyKey: "ledger-test:context",
      provider: "overseer",
      model: "gpt-5.5",
      prompt,
      metadata: { purpose: "test" },
    });

    const row = db.prepare(
      `SELECT prompt_sha256, prompt_chars, estimated_tokens, section_count, sections_json, metadata_json
       FROM runtime_context_manifests
       WHERE idempotency_key = ?
       LIMIT 1`
    ).get("ledger-test:context") as
      | {
          prompt_sha256: string;
          prompt_chars: number;
          estimated_tokens: number;
          section_count: number;
          sections_json: string;
          metadata_json: string;
        }
      | undefined;
    assert.ok(row);
    assert.equal(row!.prompt_sha256.length, 64);
    assert.equal(row!.prompt_chars, prompt.length);
    assert.ok(row!.estimated_tokens > 0);
    assert.equal(row!.section_count, 1);
    assert.match(row!.sections_json, /estimatedTokens/);
    assert.ok(!JSON.stringify(row).includes("secret context should not be duplicated"));
    assert.match(row!.metadata_json, /test/);
  });

  await test("runtime budget policy can block an oversized prompt estimate", () => {
    const policy = normalizeRuntimeBudgetPolicy({
      governance: {
        runtime: {
          budgetThresholds: {
            action: "stop_queue",
            maxPromptEstimatedTokens: 200,
          },
        },
      },
    });
    assert.equal(policy.enabled, true);
    assert.equal(policy.action, "stop_queue");
    assert.equal(policy.maxPromptEstimatedTokens, 200);

    const company = createCompany({
      name: `Prompt Budget ${Date.now()}`,
      description: "fixture",
      status: "active",
    }).company;
    db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run(
      JSON.stringify({
        governance: {
          runtime: {
            budgetThresholds: {
              action: "stop_queue",
              maxPromptEstimatedTokens: 200,
            },
          },
        },
      }),
      company.id,
    );

    const admission = evaluateRuntimeBudgetAdmission({
      db,
      companyId: company.id,
      taskId: "prompt-budget-task",
      provider: "codex",
      model: "gpt-5.5",
      laneKey: "deep",
      promptEstimatedTokens: 240,
      now: "2026-05-01T01:00:00.000Z",
    });

    assert.equal(admission.allowed, false);
    assert.equal(admission.approvalId, null);
    assert.equal(admission.exceeded[0]?.metric, "prompt_estimated_tokens");
    assert.match(admission.message ?? "", /prompt_estimated_tokens 240\/200/);
  });

  await test("runtime budget policy blocks with a durable override approval before admission", () => {
    const policy = normalizeRuntimeBudgetPolicy({
      governance: {
        runtime: {
          budgetThresholds: {
            action: "ask_operator",
            windowHours: 1,
            maxFreshInputTokens: 25,
          },
        },
      },
    });
    assert.equal(policy.enabled, true);
    assert.equal(policy.action, "ask_operator");
    assert.equal(policy.maxFreshInputTokens, 25);

    const company = createCompany({
      name: `Budget Gate ${Date.now()}`,
      description: "fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Budget Gate Project",
      description: "fixture",
      color: "#0ea5e9",
      emoji: "B",
      status: "active",
    }).project;
    const task = createTask({
      projectId: project.id,
      title: "Budget gated task",
      description: "fixture",
      priority: "P2",
      type: "feature",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;
    db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run(
      JSON.stringify({
        governance: {
          runtime: {
            budgetThresholds: {
              action: "ask_operator",
              windowHours: 1,
              maxFreshInputTokens: 25,
            },
          },
        },
      }),
      company.id,
    );
    recordRuntimeUsageLedgerEntry(db, {
      sourceType: "manual",
      idempotencyKey: "ledger-test:budget",
      companyId: company.id,
      taskId: task.id,
      provider: "codex",
      usage: {
        inputTokens: 100,
        cacheReadInputTokens: 60,
        outputTokens: 5,
      },
      occurredAt: "2026-05-01T00:30:00.000Z",
    });

    const first = evaluateRuntimeBudgetAdmission({
      db,
      companyId: company.id,
      taskId: task.id,
      provider: "codex",
      model: "runtime managed",
      laneKey: "deep",
      now: "2026-05-01T01:00:00.000Z",
    });
    assert.equal(first.allowed, false);
    assert.equal(first.exceeded[0]?.metric, "fresh_input_tokens");
    assert.ok(first.approvalId);

    const second = evaluateRuntimeBudgetAdmission({
      db,
      companyId: company.id,
      taskId: task.id,
      provider: "codex",
      model: "runtime managed",
      laneKey: "deep",
      now: "2026-05-01T01:00:00.000Z",
    });
    assert.equal(second.allowed, false);
    assert.equal(second.approvalId, first.approvalId);

    const approvalCount = db.prepare(
      `SELECT COUNT(*) AS count
       FROM approvals
       WHERE type = 'budget_override_required'
         AND linked_task_id = ?`,
    ).get(task.id) as { count: number };
    assert.equal(approvalCount.count, 1);

    db.prepare("UPDATE approvals SET status = 'approved' WHERE id = ?").run(first.approvalId);
    const approved = evaluateRuntimeBudgetAdmission({
      db,
      companyId: company.id,
      taskId: task.id,
      provider: "codex",
      model: "runtime managed",
      laneKey: "deep",
      now: "2026-05-01T01:00:00.000Z",
    });
    assert.equal(approved.allowed, true);
    assert.equal(approved.approvalId, first.approvalId);
  });

  await test("heartbeat budget gate stops before adapter execution", async () => {
    const company = createCompany({
      name: `Budget Heartbeat ${Date.now()}`,
      description: "fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Budget Heartbeat Project",
      description: "fixture",
      color: "#0ea5e9",
      emoji: "H",
      status: "active",
    }).project;
    const agent = createProjectAgent({
      projectId: project.id,
      name: `Budget Agent ${Date.now()}`,
      emoji: "icon:bot",
      role: "Runtime budget tester",
      personality: "fixture",
      model: "openai-codex/gpt-5.5",
      adapterType: "codex",
      skills: [],
      status: "idle",
    }).agent;
    ensureCompanyExecutionHives({ companyIdOrSlug: company.id }, db);
    configureCompanyExecutionHive({
      companyIdOrSlug: company.id,
      hiveId: "balanced-builder",
      orchestrationMode: "hiverunner",
      runtimeProvider: "codex",
      runtimeLabel: "Codex",
      modelRouting: "runtime-managed",
      modelRoutingLabel: "Runtime managed",
    }, db);
    const task = createTask({
      projectId: project.id,
      title: "Budget blocked execution",
      description: "This task should never reach the Codex adapter.",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: [],
      modelLane: "deep",
      executionEngine: "hiverunner",
      createdBy: "test",
    }).task;
    db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run(
      JSON.stringify({
        governance: {
          runtime: {
            budgetThresholds: {
              action: "stop_queue",
              windowHours: 1,
              maxTotalTokens: 10,
            },
          },
        },
      }),
      company.id,
    );
    recordRuntimeUsageLedgerEntry(db, {
      sourceType: "manual",
      idempotencyKey: "ledger-test:heartbeat-budget",
      companyId: company.id,
      taskId: task.id,
      provider: "codex",
      usage: {
        inputTokens: 20,
        outputTokens: 2,
      },
      occurredAt: new Date().toISOString(),
    });

    const wake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "issue_assigned",
      reason: "budget gate test",
      payload: {
        taskId: task.id,
        taskStatus: "in_progress",
        projectId: project.id,
        executionEngine: "hiverunner",
        modelLane: "deep",
      },
      idempotencyKey: `budget-gate-${task.id}`,
    }, db);
    assert.ok(wake.heartbeatRunId);
    const result = await executeHeartbeatRun(wake.heartbeatRunId!, db);
    assert.equal(result.status, "cancelled");
    assert.match(result.error ?? "", /Runtime budget threshold exceeded/);

    const executionRunCount = db.prepare(
      `SELECT COUNT(*) AS count
       FROM execution_runs
       WHERE task_id = ?`,
    ).get(task.id) as { count: number };
    assert.equal(executionRunCount.count, 0);

    const event = db.prepare(
      `SELECT event_type, detail
       FROM heartbeat_run_events
       WHERE run_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(wake.heartbeatRunId) as { event_type: string; detail: string } | undefined;
    assert.ok(event);
    assert.equal(event!.event_type, "runtime_budget_blocked");
    assert.match(event!.detail, /Runtime budget threshold exceeded/);

    const precreatedTask = createTask({
      projectId: project.id,
      title: "Budget blocked precreated execution",
      description: "This precreated execution run should be terminalized by the budget gate.",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: [],
      modelLane: "deep",
      executionEngine: "hiverunner",
      createdBy: "test",
    }).task;
    const precreatedExecutionRunId = `budget-precreated-${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model,
          model_lane, status, created_at, updated_at, attempt_number, retry_allowed,
          retry_decision_reason)
       VALUES (?, ?, ?, 'codex', 'hiverunner', 'codex', 'runtime managed',
          'deep', 'pending', ?, ?, 1, 1, 'initial_attempt')`,
    ).run(precreatedExecutionRunId, precreatedTask.id, agent.id, now, now);

    const precreatedWake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "issue_assigned",
      reason: "budget gate precreated test",
      payload: {
        taskId: precreatedTask.id,
        taskStatus: "in_progress",
        projectId: project.id,
        executionEngine: "hiverunner",
        executionProvider: "codex",
        runnerProvider: "codex",
        runnerModel: "runtime managed",
        modelLane: "deep",
        executionRunId: precreatedExecutionRunId,
      },
      idempotencyKey: `budget-gate-precreated-${precreatedTask.id}`,
    }, db);
    assert.ok(precreatedWake.heartbeatRunId);
    const precreatedResult = await executeHeartbeatRun(precreatedWake.heartbeatRunId!, db);
    assert.equal(precreatedResult.status, "cancelled");
    assert.match(precreatedResult.error ?? "", /Runtime budget threshold exceeded/);

    const terminalized = db.prepare(
      `SELECT status, failure_class, terminalized_by, retry_decision_reason, session_id
       FROM execution_runs
       WHERE id = ?
       LIMIT 1`,
    ).get(precreatedExecutionRunId) as {
      status: string;
      failure_class: string | null;
      terminalized_by: string | null;
      retry_decision_reason: string | null;
      session_id: string | null;
    };
    assert.equal(terminalized.status, "cancelled");
    assert.equal(terminalized.failure_class, "budget_threshold_blocked");
    assert.equal(terminalized.terminalized_by, "budget_gate");
    assert.equal(terminalized.retry_decision_reason, "budget_threshold_blocked");
    assert.equal(terminalized.session_id, null);
  });

  closeOrchestrationDb();

  if (failed > 0) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\n${passed} passed`);
}

void run();
