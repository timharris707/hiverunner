import assert from "node:assert";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(os.tmpdir(), `mc-goal-contract-gates-${Date.now()}.db`);

const { finish, test } = createTestRunner();

async function run() {
  console.log("\nOrchestration Goal Contract Gate Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

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
  const { getActionResultsTerminalFailure } = await import("@/lib/orchestration/engine/run-continuation");
  const { __testHooks: engineTestHooks, buildHeartbeatPrompt, executeMcAction, getOrCreateTaskSession, parseActionBlocksFromText } = await import("@/lib/orchestration/engine/engine");
  const { getLatestSprintPlanRejection } = await import("@/lib/orchestration/engine/status-transitions");
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

  await test("tiny deterministic active goal creates sprint draft without planner wake", () => {
    const db = getOrchestrationDb();
    const codingAgent = createProjectAgent({
      projectId: project.id,
      name: "Codex Builder",
      emoji: "icon:code",
      role: "Software engineer",
      personality: "Builds small deterministic utilities.",
      skills: ["typescript", "tests", "documentation"],
      status: "idle",
      adapterType: "codex",
    }).agent;

    const tinyGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Benchmark: Fast Path Decision Log Summarizer",
      goal: [
        "Benchmark goal: implement a small, self-contained Decision Log Summarizer utility in this repository.",
        "Create one focused sprint with a few simple tasks. Do not create follow-up sprints unless something is genuinely blocked.",
        "Add code, fixtures, tests, and a README or usage note under scratch/harness-comparison/decision-log-summarizer.",
        "Do not modify production runtime behavior. Do not promote, push, or deploy. Do not use network access.",
      ].join(" "),
      goalKind: "company",
      status: "active",
      leadAgentId: codingAgent.id,
      defaultExecutionEngine: "hiverunner",
      defaultModelLane: "default",
    }).goal;

    const planningTasks = db.prepare(
      `SELECT id
       FROM tasks
       WHERE sprint_id = ?
         AND title = ?
         AND archived_at IS NULL`
    ).all(tinyGoal.sprint.id, "Plan sprint for Benchmark: Fast Path Decision Log Summarizer");
    assert.strictEqual(planningTasks.length, 0);

    const plannerWake = db.prepare(
      `SELECT id
       FROM agent_wakeup_requests
       WHERE reason = 'goal_lead_planning'
         AND payload_json LIKE ?
       LIMIT 1`
    ).get(`%${tinyGoal.sprint.id}%`);
    assert.strictEqual(plannerWake, undefined);

    const draft = getPendingSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: tinyGoal.sprint.id,
    }).draft;
    assert.ok(draft);
    assert.strictEqual(draft.planningTaskId, null);
    assert.strictEqual(draft.tasks.length, 1);
    assert.strictEqual(draft.tasks[0].assignee, codingAgent.id);
    assert.strictEqual(draft.tasks[0].executionEngine, "hiverunner");
    assert.strictEqual(draft.tasks[0].modelLane, "default");
    const planningPolicy = draft.generationProvenance?.planningPolicy as { size?: string; qaMode?: string; maxTasksPerSprint?: number } | undefined;
    assert.strictEqual(planningPolicy?.size, "tiny");
    assert.strictEqual(planningPolicy?.qaMode, "skip_by_default");
    assert.strictEqual(planningPolicy?.maxTasksPerSprint, 1);
    const fastPath = draft.generationProvenance?.planningPolicyFastPath as { schema?: string; reason?: string } | undefined;
    assert.strictEqual(fastPath?.schema, "hiverunner.planning_policy_fast_path.v1");
    assert.strictEqual(fastPath?.reason, "tiny_low_risk_deterministic");

    const approved = approveSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: tinyGoal.sprint.id,
      draftId: draft.id,
      actorUserId: "operator-fixture",
    });
    assert.strictEqual(approved.taskIds.length, 1);
    const materializedTask = db.prepare(
      `SELECT assignee_agent_id, execution_engine, model_lane
       FROM tasks
       WHERE id = ?`
    ).get(approved.taskIds[0]) as { assignee_agent_id: string | null; execution_engine: string | null; model_lane: string | null };
    assert.strictEqual(materializedTask.assignee_agent_id, codingAgent.id);
    assert.strictEqual(materializedTask.execution_engine, "hiverunner");
    assert.strictEqual(materializedTask.model_lane, "default");

    const plannedTiny = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Benchmark: Activated Fast Path Utility",
      goal: "Small self-contained scratch utility with fixtures, tests, local validation, and README usage note. Do not deploy or use network access.",
      goalKind: "company",
      status: "planned",
      leadAgentId: codingAgent.id,
      defaultExecutionEngine: "hiverunner",
      defaultModelLane: "default",
    }).goal;
    assert.strictEqual(getPendingSprintPlanDraft({ companyIdOrSlug: company.id, companyGoalId: plannedTiny.sprint.id }).draft, null);
    updateCompanyGoal({
      companyIdOrSlug: company.id,
      sprintId: plannedTiny.sprint.id,
      status: "active",
      actorUserId: "operator-fixture",
    });
    const activatedDraft = getPendingSprintPlanDraft({ companyIdOrSlug: company.id, companyGoalId: plannedTiny.sprint.id }).draft;
    assert.ok(activatedDraft);
    assert.strictEqual(activatedDraft.tasks.length, 1);
    const activatedWake = db.prepare(
      `SELECT id
       FROM agent_wakeup_requests
       WHERE reason = 'goal_lead_planning'
         AND payload_json LIKE ?
       LIMIT 1`
    ).get(`%${plannedTiny.sprint.id}%`);
    assert.strictEqual(activatedWake, undefined);
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
    assert.ok(context?.includes("Small/self-contained goal rule"));
    assert.ok(context?.includes("Goal default routing: executionEngine=symphony"));
    assert.ok(context?.includes("Planning policy for this goal:"));
    assert.ok(context?.includes("at least half of non-QA/non-release tasks should be able to start immediately"));
    assert.ok(context?.includes("Use dependencies only for hard prerequisites"));
  });

  await test("planning policy action errors are terminal run failures", () => {
    const terminal = getActionResultsTerminalFailure({
      messagesImported: 1,
      actionsFound: 1,
      actionsExecuted: 0,
      actionsSkippedDedup: 0,
      actionsDeferred: 0,
      tasksCreated: [],
      approvalsCreated: [],
      reportsImported: 0,
      errors: ["propose_sprint_plan: planning_policy:task_count_exceeded"],
    });

    assert.strictEqual(terminal, "propose_sprint_plan: planning_policy:task_count_exceeded");
  });

  await test("small self-contained benchmark plans reject excessive task fanout", async () => {
    const db = getOrchestrationDb();
    const smallGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Benchmark: Decision Log Summarizer",
      goal: [
        "Benchmark goal: implement a small, self-contained Decision Log Summarizer utility in this repository.",
        "Create one focused sprint with a few simple tasks. Do not create follow-up sprints unless something is genuinely blocked.",
        "Add code, fixtures, tests, and a README or usage note. Use scratch/harness-comparison/decision-log-summarizer if needed.",
        "Do not modify production runtime behavior. Do not promote, push, or deploy. Do not use network access.",
      ].join(" "),
      goalKind: "company",
      status: "planned",
      leadAgentId: agent.id,
      defaultExecutionEngine: "hiverunner",
    }).goal;
    const planningTaskRecord = createTask({
      projectId: project.id,
      sprintId: smallGoal.sprint.id,
      title: "Plan sprint for Benchmark: Decision Log Summarizer",
      description: "Fixture planning task for validating Plan Mode policy admission.",
      priority: "P0",
      type: "research",
      status: "to-do",
      assignee: agent.id,
      labels: ["sprint-planning", "goal-contract"],
      executionEngine: "hiverunner",
      modelLane: "default",
      createdBy: "test",
    }).task;
    const planningTask = {
      taskId: planningTaskRecord.id,
      taskKey: planningTaskRecord.key ?? planningTaskRecord.id,
    };
    const smallContext = buildTaskGoalContextSection({
      db,
      taskId: planningTask.taskId,
      agentId: agent.id,
    });
    assert.ok(smallContext?.includes("Goal default routing: executionEngine=hiverunner"));
    assert.ok(smallContext?.includes("Policy hard rule: propose exactly one implementation task and zero QA/review/release tasks."));
    const runId = randomUUID();

    const overSplit = await executeMcAction({
      action: "propose_sprint_plan",
      companyGoalId: smallGoal.sprint.id,
      sprints: [{
        sequenceNumber: 1,
        name: "Build decision log summarizer",
        objective: "Implement the small scratch utility.",
        defaultExecutionEngine: "hiverunner",
        tasks: [
          { id: "parser", title: "Implement parser utility", description: "Parser code for the utility.", priority: "P1", type: "feature", assignee: agent.id },
          { id: "fixtures", title: "Add markdown fixtures", description: "Fixture files for complete, missing, and malformed metadata.", priority: "P2", type: "feature", assignee: agent.id },
          { id: "tests", title: "Add parser tests", description: "Focused tests for parser and summary output.", priority: "P2", type: "feature", assignee: agent.id },
          { id: "readme", title: "Write README usage note", description: "README docs for the utility.", priority: "P3", type: "docs", assignee: agent.id },
          { id: "integrate", title: "Integrate and validate", description: "Integrate local changes and run validation.", priority: "P2", type: "feature", assignee: agent.id, dependsOn: ["parser", "fixtures", "tests", "readme"] },
          { id: "qa", title: "QA handoff evidence", description: "QA validation and handoff summary.", priority: "P2", type: "qa", assignee: agent.id, dependsOn: ["integrate"] },
        ],
      }],
    }, {
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: planningTask.taskKey,
      runId,
    }, db);

    assert.deepStrictEqual(overSplit, {
      kind: "failed",
      reason: "planning_policy:task_count_exceeded",
    });
    assert.strictEqual(getPendingSprintPlanDraft({ companyIdOrSlug: company.id, companyGoalId: smallGoal.sprint.id }).draft, null);
    const rejectionComment = db.prepare(
      `SELECT body
       FROM comments
       WHERE task_id = ?
         AND type = 'status_update'
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(planningTask.taskId) as { body: string } | undefined;
    assert.ok(rejectionComment?.body.includes("Sprint plan draft rejected"));
    assert.ok(rejectionComment?.body.includes("size=tiny"));
    assert.ok(rejectionComment?.body.includes("one implementation task"));

    const routeOverride = await executeMcAction({
      action: "propose_sprint_plan",
      companyGoalId: smallGoal.sprint.id,
      sprints: [{
        sequenceNumber: 1,
        name: "Build decision log summarizer",
        objective: "Implement and validate the small scratch utility.",
        defaultExecutionEngine: "symphony",
        defaultModelLane: "fast",
        validationChecks: ["Operator can verify exactly one focused sprint with one implementation task and zero QA/review/release tasks."],
        tasks: [
          {
            id: "implement",
            title: "Implement decision log summarizer utility",
            description: "Create code, fixtures, tests, README, validation evidence, and final runtime summary for the small utility.",
            validation: "Run focused parser tests and report files changed plus available runtime metrics.",
            priority: "P1",
            type: "feature",
            assignee: agent.id,
            executionEngine: "symphony",
            modelLane: "fast",
          },
        ],
      }],
    }, {
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: planningTask.taskKey,
      runId: randomUUID(),
    }, db);

    assert.deepStrictEqual(routeOverride, {
      kind: "failed",
      reason: "planning_policy:default_execution_engine_changed",
    });

    const compact = await executeMcAction({
      action: "propose_sprint_plan",
      companyGoalId: smallGoal.sprint.id,
      sprints: [{
        sequenceNumber: 1,
        name: "Build decision log summarizer",
        objective: "Implement and validate the small scratch utility.",
        defaultExecutionEngine: "hiverunner",
        tasks: [
          {
            id: "implement",
            title: "Implement decision log summarizer utility",
            description: "Create code, fixtures, tests, README, validation evidence, and final runtime summary for the small utility. Avoid production runtime wiring.",
            validation: "Run focused parser tests, keep zero QA/review/release tasks, and report files changed plus available token/cost/runtime metrics.",
            priority: "P1",
            type: "feature",
            assignee: agent.id,
          },
        ],
      }],
    }, {
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: planningTask.taskKey,
      runId: randomUUID(),
    }, db);

    assert.strictEqual(compact.kind, "proposed_sprint_plan");
    const pendingDraft = getPendingSprintPlanDraft({ companyIdOrSlug: company.id, companyGoalId: smallGoal.sprint.id }).draft;
    assert.ok(pendingDraft);
    const planningPolicy = pendingDraft.generationProvenance?.planningPolicy as { qaMode?: string; maxTasksPerSprint?: number } | undefined;
    assert.strictEqual(planningPolicy?.qaMode, "skip_by_default");
    assert.strictEqual(planningPolicy?.maxTasksPerSprint, 1);
    assert.throws(
      () => approveSprintPlanDraft({
        companyIdOrSlug: company.id,
        companyGoalId: smallGoal.sprint.id,
        draftId: pendingDraft.id,
        tasks: [
          ...pendingDraft.tasks,
          {
            id: "qa",
            title: "Validate utility and handoff evidence",
            description: "Run focused validation and summarize files changed, checks, and available runtime metrics.",
            priority: "P2",
            type: "qa",
            assignee: agent.id,
            dependsOn: ["implement"],
          },
        ],
        actorUserId: "operator-fixture",
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "planning_policy_violation",
    );
    const approved = approveSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: smallGoal.sprint.id,
      draftId: pendingDraft.id,
      actorUserId: "operator-fixture",
    });
    assert.strictEqual(approved.taskIds.length, 1);
  });

  await test("planning policy requires QA for high-risk runtime routing drafts", () => {
    const runtimeGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Runtime routing hardening",
      goal: "Fix runtime model routing provider adapter behavior without regressing Codex execution.",
      goalKind: "company",
      status: "active",
      leadAgentId: agent.id,
      defaultExecutionEngine: "hiverunner",
    }).goal;
    const planningTask = createSprintPlanningTask({
      companyIdOrSlug: company.id,
      companyGoalId: runtimeGoal.sprint.id,
      leadAgentId: agent.id,
    });

    assert.throws(
      () => createSprintPlanDraft({
        companyIdOrSlug: company.id,
        companyGoalId: runtimeGoal.sprint.id,
        planningTaskId: planningTask.taskId,
        proposedByAgentId: agent.id,
        sprint: {
          name: "Runtime model routing fix",
          objective: "Change runtime routing behavior for model/provider selection.",
          validationChecks: ["Focused runtime routing regression tests pass."],
          outOfScope: [],
        },
        tasks: [{ id: "implement", title: "Fix runtime routing", priority: "P1", type: "feature", assignee: agent.id }],
      }),
      (error: unknown) =>
        error instanceof OrchestrationApiError &&
        error.code === "planning_policy_violation" &&
        // The rejection must tell the planner HOW to satisfy the gate —
        // naming the type field and its accepted values (probe paper cut:
        // Fable-Oracle failed twice to deduce the mechanism).
        /set one task's "type" field to "qa", "review", or "release"/.test(error.message),
    );

    const accepted = createSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: runtimeGoal.sprint.id,
      planningTaskId: planningTask.taskId,
      proposedByAgentId: agent.id,
      sprint: {
        name: "Runtime model routing fix",
        objective: "Change runtime routing behavior for model/provider selection.",
        validationChecks: ["Focused runtime routing regression tests pass.", "QA verifies Codex routing remains unchanged."],
        outOfScope: [],
      },
      tasks: [
        { id: "implement", title: "Fix runtime routing", priority: "P1", type: "feature", assignee: agent.id },
        { id: "qa", title: "QA runtime routing behavior", priority: "P1", type: "qa", assignee: agent.id, dependsOn: ["implement"] },
      ],
    }).draft;
    const planningPolicy = accepted.generationProvenance?.planningPolicy as { qaMode?: string; requireQa?: boolean } | undefined;
    assert.strictEqual(planningPolicy?.qaMode, "required");
    assert.strictEqual(planningPolicy?.requireQa, true);
  });

  await test("goal create defaults an omitted lead from the company designation", () => {
    const db = getOrchestrationDb();
    db.prepare("UPDATE companies SET lead_agent_id = ? WHERE id = ?").run(agent.id, company.id);
    try {
      const defaulted = createCompanyGoal({
        companyIdOrSlug: company.id,
        projectId: project.id,
        name: `Lead default goal ${stamp}`,
        goal: "Confirm an omitted lead resolves to the designated company lead.",
        goalKind: "company",
        status: "planned",
      }).goal;
      const defaultedRow = db
        .prepare("SELECT lead_agent_id FROM sprints WHERE id = ?")
        .get(defaulted.sprint.id) as { lead_agent_id: string | null };
      assert.strictEqual(defaultedRow.lead_agent_id, agent.id, "omitted lead must resolve the company designation");

      const explicitNull = createCompanyGoal({
        companyIdOrSlug: company.id,
        projectId: project.id,
        name: `Leadless goal ${stamp}`,
        goal: "Confirm an explicit null lead stays leadless.",
        goalKind: "company",
        status: "planned",
        leadAgentId: null,
      }).goal;
      const nullRow = db
        .prepare("SELECT lead_agent_id FROM sprints WHERE id = ?")
        .get(explicitNull.sprint.id) as { lead_agent_id: string | null };
      assert.strictEqual(nullRow.lead_agent_id, null, "explicit null is an operator opt-out and stays leadless");
    } finally {
      // Shared fixture company — later tests rely on goals staying leadless
      // unless they pass a lead explicitly.
      db.prepare("UPDATE companies SET lead_agent_id = NULL WHERE id = ?").run(company.id);
    }
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

  await test("propose_sprint_plan coerces priority/type synonyms instead of dropping the plan", () => {
    const text = [
      "```mc-action",
      JSON.stringify({
        action: "propose_sprint_plan",
        companyGoalId: "goal-fixture",
        sprints: [
          {
            sequenceNumber: 1,
            name: "Build it",
            objective: "Ship the prototype.",
            tasks: [
              { id: "t1", title: "High word priority", priority: "high", type: "Feature" },
              { id: "t2", title: "Bogus priority drops field", priority: "screaming", type: "feature" },
              { id: "t3", title: "Bogus type drops field", priority: "P2", type: "made-up" },
            ],
          },
        ],
      }),
      "```",
    ].join("\n");

    const { actions, parseErrors } = parseActionBlocksFromText(text);
    assert.strictEqual(parseErrors.length, 0, `plan must not be dropped: ${parseErrors.join("; ")}`);
    assert.strictEqual(actions.length, 1, "exactly one propose_sprint_plan action survives");
    const tasks = (actions[0] as unknown as {
      sprints: Array<{ tasks: Array<Record<string, unknown>> }>;
    }).sprints[0].tasks;
    assert.strictEqual(tasks[0].priority, "P1", "'high' coerces to P1");
    assert.strictEqual(tasks[0].type, "feature", "'Feature' coerces to canonical 'feature'");
    assert.strictEqual(tasks[1].priority, undefined, "unrecognized priority is dropped, not the plan");
    assert.strictEqual(tasks[1].type, "feature", "valid type is preserved alongside a dropped sibling field");
    assert.strictEqual(tasks[2].priority, "P2", "valid P2 preserved");
    assert.strictEqual(tasks[2].type, undefined, "unrecognized type is dropped, not the plan");
  });

  await test("planning task cannot reach review (and convert to done) without a sprint-plan draft", async () => {
    const db = getOrchestrationDb();
    const gateGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Planning gate company goal",
      goal: "Exercise the review-path planning gate.",
      goalKind: "company",
      status: "active",
    }).goal;
    const planningTask = createSprintPlanningTask({
      companyIdOrSlug: company.id,
      companyGoalId: gateGoal.sprint.id,
      leadAgentId: agent.id,
    });
    const planningTaskRow = db
      .prepare("SELECT task_key FROM tasks WHERE id = ?")
      .get(planningTask.taskId) as { task_key: string };

    // Mirror the live flow: the engine auto-claims the planning task to
    // in_progress on run start, then the lead's run emits update_task -> review.
    db.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(planningTask.taskId);

    const attempt = await executeMcAction({
      action: "update_task",
      taskKey: planningTaskRow.task_key,
      status: "review",
      comment: "Plan is ready (but no draft was emitted).",
    }, {
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: planningTaskRow.task_key,
      runId: randomUUID(),
    }, db);
    // executeMcAction surfaces a rejected status transition as kind:"failed"
    // with the reason embedded — the planning gate must be what rejected it.
    assert.strictEqual(attempt.kind, "failed");
    assert.strictEqual(
      (attempt as { reason: string }).reason,
      "status_transition_rejected:planning_draft_required",
      "review without a draft must be rejected by the planning gate, not silently converted to done",
    );

    const afterStatus = db
      .prepare("SELECT status FROM tasks WHERE id = ?")
      .get(planningTask.taskId) as { status: string };
    assert.strictEqual(afterStatus.status, "in_progress", "task holds in_progress — not hollow-done, not stranded in review");

    const guardComment = db
      .prepare(
        `SELECT body FROM comments WHERE task_id = ? AND source = 'engine' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(planningTask.taskId) as { body: string } | undefined;
    assert.ok(
      guardComment?.body.includes("sprint plan draft"),
      "operator-visible guard comment explains the stuck-lead state",
    );
  });

  // Shared fixture for the plan-policy feedback tests: a high-risk goal whose
  // sprint-planning task has had one over-count propose_sprint_plan rejected
  // (3 QA/review/release tasks vs the policy max of 2), with no draft on file.
  const seedRejectedPlanningTask = async (label: string, claimInProgress: boolean) => {
    const db = getOrchestrationDb();
    const goal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: `Plan-feedback ${label} goal`,
      goal: "High-risk work touching production runtime and provider behavior. Require a separate QA/review task before completion.",
      goalKind: "company",
      status: "active",
      leadAgentId: agent.id,
    }).goal;
    const planningTask = createTask({
      projectId: project.id,
      sprintId: goal.sprint.id,
      title: `Plan sprint (${label})`,
      description: "Fixture planning task for plan-policy feedback.",
      priority: "P0",
      type: "research",
      status: "to-do",
      assignee: agent.id,
      labels: ["sprint-planning", "goal-contract"],
      createdBy: "test",
    }).task;
    if (claimInProgress) {
      db.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(planningTask.id);
    }
    const taskKey = planningTask.key ?? planningTask.id;
    const overCount = await executeMcAction({
      action: "propose_sprint_plan",
      companyGoalId: goal.sprint.id,
      sprints: [{
        sequenceNumber: 1,
        name: "Prototype sprint",
        objective: "Build the prototype in one focused sprint.",
        tasks: [
          { id: "impl", title: "Implement the prototype", description: "Build the deliverable.", priority: "P1", type: "feature", assignee: agent.id },
          { id: "qa1", title: "QA the prototype", description: "Verify behavior.", priority: "P2", type: "qa", assignee: agent.id, dependsOn: ["impl"] },
          { id: "qa2", title: "Review the prototype", description: "Independent review.", priority: "P2", type: "review", assignee: agent.id, dependsOn: ["impl"] },
          { id: "qa3", title: "Release readiness check", description: "Release gate.", priority: "P2", type: "release", assignee: agent.id, dependsOn: ["impl"] },
        ],
      }],
    }, { agentId: agent.id, agentName: agent.name, companyId: company.id, taskKey, runId: randomUUID() }, db);
    return { db, goal, planningTask, taskKey, overCount };
  };

  await test("getLatestSprintPlanRejection recovers the latest plan-policy rejection reason and detail", async () => {
    const { db, planningTask, overCount } = await seedRejectedPlanningTask("helper", false);
    assert.strictEqual(overCount.kind, "failed");
    assert.strictEqual((overCount as { reason: string }).reason, "planning_policy:qa_count_exceeded");

    const recovered = getLatestSprintPlanRejection(db, planningTask.id);
    assert.ok(recovered, "a rejection is recovered after a rejected plan");
    assert.strictEqual(recovered?.reason, "planning_policy:qa_count_exceeded");
    assert.ok(recovered?.detail.includes("QA/review/release"), "detail carries the human-readable violation");

    const freshGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Plan-feedback fresh goal",
      goal: "Low-risk self-contained scratch utility.",
      goalKind: "company",
      status: "active",
      leadAgentId: agent.id,
    }).goal;
    const freshTask = createTask({
      projectId: project.id,
      sprintId: freshGoal.sprint.id,
      title: "Plan sprint (fresh)",
      description: "Fixture planning task with no rejection.",
      priority: "P0",
      type: "research",
      status: "to-do",
      assignee: agent.id,
      labels: ["sprint-planning", "goal-contract"],
      createdBy: "test",
    }).task;
    assert.strictEqual(getLatestSprintPlanRejection(db, freshTask.id), null, "no rejection comment yields null");
  });

  await test("buildHeartbeatPrompt surfaces a prior plan-policy rejection to the planning retry", async () => {
    const { db, goal, planningTask } = await seedRejectedPlanningTask("prompt", true);
    const agentRowSql = `
      SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
             adapter_config_json, runtime_config_json, capabilities,
             NULL AS runtime_workspace_root
      FROM agents WHERE id = ? LIMIT 1
    `;
    const agentRow = db.prepare(agentRowSql).get(agent.id) as never;
    const session = getOrCreateTaskSession({ agentId: agent.id, companyId: company.id, taskKey: planningTask.id }, db);

    const retryPrompt = buildHeartbeatPrompt(agentRow, {}, session, db);
    assert.match(retryPrompt, /Previous Sprint Plan Rejected/, "retry prompt surfaces the rejection prominently");
    assert.ok(retryPrompt.includes("planning_policy:qa_count_exceeded"), "retry prompt names the policy reason");
    assert.ok(retryPrompt.includes("QA/review/release"), "retry prompt carries the concrete violation detail");
    assert.ok(retryPrompt.includes("Do not re-propose the same shape"), "retry prompt gives an imperative to revise");

    // A sibling planning task on the same goal with no rejection of its own gets no banner.
    const cleanTask = createTask({
      projectId: project.id,
      sprintId: goal.sprint.id,
      title: "Plan sprint (prompt-clean)",
      description: "Sibling planning task with no rejection.",
      priority: "P0",
      type: "research",
      status: "to-do",
      assignee: agent.id,
      labels: ["sprint-planning", "goal-contract"],
      createdBy: "test",
    }).task;
    const cleanSession = getOrCreateTaskSession({ agentId: agent.id, companyId: company.id, taskKey: cleanTask.id }, db);
    const cleanPrompt = buildHeartbeatPrompt(agentRow, {}, cleanSession, db);
    assert.ok(!cleanPrompt.includes("Previous Sprint Plan Rejected"), "no banner without a rejection on this task");
  });

  await test("planning_draft_required guard comment names the actual last violation", async () => {
    const { db, planningTask, taskKey } = await seedRejectedPlanningTask("guard", true);

    const attempt = await executeMcAction({
      action: "update_task",
      taskKey,
      status: "review",
      comment: "Plan is ready.",
    }, { agentId: agent.id, agentName: agent.name, companyId: company.id, taskKey, runId: randomUUID() }, db);
    assert.strictEqual(attempt.kind, "failed");
    assert.strictEqual(
      (attempt as { reason: string }).reason,
      "status_transition_rejected:planning_draft_required",
    );

    const guardComment = db
      .prepare(
        `SELECT body FROM comments
         WHERE task_id = ? AND source = 'engine' AND body LIKE 'Planning task cannot move%'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(planningTask.id) as { body: string } | undefined;
    assert.ok(guardComment, "guard comment exists");
    assert.ok(
      guardComment?.body.includes("planning_policy:qa_count_exceeded"),
      "guard names the actual rejection reason, not just the priority example",
    );
    assert.ok(
      guardComment?.body.includes("Revise the plan"),
      "guard tells the agent to revise the flagged constraint",
    );
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
