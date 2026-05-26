/**
 * Bundle 3 orchestration resilience contract tests.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-bundle3-resilience.db \
 *   npx tsx src/lib/__tests__/orchestration-bundle3-resilience.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { getOperationalStatusTag } from "@/lib/orchestration/comment-visibility";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { checkAndTripCircuitBreaker } from "@/lib/orchestration/engine/engine";
import { sweepOpenTasks } from "@/lib/orchestration/engine/sweeper";
import { createApproval } from "@/lib/orchestration/service/approval";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";
import type { TaskExecutionEngine } from "@/lib/orchestration/types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
      if (error instanceof Error && error.stack) console.error(error.stack.split("\n").slice(1, 4).join("\n"));
    });
}

async function run() {
  console.log("\nBundle 3 Orchestration Resilience Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const company = createCompany({
    name: `Bundle 3 Resilience ${Date.now()}`,
    description: "Bundle 3 fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Bundle 3 Project",
    description: "Bundle 3 fixture project",
    color: "#f59e0b",
    emoji: "icon:shield",
    status: "active",
  }).project;

  function makeAgent(name: string, role: string, reportingTo?: string) {
    const agent = createProjectAgent({
      projectId: project.id,
      name,
      emoji: "icon:bot",
      role,
      personality: "Deterministic fixture",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    db.prepare(
      `UPDATE agents
       SET adapter_type = 'codex',
           eligible_categories = ?,
           reporting_to = COALESCE(?, reporting_to),
           updated_at = ?
       WHERE id = ?`,
    ).run(JSON.stringify(["feature", "frontend", "qa"]), reportingTo ?? null, new Date().toISOString(), agent.id);
    return agent;
  }

  const oracle = makeAgent("Oracle", "Lead / Product Orchestrator");
  const ralph = makeAgent("Ralph", "Repo Steward / Release Engineer", oracle.id);
  const corey = makeAgent("Corey", "Implementation Engineer", oracle.id);
  const swift = makeAgent("Swift", "Fast Execution Specialist", oracle.id);

  function createRuntimeTask(engine: TaskExecutionEngine, assigneeId: string) {
    const task = createTask({
      projectId: project.id,
      title: `Bundle 3 ${engine} feature task`,
      description: "Feature implementation task for resilience routing.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: assigneeId,
      eligibleAssignees: [assigneeId, corey.id, swift.id],
      labels: ["feature"],
      createdBy: "bundle-3-test",
      executionEngine: engine,
    }).task;
    db.prepare("UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?").run(task.id);
    return task;
  }

  await test("operational comments classify hidden blocker signals for the task detail panel", () => {
    assert.equal(getOperationalStatusTag({ text: "[AWAITING_HUMAN] Circuit breaker tripped", source: "engine", type: "blocker" }), "AWAITING_HUMAN");
    assert.equal(getOperationalStatusTag({ text: "[REVIEW_WATCHDOG] Review overdue", source: "engine", type: "system" }), "REVIEW_WATCHDOG");
    assert.equal(getOperationalStatusTag({ text: "[STUCK_AGENT_WATCHDOG] Silent agent", source: "engine", type: "system" }), "STUCK_AGENT_WATCHDOG");
  });

  for (const engine of ["symphony", "hiverunner"] as TaskExecutionEngine[]) {
    await test(`circuit breaker rotates ${engine} task to capable alternate before awaiting human`, () => {
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      const task = createRuntimeTask(engine, ralph.id);
      const tripped = checkAndTripCircuitBreaker({
        taskId: task.id,
        runId: randomUUID(),
        agentId: ralph.id,
        runWindowStart: new Date().toISOString(),
      }, db);

      assert.equal(tripped, true);
      const row = db.prepare(
        "SELECT assignee_agent_id, status, execution_engine, consecutive_noop_wakes FROM tasks WHERE id = ?",
      ).get(task.id) as { assignee_agent_id: string; status: string; execution_engine: string; consecutive_noop_wakes: number };
      assert.notEqual(row.assignee_agent_id, ralph.id);
      assert.equal(row.execution_engine, engine);
      assert.equal(row.consecutive_noop_wakes, 0);
      const event = db.prepare(
        "SELECT metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.reassigned' ORDER BY created_at DESC LIMIT 1",
      ).get(task.id) as { metadata_json: string } | undefined;
      assert.match(event?.metadata_json ?? "", /capable_list_rotation/);
    });
  }

  await test("self-approval routes up hierarchy and wakes the rerouted approver", () => {
    db.prepare("DELETE FROM agent_wakeup_requests").run();
    const approval = createApproval({
      companyIdOrSlug: company.slug,
      type: "protected_runtime_command",
      requestedByAgentId: ralph.id,
      approverAgentId: ralph.id,
      payload: { command: "protected runtime command", executionEngine: "symphony" },
      db,
    }).approval;

    assert.equal(approval.approverAgentId, oracle.id);
    assert.match(approval.approvalRouteReason ?? "", /self_approval_rerouted_from_ralph/);
    const wake = db.prepare(
      "SELECT reason, payload_json FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(oracle.id) as { reason: string; payload_json: string } | undefined;
    assert.equal(wake?.reason, "approval_requested");
    assert.match(wake?.payload_json ?? "", new RegExp(approval.id));
  });

  for (const engine of ["symphony", "hiverunner"] as TaskExecutionEngine[]) {
    await test(`silent-agent watchdog reassigns stale ${engine} task and preserves runtime metadata`, () => {
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      const staleAgent = makeAgent(`Silent ${engine}`, "Frontend Engineer", oracle.id);
      const alternate = engine === "symphony" ? corey : swift;
      const staleHeartbeat = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
      db.prepare("UPDATE agents SET status = 'working', last_heartbeat = ? WHERE id = ?").run(staleHeartbeat, staleAgent.id);
      const task = createTask({
        projectId: project.id,
        title: `Silent ${engine} task`,
        description: "Silent-agent watchdog fixture",
        priority: "P1",
        type: "feature",
        status: "in-progress",
        assignee: staleAgent.id,
        eligibleAssignees: [staleAgent.id, alternate.id],
        labels: ["feature"],
        createdBy: "bundle-3-test",
        executionEngine: engine,
      }).task;

      const result = sweepOpenTasks(db, { cap: 10, now: new Date() });
      assert.ok((result.skippedReasons.stuck_agent_watchdog_reassignments ?? 0) >= 1, JSON.stringify(result));
      const row = db.prepare(
        "SELECT assignee_agent_id, execution_engine FROM tasks WHERE id = ?",
      ).get(task.id) as { assignee_agent_id: string; execution_engine: string };
      assert.equal(row.assignee_agent_id, alternate.id);
      assert.equal(row.execution_engine, engine);
      const comment = db.prepare(
        "SELECT body FROM comments WHERE task_id = ? AND body LIKE '[STUCK_AGENT_WATCHDOG] Auto-reassigned%' LIMIT 1",
      ).get(task.id) as { body: string } | undefined;
      assert.ok(comment?.body);
    });
  }

  if (failed > 0) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${passed} passed`);
}

void run();
