import assert from "node:assert";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-goals-page-draft-symphony-${Date.now()}.db`,
  );
}

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
  console.log("\nGoals Page Sprint Draft Symphony Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH!;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const {
    createCompany,
    createCompanyGoal,
    createSprintPlanDrafts,
    createSprintPlanningTask,
    listCompanyGoals,
    listPendingSprintPlanDrafts,
    listPendingSprintPlanDraftsForGoal,
  } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createProjectAgent } = await import("@/lib/orchestration/service");

  const stamp = Date.now();
  const company = createCompany({
    name: `Goals Page Draft Symphony ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "HiveRunner",
    description: "fixture project",
    color: "#22d3ee",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: "Oracle",
    emoji: "icon:sparkles",
    role: "Lead / Product Orchestrator",
    personality: "Fixture lead.",
    skills: [],
    status: "idle",
  }).agent;
  const goal = createCompanyGoal({
    companyIdOrSlug: company.id,
    projectId: project.id,
    name: "Proper Company Memory System - v5 final clean benchmark",
    goal: "Prove the complete Symphony-backed memory benchmark.",
    goalKind: "company",
    status: "active",
    defaultExecutionEngine: "symphony",
    defaultModelLane: "deep",
    stopCondition: "Operator accepts the benchmark proof package.",
  }).goal;
  const planningTask = createSprintPlanningTask({
    companyIdOrSlug: company.id,
    companyGoalId: goal.sprint.id,
    leadAgentId: agent.id,
  });
  const proposedTasks = Array.from({ length: 8 }, (_, index) => ({
    id: `sprint-6-task-${index + 1}`,
    title: `Sprint 6 proof task ${index + 1}`,
    description: "Fixture task for Goals page draft validation.",
    assignee: agent.id,
    priority: "P1" as const,
    type: "feature" as const,
    modelLane: "deep" as const,
    validation: "Fixture validation must remain operator-visible.",
  }));

  const { drafts } = createSprintPlanDrafts({
    companyIdOrSlug: company.id,
    companyGoalId: goal.sprint.id,
    planningTaskId: planningTask.taskId,
    proposedByAgentId: agent.id,
    drafts: [{
      sequenceNumber: 6,
      sprint: {
        name: "Sprint 6 - Integrated Release, Operator Acceptance, and Benchmark Proof",
        objective: "Close the v5 memory benchmark with integrated proof.",
        defaultModelLane: "deep",
        successCriteria: ["Final proof package is reviewable."],
        validationChecks: ["Goals page shows this draft before child sprint approval."],
        outOfScope: ["Do not materialize child tasks before approval."],
      },
      tasks: proposedTasks,
    }],
  });

  await test("Goals page summary includes pending Sprint 6 before child sprint approval", () => {
    const db = getOrchestrationDb();
    const childRows = db
      .prepare("SELECT COUNT(*) AS count FROM sprints WHERE parent_id = ? AND name LIKE 'Sprint 6%'")
      .get(goal.sprint.id) as { count: number };
    assert.strictEqual(childRows.count, 0, "fixture must still be before child sprint approval");

    const payload = listCompanyGoals({ companyIdOrSlug: company.id, includeCompleted: true });
    const goalRow = payload.goals.find((candidate) => candidate.sprint.id === goal.sprint.id);
    assert.ok(goalRow, "company goal should be returned to the Goals page");
    assert.strictEqual(goalRow.planHasTasks, true);
    assert.strictEqual(goalRow.planTaskCount, 8);
    assert.strictEqual(goalRow.planPendingTaskCount, 8);
    assert.strictEqual(goalRow.planPendingSprintCount, 1);
    assert.strictEqual(goalRow.planSprintCount, 1);
    assert.strictEqual(goalRow.sprint.defaultExecutionEngine, "symphony");

    const summaries = listPendingSprintPlanDrafts({ companyIdOrSlug: company.id }).drafts;
    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0]?.id, drafts[0]?.id);
    assert.strictEqual(summaries[0]?.nextSequenceNumber, 6);
    assert.strictEqual(summaries[0]?.taskCount, 8);
    assert.strictEqual(summaries[0]?.nextSprintTaskCount, 8);
    assert.deepStrictEqual(summaries[0]?.sprints?.map((sprint) => ({
      sequenceNumber: sprint.sequenceNumber,
      taskCount: sprint.taskCount,
    })), [{ sequenceNumber: 6, taskCount: 8 }]);
  });

  await test("Sprint 6 draft and every proposed task inherit Symphony", () => {
    const detailDrafts = listPendingSprintPlanDraftsForGoal({
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
    }).drafts;
    assert.strictEqual(detailDrafts.length, 1);
    const draft = detailDrafts[0]!;
    assert.strictEqual(draft.sequenceNumber, 6);
    assert.strictEqual(draft.status, "pending");
    assert.strictEqual(draft.sprint.defaultExecutionEngine, "symphony");
    assert.strictEqual(draft.tasks.length, 8);
    assert.deepStrictEqual(
      Array.from(new Set(draft.tasks.map((task) => task.executionEngine))),
      ["symphony"],
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
