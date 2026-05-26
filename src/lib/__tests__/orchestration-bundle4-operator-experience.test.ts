/**
 * Bundle 4 operator experience tests.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-bundle4-operator-experience.db \
 *   npx tsx src/lib/__tests__/orchestration-bundle4-operator-experience.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import {
  approveSprintPlanDraft,
  createCompany,
  createCompanyGoal,
  createSprintPlanDraft,
  createSprintPlanningTask,
  updateCompanyGoal,
} from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { executeMcAction } from "@/lib/orchestration/engine/engine";
import { sweepOpenTasks } from "@/lib/orchestration/engine/sweeper";
import { resolveAgentModelDisplay, resolveLiveRunnerModelDisplay } from "@/lib/orchestration/agent-model-display";
import { createProject, createProjectAgent, createTask, listTasks } from "@/lib/orchestration/service";

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
  console.log("\nBundle 4 Operator Experience Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const suffix = Date.now();
  const company = createCompany({
    name: `Bundle 4 Operator ${suffix}`,
    description: "Bundle 4 fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Bundle 4 Project ${suffix}`,
    description: "Bundle 4 fixture",
    color: "#38bdf8",
    emoji: "icon:target",
    status: "active",
  }).project;
  const lead = createProjectAgent({
    projectId: project.id,
    name: `Oracle ${suffix}`,
    emoji: "icon:brain",
    role: "Lead / Product Orchestrator",
    personality: "Planner",
    skills: [],
    status: "idle",
    model: "claude-sonnet-4-5",
  }).agent;
  const builder = createProjectAgent({
    projectId: project.id,
    name: `Flash ${suffix}`,
    emoji: "icon:zap",
    role: "Fast Broad-Context Scan Specialist",
    personality: "Fast",
    skills: [],
    status: "idle",
    model: "gemini 3 flash preview",
  }).agent;

  let companyGoalId = "";
  let precreatedSprintId = "";
  let materializedTaskIds: string[] = [];

  await test("v98/v103 add operator keys and permit to-do -> review", () => {
    const sprintColumns = db.prepare("PRAGMA table_info(sprints)").all() as Array<{ name: string }>;
    const sprintKeyColumn = sprintColumns.some((row) => row.name === "sprint_key");
    const goalKeyColumn = sprintColumns.some((row) => row.name === "goal_key");
    assert.equal(sprintKeyColumn, true);
    assert.equal(goalKeyColumn, true);
    const rule = db.prepare(
      `SELECT 1 AS present
       FROM status_transition_rules
       WHERE from_status = 'to-do'
         AND to_status = 'review'
       LIMIT 1`,
    ).get() as { present: number } | undefined;
    assert.equal(rule?.present, 1);
  });

  await test("active company goal queues lead planning, planned goal waits until activated", () => {
    const planned = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      goalKind: "company",
      name: `Planned goal ${suffix}`,
      goal: "Parked until active",
      status: "planned",
      leadAgentId: lead.id,
    }).goal;
    companyGoalId = planned.sprint.id;
    assert.equal(planned.sprint.goalKey, `${company.code}-G001`);
    assert.equal(planned.sprint.sprintKey, null);
    let wake = db.prepare(
      "SELECT 1 FROM agent_wakeup_requests WHERE reason = 'goal_lead_planning' AND agent_id = ? AND payload_json LIKE ? LIMIT 1",
    ).get(lead.id, `%${planned.sprint.id}%`);
    assert.equal(Boolean(wake), false);

    updateCompanyGoal({
      companyIdOrSlug: company.id,
      sprintId: planned.sprint.id,
      status: "active",
      leadAgentId: lead.id,
      actorUserId: "bundle-4-test",
    });
    wake = db.prepare(
      "SELECT 1 FROM agent_wakeup_requests WHERE reason = 'goal_lead_planning' AND agent_id = ? AND payload_json LIKE ? LIMIT 1",
    ).get(lead.id, `%${planned.sprint.id}%`);
    assert.equal(Boolean(wake), true);
  });

  await test("sprint planning task closes after draft emission and does not enter review sweep", async () => {
    const planningGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      goalKind: "company",
      name: `Planning closure goal ${suffix}`,
      goal: "Prove structured drafts are operator-reviewed instead of QA-reviewed.",
      status: "active",
      leadAgentId: lead.id,
      defaultExecutionEngine: "symphony",
    }).goal;
    assert.equal(planningGoal.sprint.goalKey, `${company.code}-G002`);
    const planning = createSprintPlanningTask({
      companyIdOrSlug: company.id,
      companyGoalId: planningGoal.sprint.id,
      leadAgentId: lead.id,
      actorUserId: "bundle-4-test",
    });

    const outcome = await executeMcAction({
      action: "propose_sprint_plan",
      companyGoalId: planningGoal.sprint.id,
      planMode: true,
      sprints: [{
        sequenceNumber: 1,
        name: "Operator-reviewed draft",
        objective: "Create a reviewable sprint plan draft.",
        defaultExecutionEngine: "hiverunner",
        tasks: [{
          id: "s1-task-1",
          title: "Build the first planned task",
          description: "Synthetic task used to prove planning closure behavior.",
          priority: "P1",
          type: "feature",
          executionEngine: "hiverunner",
        }],
      }],
    }, {
      agentId: lead.id,
      agentName: lead.name,
      companyId: company.id,
      taskKey: planning.taskKey,
      runId: `bundle-4-plan-close-${suffix}`,
    }, db);

    assert.equal(outcome.kind, "proposed_sprint_plan", JSON.stringify(outcome));
    if (outcome.kind === "proposed_sprint_plan") assert.equal(outcome.closedPlanningTask, true);
    const storedDraft = db.prepare(
      `SELECT sprint_json, tasks_json
       FROM goal_sprint_plan_drafts
       WHERE company_goal_id = ?
         AND status = 'pending'
       LIMIT 1`,
    ).get(planningGoal.sprint.id) as { sprint_json: string; tasks_json: string };
    assert.equal(JSON.parse(storedDraft.sprint_json).defaultExecutionEngine, "symphony");
    assert.deepEqual(
      JSON.parse(storedDraft.tasks_json).map((task: { executionEngine?: string | null }) => task.executionEngine),
      ["symphony"],
    );
    const planningTask = db.prepare("SELECT status FROM tasks WHERE id = ?").get(planning.taskId) as { status: string };
    assert.equal(planningTask.status, "done");
    assert.throws(
      () => createSprintPlanningTask({
        companyIdOrSlug: company.id,
        companyGoalId: planningGoal.sprint.id,
        leadAgentId: lead.id,
        actorUserId: "bundle-4-test",
      }),
      /pending sprint plan draft/i,
    );

    const reviewAttempt = await executeMcAction({
      action: "update_task",
      taskKey: planning.taskKey,
      status: "review",
    }, {
      agentId: lead.id,
      agentName: lead.name,
      companyId: company.id,
      taskKey: planning.taskKey,
      runId: `bundle-4-plan-close-review-${suffix}`,
    }, db);
    assert.equal(reviewAttempt.kind, "updated_task");
    const stillDone = db.prepare("SELECT status FROM tasks WHERE id = ?").get(planning.taskId) as { status: string };
    assert.equal(stillDone.status, "done");

    sweepOpenTasks(db, { companySlugs: [company.slug] });
    const planningSweepWake = db.prepare(
      `SELECT 1 FROM agent_wakeup_requests
       WHERE json_extract(payload_json, '$.taskId') = ?
         AND reason = 'sweep_review_to_assignee'
       LIMIT 1`,
    ).get(planning.taskId);
    assert.equal(Boolean(planningSweepWake), false);
    const reviewHandoff = db.prepare(
      `SELECT 1 FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.assigned'
         AND json_extract(metadata_json, '$.source') = 'engine_default_review_handoff'
       LIMIT 1`,
    ).get(planning.taskId);
    assert.equal(Boolean(reviewHandoff), false);
  });

  await test("draft approval fills a matching pre-created sprint and inherits lead/key", () => {
    const precreated = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      goalKind: "sprint",
      parentId: companyGoalId,
      name: `Implement Operator Sprint ${suffix}`,
      goal: "Empty wrapper",
      status: "active",
    }).goal;
    precreatedSprintId = precreated.sprint.id;
    const planning = createSprintPlanningTask({
      companyIdOrSlug: company.id,
      companyGoalId,
      leadAgentId: lead.id,
      actorUserId: "bundle-4-test",
    });
    const draft = createSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId,
      planningTaskId: planning.taskId,
      proposedByAgentId: lead.id,
      sequenceNumber: 1,
      sprint: {
        name: `Operator Sprint ${suffix}`,
        objective: "Materialize into the existing wrapper",
        successCriteria: ["Tasks are created"],
        validationChecks: ["Sprint is active"],
        outOfScope: [],
        defaultExecutionEngine: "symphony",
        defaultModelLane: "fast",
      },
      tasks: [
        {
          id: "local-1",
          title: "Bundle 4 task",
          description: "Test task",
          assignee: builder.name,
          priority: "P1",
          type: "feature",
          executionEngine: "symphony",
          modelLane: "fast",
          dependsOn: [],
          validation: "Done",
        },
      ],
    }).draft;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id = ?").run(builder.id);
    const before = db.prepare("SELECT COUNT(*) AS count FROM sprints WHERE parent_id = ?").get(companyGoalId) as { count: number };
    const approved = approveSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId,
      draftId: draft.id,
      actorUserId: "bundle-4-test",
    });
    materializedTaskIds = approved.taskIds;
    const after = db.prepare("SELECT COUNT(*) AS count FROM sprints WHERE parent_id = ?").get(companyGoalId) as { count: number };
    assert.equal(after.count, before.count);
    assert.equal(approved.sprint.sprint.id, precreatedSprintId);
    assert.equal(approved.sprint.sprint.status, "active");
    assert.equal(approved.sprint.sprint.leadAgentId, lead.id);
    assert.match(approved.sprint.sprint.name, /^Sprint 1 — /);
    assert.equal(approved.sprint.sprint.sprintKey, `${company.code}-S001`);
    const taskRow = db.prepare("SELECT sprint_id, status FROM tasks WHERE id = ?").get(materializedTaskIds[0]) as { sprint_id: string; status: string };
    assert.equal(taskRow.sprint_id, precreatedSprintId);
    const startWake = db.prepare(
      `SELECT awr.source, awr.reason, awr.status, hr.invocation_source, hr.status AS heartbeat_status
       FROM agent_wakeup_requests awr
       INNER JOIN heartbeat_runs hr ON hr.id = awr.run_id
       WHERE awr.agent_id = ?
         AND awr.company_id = ?
         AND awr.source = 'issue_assigned'
         AND awr.reason = 'sprint_approved_start'
         AND json_extract(awr.payload_json, '$.taskId') = ?
       LIMIT 1`,
    ).get(builder.id, company.id, materializedTaskIds[0]) as
      | { source: string; reason: string; status: string; invocation_source: string; heartbeat_status: string }
      | undefined;
    assert.equal(startWake?.source, "issue_assigned");
    assert.equal(startWake?.reason, "sprint_approved_start");
    assert.equal(startWake?.status, "queued");
    assert.equal(startWake?.invocation_source, "issue_assigned");
    assert.equal(startWake?.heartbeat_status, "queued");
  });

  await test("goal keys are company-wide and separate from sprint keys", () => {
    const secondGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      goalKind: "company",
      name: `Second keyed goal ${suffix}`,
      goal: "Prove sprint keys do not reset for each goal.",
      status: "planned",
      leadAgentId: lead.id,
    }).goal;
    assert.equal(secondGoal.sprint.goalKey, `${company.code}-G003`);
    assert.equal(secondGoal.sprint.sprintKey, null);
    const secondSprint = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      goalKind: "sprint",
      parentId: secondGoal.sprint.id,
      name: `Second keyed sprint ${suffix}`,
      goal: "This should get the next company-wide key.",
      status: "planned",
    }).goal;
    assert.equal(secondSprint.sprint.sprintKey, `${company.code}-S002`);
    assert.equal(secondSprint.sprint.goalKey, null);

    const thirdGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      goalKind: "company",
      name: `Third keyed goal ${suffix}`,
      goal: "Prove goal keys do not reset after sprint creation.",
      status: "planned",
      leadAgentId: lead.id,
    }).goal;
    assert.equal(thirdGoal.sprint.goalKey, `${company.code}-G004`);
    assert.equal(thirdGoal.sprint.sprintKey, null);
  });

  await test("sweeper auto-completes planning or active sprints whose tasks are all done", () => {
    db.prepare("UPDATE tasks SET status = 'done', updated_at = ? WHERE id IN (" + materializedTaskIds.map(() => "?").join(",") + ")")
      .run(new Date().toISOString(), ...materializedTaskIds);
    db.prepare("UPDATE sprints SET status = 'planning', completed_at = NULL WHERE id = ?").run(precreatedSprintId);
    const result = sweepOpenTasks(db, { now: new Date(), companySlugs: [company.slug] });
    assert.ok((result.skippedReasons.sprints_auto_completed ?? 0) >= 1);
    const sprint = db.prepare("SELECT status, completed_at FROM sprints WHERE id = ?").get(precreatedSprintId) as { status: string; completed_at: string | null };
    assert.equal(sprint.status, "completed");
    assert.ok(sprint.completed_at);
  });

  await test("model display derives Gemini from model even when provider says Anthropic", () => {
    const display = resolveAgentModelDisplay({
      provider: "anthropic",
      model: "Gemini 3 Flash Preview",
      executionEngine: "symphony",
    });
    assert.equal(display?.provider, "gemini");
    assert.equal(display?.providerLabel, "Gemini");
  });

  await test("task cards do not mix assigned agent profile with live Symphony runner model", () => {
    const oracle = createProjectAgent({
      projectId: project.id,
      name: `Oracle Live ${suffix}`,
      emoji: "icon:brain",
      role: "Lead / Product Orchestrator",
      personality: "Planner",
      skills: [],
      status: "idle",
      model: "openai-codex/gpt-5.5",
    }).agent;
    const task = createTask({
      projectId: project.id,
      title: "Live runner display fixture",
      description: "Model chip should stay assigned-agent sourced when not rendering live runner context.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: oracle.id,
      labels: [],
      executionEngine: "symphony",
      createdBy: "bundle-4-test",
    }).task;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, status, started_at, created_at, updated_at,
         execution_engine, runner_provider, runner_model)
       VALUES (?, ?, ?, 'symphony', 'running', ?, ?, ?, 'symphony', 'anthropic', 'anthropic/claude-sonnet-4-6')`,
    ).run(`run-live-runner-display-${task.id}`, task.id, oracle.id, now, now, now);

    const listed = listTasks({ projectId: project.id, search: "Live runner display fixture", includeNonProduction: true }).tasks[0];
    assert.equal(listed?.displayAgentName, oracle.name);
    assert.equal(listed?.modelDisplay?.source, "assignee");
    assert.equal(listed?.modelDisplay?.model, "openai-codex/gpt-5.5");
    assert.equal(listed?.modelDisplay?.displayModel, "GPT-5.5");

    const liveRunner = resolveLiveRunnerModelDisplay({
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4-6",
      executionEngine: "symphony",
    });
    assert.equal(liveRunner?.source, "runner");
    assert.equal(liveRunner?.displayModel, "Runner: Sonnet 4.6");
    assert.equal(liveRunner?.label, "Runner: Anthropic · anthropic/claude-sonnet-4-6");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void run();
