import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  pass ${name}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  fail ${name}`);
    console.error(`    ${message}`);
  }
}

async function run() {
  console.log("\nHiveRunner Symphony Tracker Adapter Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-symphony-tracker-"));
  Object.assign(process.env, {
    ORCHESTRATION_DB_PATH: path.join(tempRoot, "orchestration.db"),
    MC_WORKSPACE_ROOT: path.join(tempRoot, "workspaces"),
    HIVERUNNER_APP_URL: "http://127.0.0.1:3010",
    NODE_ENV: "development",
  });

  try {
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
    const {
      createProject,
      createProjectAgent,
      createTask,
      getTask,
      listTaskComments,
      updateProjectSettings,
    } = await import("@/lib/orchestration/service");
    const {
      createHiveRunnerSymphonyTracker,
      normalizeSymphonyTrackerState,
    } = await import("@/lib/orchestration/symphony/tracker-adapter");

    const company = createCompany({
      name: "Symphony Tracker Co",
      description: "Tracker adapter fixture.",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Symphony Tracker Project",
      description: "Fixture project.",
      color: "#0ea5e9",
      emoji: "S",
      status: "active",
    }).project;
    updateProjectSettings({
      projectIdOrSlug: project.id,
      defaultExecutionEngine: "symphony",
    });
    const agent = createProjectAgent({
      projectId: project.id,
      name: "Tracker Worker",
      emoji: "T",
      role: "Engineer",
      personality: "Runs Symphony tracker fixtures.",
      status: "idle",
      skills: [],
    }).agent;
    const otherAgent = createProjectAgent({
      projectId: project.id,
      name: "Other Tracker Worker",
      emoji: "O",
      role: "Engineer",
      personality: "Owns a different Symphony tracker fixture.",
      status: "idle",
      skills: [],
    }).agent;

    const candidate = createTask({
      projectId: project.id,
      title: "Symphony tracker candidate",
      description: "Exercise the upstream-compatible tracker adapter.",
      priority: "P1",
      type: "feature",
      status: "to-do",
      assignee: agent.id,
      labels: ["symphony", "tracker"],
      createdBy: "test",
    }).task;
    const dependency = createTask({
      projectId: project.id,
      title: "Dependency task",
      description: "Blocks the candidate.",
      priority: "P2",
      type: "research",
      status: "blocked",
      labels: ["dependency"],
      createdBy: "test",
      executionEngine: "manual",
    }).task;
    createTask({
      projectId: project.id,
      title: "HiveRunner-only task",
      description: "Should not be fetched by the Symphony tracker.",
      priority: "P2",
      type: "maintenance",
      status: "to-do",
      labels: ["hiverunner"],
      createdBy: "test",
      executionEngine: "hiverunner",
    });
    const otherWorkerTask = createTask({
      projectId: project.id,
      title: "Other worker Symphony task",
      description: "Should only be visible when refreshing explicit issue state.",
      priority: "P1",
      type: "feature",
      status: "to-do",
      assignee: otherAgent.id,
      labels: ["symphony", "other-worker"],
      createdBy: "test",
    }).task;
    const doneTask = createTask({
      projectId: project.id,
      title: "Completed Symphony task",
      description: "Used for state fetch coverage.",
      priority: "P3",
      type: "feature",
      status: "done",
      labels: ["symphony"],
      createdBy: "test",
    }).task;

    const db = getOrchestrationDb();
    db.prepare("UPDATE tasks SET depends_on_json = ? WHERE id = ?").run(JSON.stringify([dependency.key ?? dependency.id]), candidate.id);

    const tracker = createHiveRunnerSymphonyTracker({
      companyIdOrSlug: company.id,
      projectIdOrSlug: project.slug,
      workerAgentIds: [agent.id],
      actorUserId: "symphony:test",
    });

    test("normalizes upstream-style state names into HiveRunner statuses", () => {
      assert.strictEqual(normalizeSymphonyTrackerState("Todo"), "to-do");
      assert.strictEqual(normalizeSymphonyTrackerState("In Progress"), "in_progress");
      assert.strictEqual(normalizeSymphonyTrackerState("Human Review"), "review");
      assert.strictEqual(normalizeSymphonyTrackerState("Closed"), "done");
      assert.strictEqual(normalizeSymphonyTrackerState("unknown"), null);
    });

    test("fetchCandidateIssues returns only Symphony-selected active HiveRunner tasks", () => {
      const issues = tracker.fetchCandidateIssues();
      assert.deepStrictEqual(issues.map((issue) => issue.identifier), [candidate.key]);
      const issue = issues[0]!;
      assert.strictEqual(issue.id, candidate.id);
      assert.strictEqual(issue.title, "Symphony tracker candidate");
      assert.strictEqual(issue.priority, 2);
      assert.strictEqual(issue.state, "to-do");
      assert.strictEqual(issue.assignee_id, agent.id);
      assert.deepStrictEqual(issue.labels, ["symphony", "tracker"]);
      assert.deepStrictEqual(issue.blocked_by, [{ identifier: dependency.key }]);
      assert.strictEqual(issue.assigned_to_worker, true);
      assert.strictEqual(issue.metadata.executionEngine, "symphony");
      assert.strictEqual(issue.metadata.company.id, company.id);
      assert.strictEqual(issue.metadata.project.id, project.id);
      assert.ok(issue.url?.includes(`/tasks/${encodeURIComponent(candidate.key!)}`));
    });

    test("fetchCandidateIssues excludes tasks already assigned to another worker", () => {
      const issues = tracker.fetchCandidateIssues();
      assert.ok(!issues.some((issue) => issue.identifier === otherWorkerTask.key));

      const allWorkersTracker = createHiveRunnerSymphonyTracker({
        companyIdOrSlug: company.id,
        projectIdOrSlug: project.slug,
        actorUserId: "symphony:test",
      });
      assert.ok(allWorkersTracker.fetchCandidateIssues().some((issue) => issue.identifier === otherWorkerTask.key));
    });

    test("fetchIssuesByStates supports Symphony/Linear-style state aliases", () => {
      const issues = tracker.fetchIssuesByStates(["Todo", "Done"]);
      assert.deepStrictEqual(
        issues.map((issue) => issue.identifier).sort(),
        [candidate.key, doneTask.key].sort(),
      );
    });

    test("fetchIssueStatesByIds returns refreshed issue state by id or key", () => {
      const issues = tracker.fetchIssueStatesByIds([candidate.id, doneTask.key!, otherWorkerTask.key!]);
      assert.deepStrictEqual(
        issues.map((issue) => issue.identifier).sort(),
        [candidate.key, doneTask.key, otherWorkerTask.key].sort(),
      );
      assert.strictEqual(
        issues.find((issue) => issue.identifier === otherWorkerTask.key)?.assigned_to_worker,
        false,
      );
    });

    test("createComment and updateIssueState write through to HiveRunner", () => {
      const comment = tracker.createComment(candidate.key!, "Symphony tracker comment.");
      assert.strictEqual(comment.taskId, candidate.id);
      const comments = listTaskComments(candidate.id).comments;
      assert.ok(comments.some((item) => item.id === comment.commentId && item.text === "Symphony tracker comment."));

      const updated = tracker.updateIssueState(candidate.id, "Human Review");
      assert.strictEqual(updated.state, "review");
      assert.strictEqual(getTask(candidate.id).task.status, "review");
    });

    closeOrchestrationDb();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
