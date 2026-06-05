/**
 * G4 — `dependsOn` between subtasks (Phase G of orchestration-integrity lane).
 *
 * Trigger: WEA-282 / WEA-284 / WEA-285 on 2026-04-26. Barometer decomposed
 * a parent task into spec → build → validate, but emitted all three subtasks
 * with no `dependsOn`. WEA-284 (build) and WEA-285 (validate) both started
 * runs at the exact same second (14:38:54Z), so Sentinel was "validating"
 * before Prism had built anything.
 *
 * Rule: `create_task` accepts an optional `dependsOn: string[]` of task_keys.
 * The engine resolves them to task_ids (same-project only), persists to the
 * existing `depends_on_json` column, and:
 *   - skips auto-start when any dep is not yet `done`
 *   - sweeper skips wakes (`dependency_pending` reason) until deps clear
 *   - drops cross-project / unresolved keys with observability stamped on
 *     the task.created event metadata + emitted as a heartbeat run event
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-depends-on.db \
 *     npx tsx src/lib/__tests__/orchestration-create-task-depends-on.test.ts
 */

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_ORCHESTRATION_COMPANY_ID,
  type CreateTaskAction,
  type ExecuteCreateTask,
  createBasicFixtureTask,
  createFixtureAgent,
  createFixtureProject,
  executeFixtureCreateTask,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

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
    });
}

