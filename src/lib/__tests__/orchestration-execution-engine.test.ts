import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-execution-engine-test-${Date.now()}.db`,
  );
}

const originalWorkspaceRoot = process.env.MC_WORKSPACE_ROOT;
const tempWorkspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mc-execution-engine-workspaces-"));
process.env.MC_WORKSPACE_ROOT = path.join(tempWorkspaceRoot, "workspaces");
mkdirSync(process.env.MC_WORKSPACE_ROOT, { recursive: true });

let passed = 0;
let failed = 0;

function cleanupWorkspaceRoot() {
  if (originalWorkspaceRoot === undefined) {
    delete process.env.MC_WORKSPACE_ROOT;
  } else {
    process.env.MC_WORKSPACE_ROOT = originalWorkspaceRoot;
  }
  rmSync(tempWorkspaceRoot, { recursive: true, force: true });
}

process.once("exit", cleanupWorkspaceRoot);

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
  console.log("\nExecution Engine Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH!;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const { createProject, createProjectAgent, createTask, getTask, moveTask, updateProjectSettings, updateTask } = await import("@/lib/orchestration/service");
  const { createCompany, updateCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { getTaskBridgeRecord } = await import("@/lib/orchestration/bridge");
  const { pollTaskExecutionStatus, triggerTaskExecution, triggerTaskNudge } = await import("@/lib/orchestration/execution");
  const { executeCreateTask, executeUpdateTask } = await import("@/lib/orchestration/engine/engine");
  const { createApproval } = await import("@/lib/orchestration/service/approval");
  const { configureCompanyExecutionHive, ensureCompanyExecutionHives } = await import("@/lib/orchestration/service/execution-hives");

  const company = createCompany({
    name: `Execution Engine Co ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Execution Engine ${Date.now()}`,
    description: "fixture",
    color: "#0ea5e9",
    emoji: "E",
    status: "active",
  }).project;

  function ensureSymphonyHive() {
    const db = getOrchestrationDb();
    ensureCompanyExecutionHives({ companyIdOrSlug: company.id }, db);
    configureCompanyExecutionHive({
      companyIdOrSlug: company.id,
      hiveId: "balanced-builder",
      orchestrationMode: "symphony",
      runtimeProvider: "codex",
      runtimeLabel: "Codex",
      modelRouting: "hive-managed",
      modelRoutingLabel: "Hive managed",
    }, db);
  }

  await test("new tasks default to HiveRunner execution engine", () => {
    const task = createTask({
      projectId: project.id,
      title: "Default engine fixture",
      description: "defaults should preserve current behavior",
      priority: "P2",
      type: "feature",
      status: "backlog",
      labels: [],
      createdBy: "test",
    }).task;

    assert.strictEqual(task.executionEngine, "hiverunner");
    assert.strictEqual(task.executionEngineOverride, "hiverunner");
    assert.strictEqual(task.executionEngineSource, "task");
    assert.strictEqual(getTask(task.id).task.executionEngine, "hiverunner");
    assert.strictEqual(getTaskBridgeRecord(task.id).executionEngine, "hiverunner");
  });

  await test("task model lane defaults and inherits from parent tasks", () => {
    const parent = createTask({
      projectId: project.id,
      title: "Model lane parent fixture",
      description: "parent",
      priority: "P2",
      type: "feature",
      status: "backlog",
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
      modelLane: "fast",
    }).task;

    assert.strictEqual(parent.modelLane, "fast");
    assert.strictEqual(getTaskBridgeRecord(parent.id).modelLane, "fast");

    const child = createTask({
      projectId: project.id,
      parentTaskId: parent.id,
      title: "Model lane child fixture",
      description: "child",
      priority: "P2",
      type: "feature",
      status: "backlog",
      labels: [],
      createdBy: "test",
    }).task;

    assert.strictEqual(child.executionEngineOverride, "symphony");
    assert.strictEqual(child.executionEngine, "symphony");
    assert.strictEqual(child.modelLane, "fast");
    assert.strictEqual(getTaskBridgeRecord(child.id).modelLane, "fast");

    const updated = updateTask({
      taskId: child.id,
      modelLane: "deep",
      actorUserId: "test",
    }).task;
    assert.strictEqual(updated.modelLane, "deep");
    assert.strictEqual(getTaskBridgeRecord(child.id).modelLane, "deep");
  });

  await test("new tasks snapshot the selected project/company execution engine", () => {
    updateCompany({
      companySlug: company.slug,
      defaultExecutionEngine: "manual",
    });

    const companyDefaultTask = createTask({
      projectId: project.id,
      title: "Company default engine fixture",
      description: "inherits company default",
      priority: "P2",
      type: "feature",
      status: "backlog",
      labels: [],
      createdBy: "test",
    }).task;
    assert.strictEqual(companyDefaultTask.executionEngine, "manual");
    assert.strictEqual(companyDefaultTask.executionEngineOverride, "manual");
    assert.strictEqual(companyDefaultTask.executionEngineSource, "task");
    assert.strictEqual(getTaskBridgeRecord(companyDefaultTask.id).executionEngine, "manual");

    updateProjectSettings({
      projectIdOrSlug: project.id,
      defaultExecutionEngine: "symphony",
    });

    const projectDefaultTask = createTask({
      projectId: project.id,
      title: "Project default engine fixture",
      description: "inherits project default",
      priority: "P2",
      type: "feature",
      status: "backlog",
      labels: [],
      createdBy: "test",
    }).task;
    assert.strictEqual(projectDefaultTask.executionEngine, "symphony");
    assert.strictEqual(projectDefaultTask.executionEngineOverride, "symphony");
    assert.strictEqual(projectDefaultTask.executionEngineSource, "task");

    const taskOverride = updateTask({
      taskId: projectDefaultTask.id,
      executionEngine: "hiverunner",
      actorUserId: "test",
    }).task;
    assert.strictEqual(taskOverride.executionEngine, "hiverunner");
    assert.strictEqual(taskOverride.executionEngineOverride, "hiverunner");
    assert.strictEqual(taskOverride.executionEngineSource, "task");

    const restoredInheritance = updateTask({
      taskId: projectDefaultTask.id,
      executionEngine: null,
      actorUserId: "test",
    }).task;
    assert.strictEqual(restoredInheritance.executionEngine, "symphony");
    assert.strictEqual(restoredInheritance.executionEngineOverride, null);
    assert.strictEqual(restoredInheritance.executionEngineSource, "project");
  });

  await test("task execution engine can be set to Symphony without delegating away from HiveRunner", async () => {
    ensureSymphonyHive();
    const task = createTask({
      projectId: project.id,
      title: "Symphony engine fixture",
      description: "delegated task",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
      modelLane: "deep",
    }).task;

    assert.strictEqual(task.executionEngine, "symphony");

    const execution = await triggerTaskExecution({
      taskId: task.id,
      reason: "execution_engine_test",
    });
    assert.strictEqual(execution.status, "skipped");
    assert.strictEqual(execution.reason, "assignee_required");

    const nudge = await triggerTaskNudge({
      taskId: task.id,
      reason: "execution_engine_test",
    });
    assert.strictEqual(nudge.status, "skipped");
    assert.strictEqual(nudge.reason, "assignee_required");
  });

  await test("agent-created Symphony tasks can be explicitly queued without auto-starting", async () => {
    const db = getOrchestrationDb();
    const lead = createProjectAgent({
      projectId: project.id,
      name: `Queue Lead ${Date.now()}`,
      emoji: "L",
      role: "Lead",
      personality: "Creates queued work.",
      status: "idle",
      skills: [],
    }).agent;
    const builder = createProjectAgent({
      projectId: project.id,
      name: `Queue Builder ${Date.now()}`,
      emoji: "B",
      role: "Builder",
      personality: "Runs work.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(lead.id, builder.id);

    const parent = createTask({
      projectId: project.id,
      title: `Queued Symphony parent ${Date.now()}`,
      description: "parent",
      priority: "P2",
      type: "directive",
      status: "in-progress",
      assignee: lead.id,
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
      modelLane: "deep",
    }).task;

    const childId = await executeCreateTask(
      {
        action: "create_task",
        title: `Queued Symphony child ${Date.now()}`,
        assignee: builder.name,
        parent: parent.key,
        status: "backlog",
      },
      {
        agentId: lead.id,
        agentName: lead.name,
        companyId: company.id,
        taskKey: parent.id,
        runId: `queued-child-${Date.now()}`,
      },
      db,
    );
    assert.ok(childId);

    const child = db.prepare("SELECT status, execution_engine, model_lane FROM tasks WHERE id = ?").get(childId) as {
      status: string;
      execution_engine: string | null;
      model_lane: string;
    };
    assert.strictEqual(child.status, "backlog");
    assert.strictEqual(child.execution_engine, "symphony");
    assert.strictEqual(child.model_lane, "deep");

    const runs = db.prepare("SELECT COUNT(*) AS count FROM execution_runs WHERE task_id = ?").get(childId) as { count: number };
    assert.strictEqual(runs.count, 0, "explicitly queued child task should not create an execution run");
  });

  await test("agent-created Symphony tasks auto-start through Symphony provider when not explicitly queued", async () => {
    const db = getOrchestrationDb();
    const lead = createProjectAgent({
      projectId: project.id,
      name: `Auto Lead ${Date.now()}`,
      emoji: "L",
      role: "Lead",
      personality: "Creates work.",
      status: "idle",
      skills: [],
    }).agent;
    const builder = createProjectAgent({
      projectId: project.id,
      name: `Auto Builder ${Date.now()}`,
      emoji: "B",
      role: "Builder",
      personality: "Runs work.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(lead.id, builder.id);

    const parent = createTask({
      projectId: project.id,
      title: `Auto Symphony parent ${Date.now()}`,
      description: "parent",
      priority: "P2",
      type: "directive",
      status: "in-progress",
      assignee: lead.id,
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
      modelLane: "fast",
    }).task;

    const childId = await executeCreateTask(
      {
        action: "create_task",
        title: `Auto Symphony child ${Date.now()}`,
        assignee: builder.name,
        parent: parent.key,
      },
      {
        agentId: lead.id,
        agentName: lead.name,
        companyId: company.id,
        taskKey: parent.id,
        runId: `auto-child-${Date.now()}`,
      },
      db,
    );
    assert.ok(childId);

    const child = db.prepare("SELECT status, execution_engine, model_lane FROM tasks WHERE id = ?").get(childId) as {
      status: string;
      execution_engine: string | null;
      model_lane: string;
    };
    assert.strictEqual(child.status, "in_progress");
    assert.strictEqual(child.execution_engine, "symphony");
    assert.strictEqual(child.model_lane, "fast");

    const run = db
      .prepare("SELECT id, provider, execution_engine, runner_provider, status FROM execution_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(childId) as { id: string; provider: string; execution_engine: string | null; runner_provider: string | null; status: string } | undefined;
    assert.ok(run, "auto-start should create an execution run");
    assert.strictEqual(run.provider, "symphony");
    assert.strictEqual(run.execution_engine, "symphony");
    assert.ok(["codex", "symphony"].includes(run.runner_provider ?? ""));
    assert.strictEqual(run.status, "pending");

    const heartbeat = db
      .prepare(
        `SELECT context_snapshot_json
         FROM heartbeat_runs
         WHERE json_extract(context_snapshot_json, '$.taskId') = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(childId) as { context_snapshot_json: string } | undefined;
    assert.ok(heartbeat, "auto-start should queue a heartbeat");
    const snapshot = JSON.parse(heartbeat.context_snapshot_json) as Record<string, unknown>;
    assert.strictEqual(snapshot.executionEngine, "symphony");
    assert.ok(["codex", "symphony"].includes(String(snapshot.executionProvider ?? "")));
    assert.strictEqual(snapshot.modelLane, "fast");
    assert.strictEqual(snapshot.executionRunId, run.id);
  });

  await test("agent-created Symphony follow-up tasks inherit trusted runner routing without an explicit parent", async () => {
    const db = getOrchestrationDb();
    const lead = createProjectAgent({
      projectId: project.id,
      name: `Follow-up Lead ${Date.now()}`,
      emoji: "L",
      role: "Lead",
      personality: "Creates follow-up work.",
      status: "idle",
      skills: [],
    }).agent;
    const builder = createProjectAgent({
      projectId: project.id,
      name: `Follow-up Builder ${Date.now()}`,
      emoji: "B",
      role: "Builder",
      personality: "Runs follow-up work.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(lead.id, builder.id);

    const focused = createTask({
      projectId: project.id,
      title: `Focused Symphony feature ${Date.now()}`,
      description: "feature task creating unparented follow-up work",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: lead.id,
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
      modelLane: "deep",
    }).task;

    const followUpId = await executeCreateTask(
      {
        action: "create_task",
        title: `Trusted Symphony follow-up ${Date.now()}`,
        assignee: builder.name,
        description: "Unparented follow-up should keep the trusted Symphony route.",
      },
      {
        agentId: lead.id,
        agentName: lead.name,
        companyId: company.id,
        taskKey: focused.id,
        runId: `follow-up-${Date.now()}`,
      },
      db,
    );
    assert.ok(followUpId);

    const followUp = db.prepare("SELECT status, parent_task_id, execution_engine, model_lane FROM tasks WHERE id = ?").get(followUpId) as {
      status: string;
      parent_task_id: string | null;
      execution_engine: string | null;
      model_lane: string;
    };
    assert.strictEqual(followUp.parent_task_id, null);
    assert.strictEqual(followUp.status, "in_progress");
    assert.strictEqual(followUp.execution_engine, "symphony");
    assert.strictEqual(followUp.model_lane, "deep");

    const run = db
      .prepare("SELECT id, provider, execution_engine, runner_provider, status FROM execution_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(followUpId) as { id: string; provider: string; execution_engine: string | null; runner_provider: string | null; status: string } | undefined;
    assert.ok(run, "auto-start should create an execution run");
    assert.strictEqual(run.provider, "symphony");
    assert.strictEqual(run.execution_engine, "symphony");
    assert.ok(["codex", "symphony"].includes(run.runner_provider ?? ""));
    assert.strictEqual(run.status, "pending");

    const heartbeat = db
      .prepare(
        `SELECT context_snapshot_json
         FROM heartbeat_runs
         WHERE json_extract(context_snapshot_json, '$.taskId') = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(followUpId) as { context_snapshot_json: string } | undefined;
    assert.ok(heartbeat, "auto-start should queue a heartbeat");
    const snapshot = JSON.parse(heartbeat.context_snapshot_json) as Record<string, unknown>;
    assert.strictEqual(snapshot.executionEngine, "symphony");
    assert.ok(["codex", "symphony"].includes(String(snapshot.executionProvider ?? "")));
    assert.strictEqual(snapshot.modelLane, "deep");
    assert.strictEqual(snapshot.executionRunId, run.id);

    const event = db
      .prepare("SELECT metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.created' LIMIT 1")
      .get(followUpId) as { metadata_json: string } | undefined;
    assert.ok(event, "task.created event should be recorded");
    const metadata = JSON.parse(event.metadata_json) as Record<string, unknown>;
    assert.strictEqual(metadata.executionEngineInheritedFromFocusedTask, true);
    assert.strictEqual(metadata.modelLaneInheritedFromFocusedTask, true);
  });

  await test("tasks submitted to review hand off to a runnable QA agent when available", () => {
    const db = getOrchestrationDb();
    const builder = createProjectAgent({
      projectId: project.id,
      name: `Review Builder ${Date.now()}`,
      emoji: "B",
      role: "Builder",
      personality: "Submits work.",
      status: "idle",
      skills: [],
    }).agent;
    const qa = createProjectAgent({
      projectId: project.id,
      name: `QA ${Date.now()}`,
      emoji: "Q",
      role: "QA Lead",
      personality: "Reviews work.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(builder.id, qa.id);

    const task = createTask({
      projectId: project.id,
      title: `Review handoff ${Date.now()}`,
      description: "handoff",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: builder.id,
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
    }).task;

    const result = executeUpdateTask(
      { action: "update_task", taskKey: task.key as string, status: "review" },
      { agentId: builder.id, companyId: company.id, runId: `review-handoff-${Date.now()}` },
      db,
    );
    assert.strictEqual(result.statusApplied, true, result.statusRejectedReason);

    const row = db.prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
      status: string;
      assignee_agent_id: string | null;
    };
    assert.strictEqual(row.status, "review");
    assert.ok(row.assignee_agent_id, "review handoff should leave the task assigned");
  });

  await test("protected runtime approval dedupe is scoped by command fingerprint", () => {
    const db = getOrchestrationDb();
    const firstAgent = createProjectAgent({
      projectId: project.id,
      name: `Protected First ${Date.now()}`,
      emoji: "P",
      role: "Release Steward",
      personality: "Requests protected runtime work.",
      status: "idle",
      skills: [],
    }).agent;
    const secondAgent = createProjectAgent({
      projectId: project.id,
      name: `Protected Second ${Date.now()}`,
      emoji: "S",
      role: "QA",
      personality: "Requests a different protected runtime command.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(firstAgent.id, secondAgent.id);

    const task = createTask({
      projectId: project.id,
      title: `Protected approval dedupe ${Date.now()}`,
      description: "Different protected commands on the same task need distinct approvals.",
      priority: "P2",
      type: "maintenance",
      status: "in-progress",
      assignee: firstAgent.id,
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
    }).task;

    const first = createApproval({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      requestedByAgentId: firstAgent.id,
      linkedTaskId: task.id,
      payload: {
        agentId: firstAgent.id,
        command: "codex exec first",
        fingerprint: "protected-command:first",
      },
    }).approval;
    const second = createApproval({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      requestedByAgentId: secondAgent.id,
      linkedTaskId: task.id,
      payload: {
        agentId: secondAgent.id,
        command: "codex exec second",
        fingerprint: "protected-command:second",
      },
    }).approval;
    const duplicateSecond = createApproval({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      requestedByAgentId: secondAgent.id,
      linkedTaskId: task.id,
      payload: {
        agentId: secondAgent.id,
        command: "codex exec second",
        fingerprint: "protected-command:second",
      },
    }).approval;

    assert.notStrictEqual(first.id, second.id, "different protected commands on one task need separate approvals");
    assert.strictEqual(duplicateSecond.id, second.id, "same command fingerprint should reuse the open approval");
  });

  await test("engine-approved review tasks return assignee ownership to the producer", () => {
    const db = getOrchestrationDb();
    const builder = createProjectAgent({
      projectId: project.id,
      name: `Review Return Builder ${Date.now()}`,
      emoji: "B",
      role: "Builder",
      personality: "Builds work.",
      status: "idle",
      skills: [],
    }).agent;
    const qa = createProjectAgent({
      projectId: project.id,
      name: `A Return QA ${Date.now()}`,
      emoji: "Q",
      role: "QA",
      personality: "Approves work.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(builder.id, qa.id);

    const task = createTask({
      projectId: project.id,
      title: `Review return ${Date.now()}`,
      description: "producer should own done card",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: builder.id,
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
    }).task;

    const reviewResult = executeUpdateTask(
      { action: "update_task", taskKey: task.key as string, status: "review" },
      { agentId: builder.id, companyId: company.id, runId: `review-return-${Date.now()}` },
      db,
    );
    assert.strictEqual(reviewResult.statusApplied, true, reviewResult.statusRejectedReason);

    const reviewRow = db.prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
      status: string;
      assignee_agent_id: string | null;
    };
    assert.strictEqual(reviewRow.status, "review");
    assert.ok(reviewRow.assignee_agent_id, "review handoff should leave the task assigned");

    const doneResult = executeUpdateTask(
      { action: "update_task", taskKey: task.key as string, status: "done", comment: "QA approved." },
      { agentId: qa.id, companyId: company.id, runId: `review-done-${Date.now()}` },
      db,
    );
    assert.strictEqual(doneResult.statusApplied, true, doneResult.statusRejectedReason);
    assert.strictEqual(doneResult.statusApplied, true);

    const doneRow = db.prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
      status: string;
      assignee_agent_id: string | null;
    };
    assert.strictEqual(doneRow.status, "done");
    assert.strictEqual(doneRow.assignee_agent_id, builder.id);
  });

  await test("UI-approved review tasks return assignee ownership to the producer", () => {
    const db = getOrchestrationDb();
    const builder = createProjectAgent({
      projectId: project.id,
      name: `UI Return Builder ${Date.now()}`,
      emoji: "B",
      role: "Builder",
      personality: "Builds work.",
      status: "idle",
      skills: [],
    }).agent;
    const qa = createProjectAgent({
      projectId: project.id,
      name: `A UI Return QA ${Date.now()}`,
      emoji: "Q",
      role: "QA",
      personality: "Approves work.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(builder.id, qa.id);

    const task = createTask({
      projectId: project.id,
      title: `UI review return ${Date.now()}`,
      description: "service move should preserve producer ownership",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: builder.id,
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
    }).task;

    const reviewResult = executeUpdateTask(
      { action: "update_task", taskKey: task.key as string, status: "review" },
      { agentId: builder.id, companyId: company.id, runId: `ui-review-return-${Date.now()}` },
      db,
    );
    assert.strictEqual(reviewResult.statusApplied, true, reviewResult.statusRejectedReason);

    const moved = moveTask({
      taskId: task.id,
      status: "done",
      reviewNotes: "Approved in the UI.",
      actorUserId: "test",
    }).task;

    assert.strictEqual(moved.status, "done");
    assert.strictEqual(moved.assignee, builder.name);
  });

  await test("agent-created children do not inherit a legacy manual parent engine by default", async () => {
    const db = getOrchestrationDb();
    updateProjectSettings({
      projectIdOrSlug: project.id,
      defaultExecutionEngine: "hiverunner",
    });
    const lead = createProjectAgent({
      projectId: project.id,
      name: `Manual Parent Lead ${Date.now()}`,
      emoji: "L",
      role: "Lead",
      personality: "Creates work.",
      status: "idle",
      skills: [],
    }).agent;
    const builder = createProjectAgent({
      projectId: project.id,
      name: `Manual Parent Builder ${Date.now()}`,
      emoji: "B",
      role: "Builder",
      personality: "Runs work.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(lead.id, builder.id);

    const parent = createTask({
      projectId: project.id,
      title: `Manual parent ${Date.now()}`,
      description: "legacy parent",
      priority: "P2",
      type: "directive",
      status: "in-progress",
      assignee: lead.id,
      labels: [],
      createdBy: "test",
      executionEngine: "manual",
      modelLane: "deep",
    }).task;

    const childId = await executeCreateTask(
      {
        action: "create_task",
        title: `Autonomous child ${Date.now()}`,
        assignee: builder.name,
        parent: parent.key,
      },
      {
        agentId: lead.id,
        agentName: lead.name,
        companyId: company.id,
        taskKey: parent.id,
        runId: `manual-parent-child-${Date.now()}`,
      },
      db,
    );
    assert.ok(childId);

    const child = db.prepare("SELECT execution_engine, model_lane FROM tasks WHERE id = ?").get(childId) as {
      execution_engine: string | null;
      model_lane: string;
    };
    assert.strictEqual(child.execution_engine, "hiverunner");
    assert.strictEqual(child.model_lane, "deep");
  });

  await test("legacy manual execution engine does not override active hive dispatch", async () => {
    const task = createTask({
      projectId: project.id,
      title: "Manual engine fixture",
      description: "manual task",
      priority: "P3",
      type: "maintenance",
      status: "in-progress",
      labels: [],
      createdBy: "test",
    }).task;

    const updated = updateTask({
      taskId: task.id,
      executionEngine: "manual",
      actorUserId: "test",
    }).task;
    assert.strictEqual(updated.executionEngine, "manual");

    const execution = await triggerTaskExecution({
      taskId: task.id,
      reason: "manual_engine_test",
    });
    assert.strictEqual(execution.status, "skipped");
    assert.strictEqual(execution.reason, "assignee_required");
  });

  await test("failed Symphony execution run reports failed status and leaves a task comment", async () => {
    const agent = createProjectAgent({
      projectId: project.id,
      name: `Failure Probe ${Date.now()}`,
      emoji: "F",
      role: "Execution QA",
      personality: "Fails on purpose.",
      status: "idle",
      skills: [],
    }).agent;

    const task = createTask({
      projectId: project.id,
      title: "Failed Symphony run fixture",
      description: "failure visibility",
      priority: "P2",
      type: "maintenance",
      status: "in-progress",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
    }).task;

    const db = getOrchestrationDb();
    const runId = `failed-symphony-run-${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message, token_usage_json, duration_ms, idempotency_key, created_at, updated_at)
       VALUES
        (?, ?, ?, 'symphony', ?, 'failed', ?, ?, ?, '{}', 12, ?, ?, ?)`
    ).run(
      runId,
      task.id,
      agent.id,
      "fixture-session",
      now,
      now,
      "Intentional fixture failure",
      `fixture:${runId}`,
      now,
      now,
    );

    const result = await pollTaskExecutionStatus(task.id);
    assert.strictEqual(result.mode, "symphony");
    assert.strictEqual(result.status.state, "failed");
    assert.strictEqual(result.status.raw, "failed");
    assert.strictEqual(result.transition.changed, true);
    assert.strictEqual(result.transition.to, "blocked");
    assert.strictEqual(result.task.status, "blocked");
    assert.match(result.task.blockedReason ?? "", /External runner execution failed: Intentional fixture failure/);

    const comments = getTask(task.id).task.comments ?? [];
    assert.ok(
      comments.some((comment) => comment.text.includes("External runner execution failed.") && comment.text.includes("Intentional fixture failure")),
      "Expected failed Symphony execution to leave a useful task comment",
    );
    assert.ok(
      comments.some((comment) => comment.type === "comment" && comment.text.includes("External runner execution failed.")),
      "Expected failed Symphony execution comment to be operator-facing",
    );
  });

  await test("no-op resubmission failure stays in progress with harness warning", async () => {
    const agent = createProjectAgent({
      projectId: project.id,
      name: `No Op Probe ${Date.now()}`,
      emoji: "N",
      role: "Execution QA",
      personality: "Resubmits unchanged work.",
      status: "idle",
      skills: [],
    }).agent;

    const task = createTask({
      projectId: project.id,
      title: "No-op resubmission fixture",
      description: "rework visibility",
      priority: "P2",
      type: "maintenance",
      status: "in-progress",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
      executionEngine: "symphony",
    }).task;

    const db = getOrchestrationDb();
    const runId = `no-op-symphony-run-${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message, token_usage_json, duration_ms, idempotency_key, created_at, updated_at)
       VALUES
        (?, ?, ?, 'symphony', ?, 'failed', ?, ?, 'no_op_resubmission', '{}', 12, ?, ?, ?)`,
    ).run(
      runId,
      task.id,
      agent.id,
      "fixture-session",
      now,
      now,
      `fixture:${runId}`,
      now,
      now,
    );

    const result = await pollTaskExecutionStatus(task.id);
    assert.strictEqual(result.mode, "symphony");
    assert.strictEqual(result.status.state, "failed");
    assert.strictEqual(result.transition.changed, false);
    assert.strictEqual(result.transition.skipped, true);
    assert.strictEqual(result.transition.skipReason, "no_op_resubmission_left_in_progress");
    assert.strictEqual(result.task.status, "in-progress");
    assert.strictEqual(result.task.blockedReason, undefined);

    const comments = getTask(task.id).task.comments ?? [];
    assert.ok(
      comments.some((comment) => comment.text.includes("[HARNESS_WARNING]") && comment.text.includes("no_op_resubmission")),
      "Expected no-op resubmission to leave an operator-visible harness warning",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
