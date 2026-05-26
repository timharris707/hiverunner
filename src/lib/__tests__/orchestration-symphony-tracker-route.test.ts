import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { NextRequest } from "next/server";

let passed = 0;
let failed = 0;

type RouteResponse = {
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

async function run() {
  console.log("\nHiveRunner Symphony Tracker Route Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-symphony-tracker-route-"));
  const previousEnv = {
    ORCHESTRATION_DB_PATH: process.env.ORCHESTRATION_DB_PATH,
    MC_WORKSPACE_ROOT: process.env.MC_WORKSPACE_ROOT,
    HIVERUNNER_APP_URL: process.env.HIVERUNNER_APP_URL,
    HIVERUNNER_SYMPHONY_TRACKER_ENABLED: process.env.HIVERUNNER_SYMPHONY_TRACKER_ENABLED,
    HIVERUNNER_SYMPHONY_TRACKER_TOKEN: process.env.HIVERUNNER_SYMPHONY_TRACKER_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
  };

  Object.assign(process.env, {
    ORCHESTRATION_DB_PATH: path.join(tempRoot, "orchestration.db"),
    MC_WORKSPACE_ROOT: path.join(tempRoot, "workspaces"),
    HIVERUNNER_APP_URL: "http://127.0.0.1:3010",
    NODE_ENV: "development",
  });
  delete process.env.HIVERUNNER_SYMPHONY_TRACKER_ENABLED;
  delete process.env.HIVERUNNER_SYMPHONY_TRACKER_TOKEN;

  try {
    const { GET, POST } = await import("@/app/api/orchestration/symphony/tracker/route");
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

    async function postTracker(payload: unknown, headers: Record<string, string> = {}) {
      const response = await POST(new Request("http://localhost/api/orchestration/symphony/tracker", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      }) as unknown as NextRequest);
      return {
        status: response.status,
        body: await response.json() as RouteResponse,
      };
    }

    const company = createCompany({
      name: "Symphony Tracker Route Co",
      description: "Tracker route fixture.",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Symphony Tracker Route Project",
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
      name: "Route Worker",
      emoji: "S",
      role: "Engineer",
      personality: "Runs Symphony tracker route fixtures.",
      status: "idle",
      skills: [],
    }).agent;
    const task = createTask({
      projectId: project.id,
      title: "Symphony tracker route candidate",
      description: "Exercise the HTTP route.",
      priority: "P1",
      type: "feature",
      status: "to-do",
      assignee: agent.id,
      labels: ["symphony", "route"],
      createdBy: "test",
    }).task;

    const options = {
      companyIdOrSlug: company.id,
      projectIdOrSlug: project.slug,
      actorUserId: "symphony:route-test",
      workerAgentIds: [agent.id],
    };

    await test("GET health is available while data access is disabled", async () => {
      const response = await GET();
      const body = await response.json() as RouteResponse;
      assert.strictEqual(response.status, 200);
      assert.strictEqual(body.ok, true);
      const result = body.result as { enabled: boolean; transport: string; authRequired: boolean };
      assert.strictEqual(result.enabled, false);
      assert.strictEqual(result.transport, "http");
      assert.strictEqual(result.authRequired, false);
    });

    await test("POST data operations are disabled by default", async () => {
      const response = await postTracker({
        operation: "fetch_candidate_issues",
        options,
      });
      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.ok, false);
      assert.ok(response.body.error?.message.includes("disabled"));
    });

    await test("configured token is required before tracker work executes", async () => {
      process.env.HIVERUNNER_SYMPHONY_TRACKER_ENABLED = "1";
      process.env.HIVERUNNER_SYMPHONY_TRACKER_TOKEN = "route-secret";
      const response = await postTracker({
        operation: "fetch_candidate_issues",
        options,
      });
      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error?.code, "tracker_auth_error");
    });

    await test("authorized route fetches and mutates HiveRunner issues", async () => {
      const fetchResponse = await postTracker({
        operation: "fetch_candidate_issues",
        options,
      }, { authorization: "Bearer route-secret" });
      assert.strictEqual(fetchResponse.status, 200);
      assert.strictEqual(fetchResponse.body.ok, true);
      const issues = fetchResponse.body.result as Array<{ identifier: string; title: string }>;
      assert.deepStrictEqual(issues.map((issue) => issue.identifier), [task.key]);

      const commentResponse = await postTracker({
        operation: "create_comment",
        options,
        issueId: task.key,
        body: "Comment from the Symphony tracker HTTP route.",
      }, { "x-hiverunner-symphony-token": "route-secret" });
      assert.strictEqual(commentResponse.status, 200);
      assert.strictEqual(commentResponse.body.ok, true);

      const updateResponse = await postTracker({
        operation: "update_issue_state",
        options,
        issueId: task.id,
        stateName: "Human Review",
      }, { authorization: "Bearer route-secret" });
      assert.strictEqual(updateResponse.status, 200);
      assert.strictEqual(updateResponse.body.ok, true);
      assert.strictEqual((updateResponse.body.result as { state: string }).state, "review");

      assert.ok(listTaskComments(task.id).comments.some((comment) => (
        comment.text === "Comment from the Symphony tracker HTTP route."
      )));
      assert.strictEqual(getTask(task.id).task.status, "review");
    });

    closeOrchestrationDb();
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