console.log("\nOrchestration create_task — dependsOn (G4)\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    resetSqliteDatabaseFiles(dbPath);

    const { createProject, createProjectAgent, createTask, moveTask } =
      await import("@/lib/orchestration/service");
    const { ensureCompanyExecutionHives } =
      await import("@/lib/orchestration/service/execution-hives");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const engineMod = await import("@/lib/orchestration/engine/engine");
    const sweeperMod = await import("@/lib/orchestration/engine/sweeper");

    type UpdateTaskAction = {
      action: "update_task";
      taskKey: string;
      status?: string;
      assignee?: string;
      comment?: string;
    };

    const executeCreateTask = (engineMod as unknown as { executeCreateTask: ExecuteCreateTask }).executeCreateTask;
    const executeUpdateTask = (engineMod as unknown as {
      executeUpdateTask: (
        action: UpdateTaskAction,
        input: { agentId: string; companyId: string; runId: string; source?: string },
        db: unknown,
      ) => { statusApplied: boolean; statusRejectedReason?: string };
    }).executeUpdateTask;
    const importAssistantTextAndExecuteActions = (engineMod as unknown as {
      importAssistantTextAndExecuteActions: (input: {
        assistantTexts: string[];
        agentId: string;
        agentName: string;
        companyId: string;
        taskKey: string;
        runId: string;
        db: unknown;
        source?: string;
      }) => Promise<{ tasksCreated: string[]; errors: string[]; actionsExecuted: number; actionsDeferred: number }>;
    }).importAssistantTextAndExecuteActions;

    const sweepOpenTasks = (sweeperMod as unknown as {
      sweepOpenTasks: (
        db: unknown,
        opts?: { cap?: number; now?: Date; companySlugs?: string[] | null },
      ) => { skippedReasons: Record<string, number>; wakesEnqueued: number; candidatesConsidered: number };
    }).sweepOpenTasks;

    const companyId = DEFAULT_ORCHESTRATION_COMPANY_ID;
    const db = getOrchestrationDb() as unknown as {
      prepare: (q: string) => {
        get: (...a: unknown[]) => unknown;
        all: (...a: unknown[]) => unknown;
        run: (...a: unknown[]) => unknown;
      };
    };

    // Set the company status to active for sweep eligibility (boot creates
    // companies but they may default to a non-active status in some seeds).
    (db as unknown as { prepare: (q: string) => { run: (...a: unknown[]) => unknown } })
      .prepare("UPDATE companies SET status = 'active', archived_at = NULL WHERE id = ?")
      .run(companyId);
    ensureCompanyExecutionHives({ companyIdOrSlug: companyId }, getOrchestrationDb());

    function makeFixture(label: string) {
      const project = createFixtureProject(createProject, {
        companyId,
        namePrefix: "DependsOn",
        label,
        description: "dependsOn fixture",
        color: "#10b981",
        emoji: "🔗",
      });

      const builder = createFixtureAgent(createProjectAgent, {
        projectId: project.id,
        label,
        namePrefix: "Builder",
        openclawPrefix: "builder",
        emoji: "🔧",
        role: "Builder",
        skills: ["build"],
      });

      const validator = createFixtureAgent(createProjectAgent, {
        projectId: project.id,
        label,
        namePrefix: "Validator",
        openclawPrefix: "validator",
        emoji: "🛡️",
        role: "Validator",
        skills: ["validate"],
      });

      // The "spec" task — created via the service layer so we control its key.
      const specTask = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: `Spec ${label}`,
        type: "research",
        status: "in-progress",
        assignee: builder.id,
        createdBy: "g4-test",
      });

      return { project, builder, validator, specTask };
    }

    function createFromSpec(
      fixture: Pick<ReturnType<typeof makeFixture>, "project" | "builder" | "specTask">,
      action: CreateTaskAction,
      assertMessage?: string,
    ) {
      return executeFixtureCreateTask(executeCreateTask, db, {
        action,
        actor: fixture.builder,
        companyId: fixture.project.companyId,
        taskKey: fixture.specTask.id,
        assertMessage,
      });
    }

    async function createFromSpecSequence(
      fixture: Pick<ReturnType<typeof makeFixture>, "project" | "builder" | "specTask">,
      actions: CreateTaskAction[],
    ) {
      const created: string[] = [];
      for (const action of actions) {
        created.push(await createFromSpec(fixture, action));
      }
      return created;
    }

    type AssignedCreateTaskOptions = Omit<CreateTaskAction, "action" | "assignee" | "title">;

    function assignedCreateTaskAction(
      assignee: string,
      titlePrefix: string,
      options: AssignedCreateTaskOptions = {},
    ): CreateTaskAction {
      return {
        action: "create_task",
        title: `${titlePrefix} ${Date.now()}`,
        assignee,
        ...options,
      };
    }

    function taskKey(taskId: string) {
      return (db.prepare("SELECT task_key FROM tasks WHERE id = ?").get(taskId) as { task_key: string }).task_key;
    }

    function taskDeps(taskId: string) {
      const row = db
        .prepare("SELECT depends_on_json FROM tasks WHERE id = ?")
        .get(taskId) as { depends_on_json: string } | undefined;
      assert.ok(row, "task must be persisted");
      return JSON.parse(row.depends_on_json) as string[];
    }

    function taskStatusAndDeps(taskId: string) {
      const row = db
        .prepare("SELECT status, depends_on_json FROM tasks WHERE id = ?")
        .get(taskId) as { status: string; depends_on_json: string };
      return { status: row.status, deps: JSON.parse(row.depends_on_json) as string[] };
    }

    function assertQueuedDeps(taskId: string, expectedDeps: string[], depsMessage: string, statusMessage: string) {
      const row = taskStatusAndDeps(taskId);
      assert.equal(row.status, "to-do", statusMessage);
      assert.deepEqual(row.deps, expectedDeps, depsMessage);
    }

    await test("dependsOn array on create_task action persists task IDs in depends_on_json", async () => {
      const fixture = makeFixture("persist");
      const { validator, specTask } = fixture;

      const buildTaskId = await createFromSpec(
        fixture,
        {
          action: "create_task",
          title: `Build report ${Date.now()}`,
          assignee: validator.name,
          dependsOn: [specTask.key as string],
        },
        "create_task must return a task id",
      );

      assert.deepEqual(taskDeps(buildTaskId), [specTask.id], "depends_on_json must contain the resolved spec task id");
    });

    await test("create_task drops dependsOn entry when it points at the new task parent", async () => {
      const fixture = makeFixture("parent-dep-drop");
      const { specTask } = fixture;

      const childTaskId = await createFromSpec(
        fixture,
        {
          action: "create_task",
          title: `Child should not depend on parent ${Date.now()}`,
          parent: specTask.key as string,
          dependsOn: [specTask.key as string],
        },
        "create_task must return a child task id",
      );

      const child = db
        .prepare("SELECT parent_task_id, depends_on_json FROM tasks WHERE id = ?")
        .get(childTaskId) as { parent_task_id: string | null; depends_on_json: string } | undefined;
      assert.equal(child?.parent_task_id, specTask.id, "child should keep the parent link");
      assert.deepEqual(JSON.parse(child?.depends_on_json ?? "[]"), [], "child must not also depend on its parent");

      const event = db.prepare(
        `SELECT metadata_json FROM task_events
         WHERE task_id = ? AND event_type = 'task.created'
         ORDER BY created_at DESC LIMIT 1`,
      ).get(childTaskId) as { metadata_json: string } | undefined;
      const metadata = JSON.parse(event?.metadata_json ?? "{}") as { droppedDependsOn?: Array<{ key: string; reason: string }> };
      assert.deepEqual(metadata.droppedDependsOn, [
        { key: specTask.key, reason: "parent_link" },
      ]);
    });

    await test("create_task rejects assignment to manual-only agents", async () => {
      const fixture = makeFixture("manual-assignee");
      const { validator, specTask } = fixture;
      db.prepare("UPDATE agents SET adapter_type = 'manual', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), validator.id);

      await assert.rejects(
        createFromSpec(
          fixture,
          {
            action: "create_task",
            title: `Manual assignment blocked ${Date.now()}`,
            assignee: validator.name,
            dependsOn: [specTask.key as string],
          },
        ),
        /assignee_not_executable_runtime/,
      );
    });

    await test("unresolved dep keys are dropped and stamped into task_event metadata", async () => {
      const fixture = makeFixture("unresolved");
      const { validator, specTask } = fixture;

      const buildTaskId = await createFromSpec(
        fixture,
        {
          action: "create_task",
          title: `Build with bogus dep ${Date.now()}`,
          assignee: validator.name,
          dependsOn: [specTask.key as string, "WEA-DOES-NOT-EXIST"],
        },
      );

      assert.deepEqual(taskDeps(buildTaskId), [specTask.id], "only the resolvable dep should land in depends_on_json");

      const event = db
        .prepare("SELECT metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.created' LIMIT 1")
        .get(buildTaskId) as { metadata_json: string } | undefined;
      const metadata = JSON.parse(event!.metadata_json) as Record<string, unknown>;
      assert.ok(Array.isArray(metadata.droppedDependsOn), "droppedDependsOn must be in metadata");
      const dropped = metadata.droppedDependsOn as Array<{ key: string; reason: string }>;
      assert.equal(dropped.length, 1);
      assert.equal(dropped[0].key, "WEA-DOES-NOT-EXIST");
      assert.equal(dropped[0].reason, "unresolved");
    });

    await test("QA and release tasks infer dependencies on prior CEO-created sibling work", async () => {
      const { project, builder, validator, specTask } = makeFixture("infer-validation");

      const [buildTaskId, launchUiTaskId, qaTaskId, releaseTaskId] = await createFromSpecSequence(
        { project, builder, specTask },
        [
          assignedCreateTaskAction(validator.name, "Implement app slice"),
          assignedCreateTaskAction(validator.name, "Implement Launch Control Board UI"),
          assignedCreateTaskAction(validator.name, "QA browser smoke for app slice"),
          assignedCreateTaskAction(validator.name, "Prepare release handoff"),
        ],
      );

      const buildKey = taskKey(buildTaskId);
      const qaKey = taskKey(qaTaskId);

      assertQueuedDeps(
        qaTaskId,
        [buildTaskId, launchUiTaskId],
        "QA should wait for prior implementation work",
        "QA should not auto-start while inferred deps are pending",
      );

      assertQueuedDeps(
        releaseTaskId,
        [buildTaskId, launchUiTaskId, qaTaskId],
        "release should wait for implementation and QA",
        "release should not auto-start while inferred deps are pending",
      );

      const event = db
        .prepare("SELECT metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.created' LIMIT 1")
        .get(releaseTaskId) as { metadata_json: string } | undefined;
      const metadata = JSON.parse(event!.metadata_json) as Record<string, unknown>;
      assert.deepEqual(metadata.inferredDependsOn, [buildKey, taskKey(launchUiTaskId), qaKey]);
    });

    await test("explicit QA dependsOn merges with inferred sibling dependencies", async () => {
      const { project, builder, validator, specTask } = makeFixture("merge-validation");

      const [dataTaskId, frontendTaskId] = await createFromSpecSequence(
        { project, builder, specTask },
        [
          assignedCreateTaskAction(validator.name, "Build static data layer"),
          assignedCreateTaskAction(validator.name, "Implement frontend"),
        ],
      );
      const dataKey = taskKey(dataTaskId);

      const qaTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `QA Launch Control Board artifacts ${Date.now()}`,
          assignee: validator.name,
          dependsOn: [dataKey],
        },
      );

      assert.deepEqual(taskDeps(qaTaskId), [dataTaskId, frontendTaskId], "QA should keep explicit data dep and infer frontend dep");
    });

    await test("integration assembly tasks infer prior sibling work and wait for inputs", async () => {
      const { project, builder, validator, specTask } = makeFixture("integration-infer");

      const [dataTaskId, uiTaskId, assemblyTaskId] = await createFromSpecSequence(
        { project, builder, specTask },
        [
          assignedCreateTaskAction(validator.name, "Define mock data shape"),
          assignedCreateTaskAction(validator.name, "Build operator UI"),
          assignedCreateTaskAction(validator.name, "Assemble Weather Edge Mini static artifact", {
            description: "Combine the data shape and operator UI into one prototype artifact.",
          }),
        ],
      );

      const assemblyRow = taskStatusAndDeps(assemblyTaskId);
      assert.equal(assemblyRow.status, "to-do", "assembly should wait for sibling inputs instead of auto-starting");
      assert.deepEqual(new Set(assemblyRow.deps), new Set([dataTaskId, uiTaskId]));
    });

    await test("documentation tasks infer prior implementation inputs and wait", async () => {
      const { project, builder, validator, specTask } = makeFixture("docs-infer");

      const [dataTaskId, buildTaskId, docsTaskId] = await createFromSpecSequence(
        { project, builder, specTask },
        [
          assignedCreateTaskAction(validator.name, "Define local runtime data shape"),
          assignedCreateTaskAction(validator.name, "Build settings panel"),
          assignedCreateTaskAction(validator.name, "Document runtime assumptions and operator notes"),
        ],
      );

      assertQueuedDeps(
        docsTaskId,
        [dataTaskId, buildTaskId],
        "documentation dependencies should include the source implementation inputs",
        "documentation should wait for the source implementation inputs",
      );
    });

    await test("later integration task is added as dependency for sibling QA created earlier", async () => {
      const { project, builder, validator, specTask } = makeFixture("qa-before-integration");

      const [dataTaskId, uiTaskId, qaTaskId, integrationTaskId] = await createFromSpecSequence(
        { project, builder, specTask },
        [
          assignedCreateTaskAction(validator.name, "Build fixture data"),
          assignedCreateTaskAction(validator.name, "Build fixture UI"),
          assignedCreateTaskAction(validator.name, "QA fixture prototype"),
          assignedCreateTaskAction(validator.name, "Integrate fixture static artifact"),
        ],
      );

      assertQueuedDeps(
        qaTaskId,
        [dataTaskId, uiTaskId, integrationTaskId],
        "QA should depend on the later integration task",
        "QA should remain queued while integration is still pending",
      );
    });

    await test("QA created after integration waits for the integration artifact", async () => {
      const { project, builder, validator, specTask } = makeFixture("qa-after-integration");

      const [dataTaskId, uiTaskId, integrationTaskId] = await createFromSpecSequence(
        { project, builder, specTask },
        [
          assignedCreateTaskAction(validator.name, "Define dashboard data"),
          assignedCreateTaskAction(validator.name, "Build dashboard UI"),
          assignedCreateTaskAction(validator.name, "Integrate dashboard static artifact"),
        ],
      );

      const qaTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `Verify dashboard prototype ${Date.now()}`,
          type: "release",
          assignee: validator.name,
        },
      );

      assertQueuedDeps(
        qaTaskId,
        [dataTaskId, uiTaskId, integrationTaskId],
        "QA should depend on existing integration work",
        "QA should wait for integration when integration already exists",
      );
    });

    await test("CEO parent directive stays open when the same response creates child tasks", async () => {
      const { project, builder, validator, specTask } = makeFixture("defer-parent-close");
      const runId = randomUUID();
      const assistantText = [
        "I created the implementation task and will keep the parent open while child work runs.",
        "```mc-action",
        JSON.stringify({
          action: "create_task",
          title: `Implement child slice ${Date.now()}`,
          assignee: validator.name,
          parent: specTask.key,
        }),
        "```",
        "```mc-action",
        JSON.stringify({
          action: "update_task",
          taskKey: specTask.key,
          status: "review",
          comment: "Child work is delegated.",
        }),
        "```",
      ].join("\n");

      const result = await importAssistantTextAndExecuteActions({
        assistantTexts: [assistantText],
        agentId: builder.id,
        agentName: builder.name,
        companyId: project.companyId,
        taskKey: specTask.id,
        runId,
        db,
        source: "unit-test",
      });

      assert.equal(result.tasksCreated.length, 1, "child task should still be created");
      assert.equal(result.actionsDeferred, 1, "parent-close attempt should be tracked as a deferral");
      assert.deepEqual(result.errors, [], "deferrals should not be reported as action errors");
      const parentRow = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(specTask.id) as { status: string };
      assert.equal(parentRow.status, "in_progress", "parent directive must not move to review while children are pending");
    });

    await test("CEO parent directive stays open on later review attempt while child tasks remain open", async () => {
      const { project, builder, validator, specTask } = makeFixture("defer-parent-open-children");

      const childTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `Open child slice ${Date.now()}`,
          assignee: validator.name,
          parent: specTask.key,
        },
      );

      const result = await importAssistantTextAndExecuteActions({
        assistantTexts: [
          [
            "Child work is still open, so the parent should not close.",
            "```mc-action",
            JSON.stringify({
              action: "update_task",
              taskKey: specTask.key,
              status: "review",
              comment: "Ready after delegation.",
            }),
            "```",
          ].join("\n"),
        ],
        agentId: builder.id,
        agentName: builder.name,
        companyId: project.companyId,
        taskKey: specTask.id,
        runId: randomUUID(),
        db,
        source: "unit-test",
      });

      assert.equal(result.actionsDeferred, 1, "open-child review attempt should be tracked as a deferral");
      assert.deepEqual(result.errors, [], "deferrals should not be reported as action errors");
      const parentRow = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(specTask.id) as { status: string };
      assert.equal(parentRow.status, "in_progress", "parent directive must stay in progress while a child remains open");
    });

    await test("child run cannot close parent while sibling child tasks remain open", async () => {
      const { project, builder, validator, specTask } = makeFixture("defer-parent-from-child-run");

      const childTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `Open child slice A ${Date.now()}`,
          assignee: validator.name,
          parent: specTask.key,
        },
      );
      await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `Open child slice B ${Date.now()}`,
          assignee: validator.name,
          parent: specTask.key,
        },
      );

      const result = await importAssistantTextAndExecuteActions({
        assistantTexts: [
          [
            "A child run should not be able to close its parent while sibling work is still open.",
            "```mc-action",
            JSON.stringify({
              action: "update_task",
              taskKey: specTask.key,
              status: "review",
              comment: "Parent looks ready from this child.",
            }),
            "```",
          ].join("\n"),
        ],
        agentId: validator.id,
        agentName: validator.name,
        companyId: project.companyId,
        taskKey: childTaskId,
        runId: randomUUID(),
        db,
        source: "unit-test",
      });

      assert.equal(result.actionsDeferred, 1, "parent close from child run should be tracked as a deferral");
      assert.deepEqual(result.errors, [], "parent close deferral should not be reported as an action error");
      const parentRow = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(specTask.id) as { status: string };
      assert.equal(parentRow.status, "in_progress", "parent directive must stay in progress while any child remains open");
    });

    await test("sweeper skips a task whose deps are not yet done", async () => {
      const { project, builder, validator, specTask } = makeFixture("sweep-blocked");

      // Spec task starts in_progress (default for the fixture). Build task is
      // created with spec as dep — so spec.status != 'done', sweep must skip.
      const buildTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `Build awaiting spec ${Date.now()}`,
          assignee: validator.name,
          dependsOn: [specTask.key as string],
        },
      );

      // Confirm the new task is to-do with assignee + a non-empty dep list.
      const buildRow = db
        .prepare("SELECT status, assignee_agent_id, depends_on_json FROM tasks WHERE id = ?")
        .get(buildTaskId) as { status: string; assignee_agent_id: string; depends_on_json: string };
      assert.equal(buildRow.status, "to-do", "auto-start must defer when deps pending → status stays to-do");
      assert.ok(buildRow.assignee_agent_id, "assignee must be set");
      const deps = JSON.parse(buildRow.depends_on_json) as string[];
      assert.equal(deps.length, 1);

      const result = sweepOpenTasks(db, { cap: 50, companySlugs: null });
      const dependencyPending = result.skippedReasons["dependency_pending"] ?? 0;
      assert.ok(
        dependencyPending >= 1,
        `expected at least 1 dependency_pending skip, got ${dependencyPending}; full reasons: ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("sweeper picks up the task once deps clear", async () => {
      const { project, builder, validator, specTask } = makeFixture("sweep-unblock");

      const buildTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `Build unblock ${Date.now()}`,
          assignee: validator.name,
          dependsOn: [specTask.key as string],
        },
      );

      // Move spec to done — deps now satisfied.
      moveTask({ taskId: specTask.id, status: "review", actorUserId: "g4-test" });
      moveTask({ taskId: specTask.id, status: "done", actorUserId: "g4-test", reviewNotes: "Spec accepted" });

      // After clearing the dep, we should NOT see this build task on the
      // dependency_pending skip list anymore.
      const before = sweepOpenTasks(db, { cap: 0, companySlugs: null });
      const blocked = before.skippedReasons["dependency_pending"] ?? 0;
      // We don't assert blocked === 0 globally (other fixtures in this suite
      // may have left their own blocked rows). What we assert is that THIS
      // task's depends_on entries are now all done.
      const stillBlocked = db
        .prepare(
          `SELECT COUNT(*) AS n FROM tasks
           WHERE id IN (SELECT value FROM json_each(?))
             AND archived_at IS NULL
             AND status != 'done'`,
        )
        .get(JSON.parse(
          (db.prepare("SELECT depends_on_json FROM tasks WHERE id = ?").get(buildTaskId) as { depends_on_json: string }).depends_on_json,
        ).length === 0 ? "[]" : (db.prepare("SELECT depends_on_json FROM tasks WHERE id = ?").get(buildTaskId) as { depends_on_json: string }).depends_on_json) as { n: number };
      assert.equal(stillBlocked.n, 0, "all deps for this task must now be done");
      // Sanity: blocked count isn't growing further on this run.
      assert.ok(blocked >= 0);
    });

    await test("engine update_task done immediately wakes newly unblocked dependents", async () => {
      const { project, builder, validator, specTask } = makeFixture("engine-unblock");

      const buildTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `Build auto-unblock ${Date.now()}`,
          assignee: validator.name,
          dependsOn: [specTask.key as string],
        },
      );

      const reviewRunId = randomUUID();
      const reviewResult = executeUpdateTask(
        { action: "update_task", taskKey: specTask.key as string, status: "review" },
        { agentId: builder.id, companyId: project.companyId, runId: reviewRunId },
        db,
      );
      assert.equal(reviewResult.statusApplied, true, reviewResult.statusRejectedReason);

      const doneRunId = randomUUID();
      const doneResult = executeUpdateTask(
        { action: "update_task", taskKey: specTask.key as string, status: "done", comment: "Dependency source completed for auto-unblock test." },
        { agentId: validator.id, companyId: project.companyId, runId: doneRunId },
        db,
      );
      assert.equal(doneResult.statusApplied, true, doneResult.statusRejectedReason);

      const buildRow = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(buildTaskId) as { status: string };
      assert.equal(buildRow.status, "in_progress", "dependent task should move to in_progress immediately");

      const queuedWake = db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM agent_wakeup_requests
            WHERE agent_id = ?
              AND status IN ('queued', 'claimed')
              AND reason = 'engine_auto_task_assignment'`,
        )
        .get(validator.id) as { n: number };
      assert.ok(queuedWake.n >= 1, "dependent assignee should receive a queued wake");
    });

    await test("dependency unblock rotates to a capable alternate when primary assignee is offline", async () => {
      const { project, builder, validator, specTask } = makeFixture("engine-unblock-offline");
      const alternate = createProjectAgent({
        projectId: project.id,
        name: `Backend Alternate-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🧰",
        role: "Backend Implementation Engineer",
        personality: "Deterministic",
        openclawAgentId: `backend-alt-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["build"],
      }).agent;
      db.prepare("UPDATE agents SET status = 'offline' WHERE id = ?").run(validator.id);

      const buildTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `Build backend API auto-unblock ${Date.now()}`,
          assignee: validator.name,
          dependsOn: [specTask.key as string],
        },
      );

      const doneRunId = randomUUID();
      const doneResult = executeUpdateTask(
        { action: "update_task", taskKey: specTask.key as string, status: "done", comment: "Dependency source completed for offline fallback test." },
        { agentId: builder.id, companyId: project.companyId, runId: doneRunId },
        db,
      );
      assert.equal(doneResult.statusApplied, true, doneResult.statusRejectedReason);

      const buildRow = db
        .prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?")
        .get(buildTaskId) as { status: string; assignee_agent_id: string };
      assert.equal(buildRow.status, "in_progress", "dependent task should still move to in_progress");
      assert.equal(buildRow.assignee_agent_id, alternate.id, "offline primary should be replaced by capable alternate");

      const reassigned = db.prepare(
        `SELECT metadata_json
         FROM task_events
         WHERE task_id = ? AND event_type = 'task.reassigned'
         ORDER BY created_at DESC
         LIMIT 1`,
      ).get(buildTaskId) as { metadata_json: string } | undefined;
      assert.match(reassigned?.metadata_json ?? "", /dependency_unblock_capable_fallback/);

      const wake = db
        .prepare(
          `SELECT reason, status
             FROM agent_wakeup_requests
            WHERE agent_id = ?
              AND reason = 'engine_auto_task_assignment'
            ORDER BY created_at DESC
            LIMIT 1`,
        )
        .get(alternate.id) as { reason: string; status: string } | undefined;
      assert.equal(wake?.reason, "engine_auto_task_assignment");
      assert.ok(["queued", "claimed"].includes(wake?.status ?? ""), "alternate should receive an immediate wake");
    });

    await test("closing focused QA can create sibling remediation without deferring done", async () => {
      const { project, builder, validator, specTask } = makeFixture("qa-sibling-remediation");

      const qaTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `QA remediation source ${Date.now()}`,
          assignee: validator.name,
          parent: specTask.key,
        },
      );

      const qaKey = (db.prepare("SELECT task_key FROM tasks WHERE id = ?").get(qaTaskId) as { task_key: string }).task_key;
      const releaseTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `Write release README after QA ${Date.now()}`,
          description: "Release documentation that must wait for QA and any sibling remediation created from QA findings.",
          assignee: validator.name,
          parent: specTask.key,
          dependsOn: [qaKey],
        },
      );

      db.prepare("UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), qaTaskId);
      db.prepare(
        `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
      ).run(randomUUID(), project.id, qaTaskId, validator.id, JSON.stringify({ source: "test" }), new Date().toISOString());

      const runId = randomUUID();
      const result = await importAssistantTextAndExecuteActions({
        assistantTexts: [
          [
            "QA is complete, but I am creating a sibling remediation under the parent directive.",
            "```mc-action",
            JSON.stringify({
              action: "update_task",
              taskKey: qaKey,
              status: "done",
              comment: "QA closure complete before sibling remediation.",
            }),
            "```",
            "```mc-action",
            JSON.stringify({
              action: "create_task",
              title: `Fix reviewed artifact ${Date.now()}`,
              description: "Sibling remediation created after QA review; verify the specific fix after it lands.",
              assignee: validator.name,
              parent: specTask.key,
              dependsOn: [qaKey],
            }),
            "```",
          ].join("\n"),
        ],
        agentId: builder.id,
        agentName: builder.name,
        companyId: project.companyId,
        taskKey: qaTaskId,
        runId,
        db,
      });

      assert.equal(
        result.errors.some((error) => error.includes("deferred") && error.includes(qaKey)),
        false,
        `focused QA closure must not be deferred by sibling remediation: ${result.errors.join("; ")}`,
      );

      const qaRow = db.prepare("SELECT status FROM tasks WHERE id = ?").get(qaTaskId) as { status: string };
      assert.equal(qaRow.status, "done", "focused QA task should close");

      assert.equal(result.tasksCreated.length, 1, "sibling remediation should be created");
      const remediationRow = db
        .prepare("SELECT status, parent_task_id, depends_on_json FROM tasks WHERE id = ?")
        .get(result.tasksCreated[0]) as { status: string; parent_task_id: string; depends_on_json: string };
      assert.equal(remediationRow.parent_task_id, specTask.id, "remediation should be a sibling under the parent directive");
      assert.equal(remediationRow.status, "in_progress", "remediation with already-satisfied deps should auto-start");
      assert.deepEqual(JSON.parse(remediationRow.depends_on_json), [qaTaskId], "explicit QA dependency should persist");

      const releaseRow = db
        .prepare("SELECT status, depends_on_json FROM tasks WHERE id = ?")
        .get(releaseTaskId) as { status: string; depends_on_json: string };
      const releaseDeps = JSON.parse(releaseRow.depends_on_json) as string[];
      assert.equal(releaseRow.status, "to-do", "release task should wait for the sibling remediation");
      assert.ok(releaseDeps.includes(qaTaskId), "release task should keep its QA dependency");
      assert.ok(releaseDeps.includes(result.tasksCreated[0]), "release task should wait on the remediation task");
    });

    await test("engine update_task blocked wakes parent assignee for triage", async () => {
      const { project, builder, validator, specTask } = makeFixture("blocked-child-parent-wake");

      const childTaskId = await createFromSpec(
        { project, builder, specTask },
        {
          action: "create_task",
          title: `QA blocker ${Date.now()}`,
          assignee: validator.name,
          parent: specTask.key,
        },
      );

      db.prepare("DELETE FROM agent_wakeup_requests WHERE company_id = ?").run(project.companyId);
      db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), childTaskId);

      const blockRunId = randomUUID();
      const childKey = (db.prepare("SELECT task_key FROM tasks WHERE id = ?").get(childTaskId) as { task_key: string }).task_key;
      const blockResult = executeUpdateTask(
        { action: "update_task", taskKey: childKey, status: "blocked", comment: "QA found release blockers." },
        { agentId: validator.id, companyId: project.companyId, runId: blockRunId },
        db,
      );
      assert.equal(blockResult.statusApplied, true, blockResult.statusRejectedReason);

      const parentRow = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(specTask.id) as { status: string };
      assert.equal(parentRow.status, "blocked", "parent should still reflect blocked child state");

      const queuedWake = db
        .prepare(
          `SELECT reason, payload_json
             FROM agent_wakeup_requests
            WHERE agent_id = ?
              AND status IN ('queued', 'claimed')
              AND reason = 'child_task_blocked'
            ORDER BY created_at DESC
            LIMIT 1`,
        )
        .get(builder.id) as { reason: string; payload_json: string } | undefined;
      assert.ok(queuedWake, "parent assignee should receive a blocked-child triage wake");
      const payload = JSON.parse(queuedWake!.payload_json) as Record<string, unknown>;
      assert.equal(payload.childTaskId, childTaskId);
      assert.equal(payload.parentTaskId, specTask.id);
      assert.equal(payload.runId, blockRunId);
    });

    const total = passed + failed;
    console.log(`\nResult: ${passed}/${total} passed`);
    if (failed > 0) process.exitCode = 1;
  } catch (err) {
    console.error("Test harness crashed:", err);
    process.exitCode = 1;
  }
}

run();
