import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let failed = 0;

type ShimResponse = {
  ok: boolean;
  operation?: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

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

async function runShim(
  input: unknown,
  env: Record<string, string | undefined>,
): Promise<{ status: number; response: ShimResponse }> {
  const { handleHiveRunnerSymphonyTrackerRequest } = await import("@/lib/orchestration/symphony/tracker-shim");
  const response = handleHiveRunnerSymphonyTrackerRequest(input, {
    ...process.env,
    ...env,
  }) as ShimResponse;
  return {
    status: response.ok ? 0 : 1,
    response,
  };
}

async function run() {
  console.log("\nHiveRunner Symphony Tracker Shim Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-symphony-tracker-shim-"));
  const env = {
    ORCHESTRATION_DB_PATH: path.join(tempRoot, "orchestration.db"),
    MC_WORKSPACE_ROOT: path.join(tempRoot, "workspaces"),
    HIVERUNNER_APP_URL: "http://127.0.0.1:3010",
    NODE_ENV: "development",
  };
  Object.assign(process.env, env);

  try {
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { closeOrchestrationDb } = await import("@/lib/orchestration/db");
    const {
      createProject,
      createProjectAgent,
      createTask,
      getTask,
      listTaskComments,
      updateProjectSettings,
    } = await import("@/lib/orchestration/service");

    const company = createCompany({
      name: "Symphony Tracker Shim Co",
      description: "Tracker shim fixture.",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Symphony Tracker Shim Project",
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
      name: "Shim Worker",
      emoji: "S",
      role: "Engineer",
      personality: "Runs Symphony tracker shim fixtures.",
      status: "idle",
      skills: [],
    }).agent;
    const task = createTask({
      projectId: project.id,
      title: "Symphony tracker shim candidate",
      description: "Exercise the stdio shim.",
      priority: "P1",
      type: "feature",
      status: "to-do",
      assignee: agent.id,
      labels: ["symphony", "shim"],
      createdBy: "test",
    }).task;
    createTask({
      projectId: project.id,
      title: "Manual shim control",
      description: "Should not be returned by the default Symphony shim.",
      priority: "P2",
      type: "maintenance",
      status: "to-do",
      labels: ["manual"],
      createdBy: "test",
      executionEngine: "manual",
    });

    closeOrchestrationDb();

    const options = {
      companyIdOrSlug: company.id,
      projectIdOrSlug: project.slug,
      actorUserId: "symphony:shim-test",
      workerAgentIds: [agent.id],
    };

    await test("health works while shim data access is disabled", async () => {
      const { status, response } = await runShim({ operation: "health" }, env);
      assert.strictEqual(status, 0);
      assert.strictEqual(response.ok, true);
      assert.strictEqual((response.result as { enabled: boolean }).enabled, false);
    });

    await test("data operations are disabled by default", async () => {
      const { status, response } = await runShim({
        operation: "fetch_candidate_issues",
        options,
      }, env);
      assert.strictEqual(status, 1);
      assert.strictEqual(response.ok, false);
      assert.ok(response.error?.message.includes("disabled"));
    });

    await test("enabled shim fetches Symphony-selected candidates over stdio", async () => {
      const { status, response } = await runShim({
        operation: "fetch_candidate_issues",
        options,
      }, { ...env, HIVERUNNER_SYMPHONY_TRACKER_ENABLED: "1" });
      assert.strictEqual(status, 0);
      assert.strictEqual(response.ok, true);
      const issues = response.result as Array<{ identifier: string; title: string; metadata: { executionEngine: string } }>;
      assert.deepStrictEqual(issues.map((issue) => issue.identifier), [task.key]);
      assert.strictEqual(issues[0]!.title, "Symphony tracker shim candidate");
      assert.strictEqual(issues[0]!.metadata.executionEngine, "symphony");
    });

    await test("enabled shim writes comments and state updates back to HiveRunner", async () => {
      const commentResponse = await runShim({
        operation: "create_comment",
        options,
        issueId: task.key,
        body: "Comment from the Symphony tracker shim.",
      }, { ...env, HIVERUNNER_SYMPHONY_TRACKER_ENABLED: "1" });
      assert.strictEqual(commentResponse.status, 0);
      assert.strictEqual(commentResponse.response.ok, true);

      const updateResponse = await runShim({
        operation: "update_issue_state",
        options,
        issueId: task.id,
        stateName: "Human Review",
      }, { ...env, HIVERUNNER_SYMPHONY_TRACKER_ENABLED: "1" });
      assert.strictEqual(updateResponse.status, 0);
      assert.strictEqual(updateResponse.response.ok, true);
      assert.strictEqual((updateResponse.response.result as { state: string }).state, "review");

      const comments = listTaskComments(task.id).comments;
      assert.ok(comments.some((comment) => comment.text === "Comment from the Symphony tracker shim."));
      assert.strictEqual(getTask(task.id).task.status, "review");
    });

    await test("reviewed task no longer appears in default active candidates", async () => {
      closeOrchestrationDb();
      const { status, response } = await runShim({
        operation: "fetch_candidate_issues",
        options,
      }, { ...env, HIVERUNNER_SYMPHONY_TRACKER_ENABLED: "1" });
      assert.strictEqual(status, 0);
      assert.strictEqual(response.ok, true);
      assert.deepStrictEqual(response.result, []);
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
