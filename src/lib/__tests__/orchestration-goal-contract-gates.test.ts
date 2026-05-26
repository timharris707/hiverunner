import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-goal-contract-gates-${Date.now()}.db`,
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
  console.log("\nOrchestration Goal Contract Gate Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH!;

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const { OrchestrationApiError } = await import("@/lib/orchestration/api");
  const {
    createCompany,
    createCompanyGoal,
    createGoalContractItem,
    approveSprintPlanDraft,
    createSprintPlanDraft,
    createSprintPlanningTask,
    getPendingSprintPlanDraft,
    listCompanyGoals,
    recordGoalContractEvidence,
    rejectSprintPlanDraft,
    updateCompanyGoal,
  } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { buildTaskGoalContextSection } = await import("@/lib/orchestration/goal-context");
  const { recordPlanningRetrospectiveMemory } = await import("@/lib/orchestration/planning-retrospectives");
  const { __testHooks: engineTestHooks, executeMcAction } = await import("@/lib/orchestration/engine/engine");
  const { createProject, createProjectAgent, createTask, moveTask } = await import("@/lib/orchestration/service");

  const stamp = Date.now();
  const company = createCompany({
    name: `Goal Contract Gates ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Goal Contract Project ${stamp}`,
    description: "fixture project",
    color: "#22d3ee",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: "Validation Agent",
    emoji: "icon:check",
    role: "Validation engineer",
    personality: "Fixture agent.",
    skills: [],
    status: "idle",
  }).agent;

  const companyGoal = createCompanyGoal({
    companyIdOrSlug: company.id,
    projectId: project.id,
    name: "Production-ready runner",
    goal: "Make the runner production-ready.",
    goalKind: "company",
    status: "active",
    stopCondition: "Operator confirms the production-readiness checks.",
  }).goal;

  const sprint = createCompanyGoal({
    companyIdOrSlug: company.id,
    projectId: project.id,
    parentId: companyGoal.sprint.id,
    name: "Validation hardening sprint",
    goal: "Close implementation tasks and validate the release.",
    goalKind: "sprint",
    status: "active",
  }).goal;

  createTask({
    projectId: project.id,
    sprintId: sprint.sprint.id,
    title: "Finish hardening implementation",
    description: "Fixture task.",
    priority: "P2",
    type: "feature",
    status: "done",
    labels: [],
    createdBy: "test",
  });

  const validation = createGoalContractItem({
    companyIdOrSlug: company.id,
    sprintId: sprint.sprint.id,
    kind: "validation_check",
    text: "Focused regression test passes.",
    actorUserId: "test",
  }).item;
  const success = createGoalContractItem({
    companyIdOrSlug: company.id,
    sprintId: companyGoal.sprint.id,
    kind: "success_criterion",
    text: "All supporting sprints are validated.",
    actorUserId: "test",
  }).item;

  await test("stop condition cannot change while active", () => {
    assert.throws(
      () => updateCompanyGoal({
        companyIdOrSlug: company.id,
        sprintId: companyGoal.sprint.id,
        stopCondition: "Change the stop condition while active.",
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "stop_condition_locked",
    );
  });

  await test("sprint cannot finish until validation evidence is operator-confirmed", () => {
    assert.throws(
      () => updateCompanyGoal({
        companyIdOrSlug: company.id,
        sprintId: sprint.sprint.id,
        status: "done",
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "validation_gate_failed",
    );

    recordGoalContractEvidence({
      companyIdOrSlug: company.id,
      itemId: validation.id,
      status: "proposed",
      resultText: "Regression command passed locally.",
      actorAgentId: agent.id,
    });

    assert.throws(
      () => updateCompanyGoal({
        companyIdOrSlug: company.id,
        sprintId: sprint.sprint.id,
        status: "done",
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "validation_gate_failed",
    );

    recordGoalContractEvidence({
      companyIdOrSlug: company.id,
      itemId: validation.id,
      status: "passed",
      resultText: "Operator confirmed regression evidence.",
      actorUserId: "operator-fixture",
    });

    const updated = updateCompanyGoal({
      companyIdOrSlug: company.id,
      sprintId: sprint.sprint.id,
      status: "done",
    }).goal;
    assert.strictEqual(updated.sprint.status, "done");
  });

  await test("company goal cannot finish until success evidence is operator-confirmed", () => {
    assert.throws(
      () => updateCompanyGoal({
        companyIdOrSlug: company.id,
        sprintId: companyGoal.sprint.id,
        status: "done",
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "validation_gate_failed",
    );

    recordGoalContractEvidence({
      companyIdOrSlug: company.id,
      itemId: success.id,
      status: "passed",
      resultText: "Operator confirmed success criterion.",
      actorUserId: "operator-fixture",
    });

    const updated = updateCompanyGoal({
      companyIdOrSlug: company.id,
      sprintId: companyGoal.sprint.id,
      status: "done",
    }).goal;
    assert.strictEqual(updated.sprint.status, "done");
  });

  await test("operators are required for passed evidence and retraction demotes done work", () => {
    assert.throws(
      () => recordGoalContractEvidence({
        companyIdOrSlug: company.id,
        itemId: validation.id,
        status: "passed",
        resultText: "Agent attempted self-certification.",
        actorAgentId: agent.id,
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "operator_confirmation_required",
    );

    recordGoalContractEvidence({
      companyIdOrSlug: company.id,
      itemId: validation.id,
      status: "retracted",
      resultText: "Operator retracted stale evidence.",
      actorUserId: "operator-fixture",
    });

    const reloaded = listCompanyGoals({ companyIdOrSlug: company.id }).goals.find((goal) => goal.sprint.id === sprint.sprint.id);
    assert.strictEqual(reloaded?.sprint.status, "active");
  });

  await test("active lead-owned goal auto-creates one boosted planning wake", () => {
    const db = getOrchestrationDb();
    const ordinaryRunId = randomUUID();
    db.prepare(
      `INSERT INTO heartbeat_runs
         (id, agent_id, company_id, invocation_source, trigger_detail, status, context_snapshot_json, created_at, updated_at)
       VALUES
         (?, ?, ?, 'wakeup_request', 'ordinary_fixture', 'queued', '{}', ?, ?)`
    ).run(ordinaryRunId, agent.id, company.id, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");

    const leadGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Lead-owned active goal",
      goal: "Wake the lead immediately.",
      goalKind: "company",
      status: "active",
      leadAgentId: agent.id,
    }).goal;

    const planningTasks = db.prepare(
      `SELECT id, task_key, priority, assignee_agent_id
       FROM tasks
       WHERE sprint_id = ?
         AND title = ?
         AND archived_at IS NULL`
    ).all(leadGoal.sprint.id, "Plan sprint for Lead-owned active goal") as Array<{
      id: string;
      task_key: string | null;
      priority: string;
      assignee_agent_id: string | null;
    }>;
    assert.strictEqual(planningTasks.length, 1);
    assert.strictEqual(planningTasks[0].priority, "critical");
    assert.strictEqual(planningTasks[0].assignee_agent_id, agent.id);

    const duplicate = createSprintPlanningTask({
      companyIdOrSlug: company.id,
      companyGoalId: leadGoal.sprint.id,
      leadAgentId: agent.id,
    });
    assert.strictEqual(duplicate.taskId, planningTasks[0].id);
    const taskCount = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE sprint_id = ? AND title = ? AND archived_at IS NULL")
      .get(leadGoal.sprint.id, "Plan sprint for Lead-owned active goal") as { count: number };
    assert.strictEqual(taskCount.count, 1);

    const claimed = engineTestHooks.claimNextQueuedRun(db);
    assert.ok(claimed);
    const claimedRun = db.prepare("SELECT trigger_detail FROM heartbeat_runs WHERE id = ?")
      .get(claimed!.id) as { trigger_detail: string | null };
    assert.strictEqual(claimedRun.trigger_detail, "goal_lead_planning");

    const plannedGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Lead-owned planned goal",
      goal: "Do not wake while still planned.",
      goalKind: "company",
      status: "planned",
      leadAgentId: agent.id,
    }).goal;
    const plannedTaskCount = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE sprint_id = ? AND title = ? AND archived_at IS NULL")
      .get(plannedGoal.sprint.id, "Plan sprint for Lead-owned planned goal") as { count: number };
    assert.strictEqual(plannedTaskCount.count, 0);
  });

  await test("goal lead revision wake after sprint completion is claimable", () => {
    const db = getOrchestrationDb();
    const revisionGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Revision-backed company goal",
      goal: "Use sprint results to refine later drafts.",
      goalKind: "company",
      status: "planned",
      leadAgentId: agent.id,
      defaultExecutionEngine: "symphony",
    }).goal;
    const planningTask = createSprintPlanningTask({
      companyIdOrSlug: company.id,
      companyGoalId: revisionGoal.sprint.id,
      leadAgentId: agent.id,
    });
    createSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: revisionGoal.sprint.id,
      planningTaskId: planningTask.taskId,
      proposedByAgentId: agent.id,
      sequenceNumber: 2,
      sprint: {
        name: "Later sprint",
        objective: "Pending work should be refined after the first sprint completes.",
        validationChecks: ["Revision wake is claimable"],
        outOfScope: [],
      },
      tasks: [{ id: "later-task", title: "Later task", priority: "P2", type: "feature", assignee: agent.id }],
    });
    const completedSprint = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      parentId: revisionGoal.sprint.id,
      name: "Completed foundation sprint",
      goal: "Finish the first slice.",
      goalKind: "sprint",
      status: "active",
      leadAgentId: agent.id,
      defaultExecutionEngine: "symphony",
    }).goal;
    const finishedTask = createTask({
      projectId: project.id,
      sprintId: completedSprint.sprint.id,
      title: "Finished task",
      description: "Completed work.",
      priority: "P1",
      type: "feature",
      status: "review",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
    }).task;

    db.prepare("DELETE FROM heartbeat_runs").run();
    db.prepare("DELETE FROM agent_wakeup_requests").run();

    moveTask({
      taskId: finishedTask.id,
      status: "done",
      reviewNotes: "Review accepted for revision wake regression.",
      actorUserId: "test",
    });

    const wake = db.prepare(
      `SELECT id, run_id, reason, status
       FROM agent_wakeup_requests
       WHERE agent_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(agent.id) as { id: string; run_id: string; reason: string; status: string } | undefined;
    assert.ok(wake);
    assert.strictEqual(wake.reason, "goal_lead_plan_revision");
    assert.strictEqual(wake.status, "queued");
    assert.ok(wake.run_id);

    const heartbeat = db.prepare(
      `SELECT id, status, wakeup_request_id, trigger_detail
       FROM heartbeat_runs
       WHERE id = ?`
    ).get(wake.run_id) as { id: string; status: string; wakeup_request_id: string; trigger_detail: string } | undefined;
    assert.ok(heartbeat);
    assert.strictEqual(heartbeat.status, "queued");
    assert.strictEqual(heartbeat.wakeup_request_id, wake.id);
    assert.strictEqual(heartbeat.trigger_detail, "goal_lead_plan_revision");

    const claimed = engineTestHooks.claimNextQueuedRun(db);
    assert.ok(claimed);
    assert.strictEqual(claimed!.id, wake.run_id);
  });

  await test("lead Plan Mode context includes stored planning retrospectives", () => {
    const db = getOrchestrationDb();
    const leadGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Retrospective-backed planning goal",
      goal: "Use remembered planning lessons.",
      goalKind: "company",
      status: "active",
      leadAgentId: agent.id,
      defaultExecutionEngine: "symphony",
    }).goal;
    const planningTask = createSprintPlanningTask({
      companyIdOrSlug: company.id,
      companyGoalId: leadGoal.sprint.id,
      leadAgentId: agent.id,
    });

    recordPlanningRetrospectiveMemory({
      db,
      companyId: company.id,
      projectId: project.id,
      agentId: agent.id,
      taskId: planningTask.taskId,
      companyGoalId: leadGoal.sprint.id,
      title: "Prefer symphony defaults in planning drafts",
      body: "Operator rejected prior drafts that silently changed a symphony-default company goal back to HiveRunner. Keep sprint defaults and task executionEngine on symphony unless explicitly told otherwise.",
      outcome: "rejected",
      draftId: "fixture-draft",
      now: "2026-01-02T00:00:00.000Z",
    });

    const context = buildTaskGoalContextSection({
      db,
      taskId: planningTask.taskId,
      agentId: agent.id,
    });
    assert.ok(context?.includes("Recent planning retrospectives"));
    assert.ok(context?.includes("Prefer symphony defaults in planning drafts"));
    assert.ok(context?.includes("Keep sprint defaults and task executionEngine on symphony"));
  });

  await test("lead Plan Mode context tells planners to optimize for parallel sprint execution", () => {
    const db = getOrchestrationDb();
    const parallelGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Parallel-first planning goal",
      goal: "Plan work so capable agents can run concurrently.",
      goalKind: "company",
      status: "active",
      leadAgentId: agent.id,
      defaultExecutionEngine: "symphony",
    }).goal;
    const planningTask = createSprintPlanningTask({
      companyIdOrSlug: company.id,
      companyGoalId: parallelGoal.sprint.id,
      leadAgentId: agent.id,
    });

    const context = buildTaskGoalContextSection({
      db,
      taskId: planningTask.taskId,
      agentId: agent.id,
    });

    assert.ok(context?.includes("Concurrency-first planning rule"));
    assert.ok(context?.includes("Default every task to `dependsOn: []`"));
    assert.ok(context?.includes("at least half of non-QA/non-release tasks should be able to start immediately"));
    assert.ok(context?.includes("Use dependencies only for hard prerequisites"));
  });

  await test("plan revision task closes with summary after proposing revised draft", async () => {
    const db = getOrchestrationDb();
    const revisionGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Revision lifecycle goal",
      goal: "Refine remaining planned sprints after a completed sprint.",
      goalKind: "company",
      status: "active",
      leadAgentId: agent.id,
      defaultExecutionEngine: "symphony",
    }).goal;
    const revisionTask = createTask({
      projectId: project.id,
      sprintId: revisionGoal.sprint.id,
      title: "Review and refine remaining plan",
      description: "Use sprint results to revise the remaining plan.",
      priority: "P0",
      type: "research",
      status: "in-progress",
      assignee: agent.id,
      labels: ["goal-contract", "plan-revision"],
      createdBy: "test",
    }).task;
    assert.ok(revisionTask.key);

    const runId = randomUUID();
    const proposed = await executeMcAction({
      action: "propose_sprint_plan",
      companyGoalId: revisionGoal.sprint.id,
      sprints: [
        {
          sequenceNumber: 2,
          name: "Revised sprint two",
          objective: "Ship the next slice.",
          defaultExecutionEngine: "symphony",
          tasks: [{ id: "revised-2-task-1", title: "Build revised slice", priority: "P1", type: "feature", assignee: agent.id }],
        },
        {
          sequenceNumber: 3,
          name: "Revised sprint three",
          objective: "Validate the next slice.",
          defaultExecutionEngine: "symphony",
          tasks: [{ id: "revised-3-task-1", title: "Validate revised slice", priority: "P1", type: "qa", assignee: agent.id }],
        },
      ],
    }, {
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: revisionTask.key,
      runId,
    }, db);
    assert.strictEqual(proposed.kind, "proposed_sprint_plan");
    assert.strictEqual(proposed.closedPlanningTask, true);

    const closedTask = db.prepare("SELECT status FROM tasks WHERE id = ?")
      .get(revisionTask.id) as { status: string } | undefined;
    assert.strictEqual(closedTask?.status, "done");

    const summaryComment = db.prepare(
      `SELECT body
       FROM comments
       WHERE task_id = ?
         AND source = 'engine'
         AND type = 'status_update'
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(revisionTask.id) as { body: string } | undefined;
    assert.ok(summaryComment?.body.includes("Revised the remaining sprint plan"));
    assert.ok(summaryComment?.body.includes("2 sprints / 2 tasks"));
    assert.ok(summaryComment?.body.includes("No execution tasks were approved or materialized"));

    const staleReview = await executeMcAction({
      action: "update_task",
      taskKey: revisionTask.key,
      status: "review",
    }, {
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: revisionTask.key,
      runId,
    }, db);
    assert.strictEqual(staleReview.kind, "updated_task");

    const stillClosed = db.prepare("SELECT status FROM tasks WHERE id = ?")
      .get(revisionTask.id) as { status: string } | undefined;
    assert.strictEqual(stillClosed?.status, "done");
  });

  await test("sprint plan draft supersedes pending draft and approval creates sprint tasks", () => {
    const draftGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Draft-backed company goal",
      goal: "Use draft-first planning.",
      goalKind: "company",
      status: "active",
    }).goal;
    const planningTask = createSprintPlanningTask({
      companyIdOrSlug: company.id,
      companyGoalId: draftGoal.sprint.id,
      leadAgentId: agent.id,
    });
    const first = createSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: draftGoal.sprint.id,
      planningTaskId: planningTask.taskId,
      proposedByAgentId: agent.id,
      sprint: {
        name: "Superseded sprint",
        objective: "Old draft.",
        validationChecks: ["Old validation"],
        outOfScope: [],
      },
      tasks: [{ id: "old-task", title: "Old task", priority: "P2", type: "feature" }],
    }).draft;
    const second = createSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: draftGoal.sprint.id,
      planningTaskId: planningTask.taskId,
      proposedByAgentId: agent.id,
      sprint: {
        name: "Approved sprint",
        objective: "Approved draft.",
        validationChecks: ["Operator can verify the approved sprint"],
        outOfScope: ["Unplanned scope creep"],
      },
      tasks: [{ id: "approved-task", title: "Approved execution task", priority: "P1", type: "feature", assignee: agent.id }],
    }).draft;

    assert.strictEqual(getPendingSprintPlanDraft({ companyIdOrSlug: company.id, companyGoalId: draftGoal.sprint.id }).draft?.id, second.id);
    assert.strictEqual(getPendingSprintPlanDraft({ companyIdOrSlug: company.id, companyGoalId: draftGoal.sprint.id }).draft?.status, "pending");

    const superseded = rejectSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: draftGoal.sprint.id,
      draftId: second.id,
      reason: "Needs a sharper validation task.",
      actorUserId: "operator-fixture",
    }).draft;
    assert.strictEqual(superseded.status, "rejected");
    assert.throws(
      () => rejectSprintPlanDraft({
        companyIdOrSlug: company.id,
        companyGoalId: draftGoal.sprint.id,
        draftId: first.id,
        reason: "Old draft was superseded.",
        actorUserId: "operator-fixture",
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "draft_not_pending",
    );

    const third = createSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: draftGoal.sprint.id,
      planningTaskId: planningTask.taskId,
      proposedByAgentId: agent.id,
      sprint: {
        name: "Approved sprint",
        objective: "Approved draft.",
        validationChecks: ["Operator can verify the approved sprint"],
        outOfScope: ["Unplanned scope creep"],
      },
      tasks: [{ id: "approved-task", title: "Approved execution task", priority: "P1", type: "feature", assignee: agent.id }],
    }).draft;
    const approved = approveSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: draftGoal.sprint.id,
      draftId: third.id,
      actorUserId: "operator-fixture",
    });
    assert.strictEqual(approved.draft.status, "approved");
    assert.strictEqual(approved.sprint.sprint.parentId, draftGoal.sprint.id);
    assert.strictEqual(approved.taskIds.length, 1);
    const context = buildTaskGoalContextSection({
      db: getOrchestrationDb(),
      taskId: approved.taskIds[0],
      agentId: agent.id,
    });
    assert.ok(context?.includes("Sprint validation checks"));
    assert.ok(context?.includes("Company goal: Draft-backed company goal"));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
