import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { POST as createTaskRoute } from "@/app/api/orchestration/tasks/route";
import { buildCreateTaskModalInput } from "@/components/orchestration/create-task-modal-input";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createProject, createTask, getTask } from "@/lib/orchestration/service";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-child-task-policy-inheritance-${Date.now()}.db`,
  );
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  pass ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  fail ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

function makeJsonRequest(url: string, body: unknown) {
  return {
    url,
    nextUrl: new URL(url),
    async json() {
      return body;
    },
  };
}

async function run() {
  console.log("\nChild Task Runtime Policy Inheritance Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH!;
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-child-policy-inheritance-",
  });

  try {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    workspaceIsolation.syncDatabase(getOrchestrationDb());

    const company = createCompany({
      name: `Child Policy ${Date.now()}`,
      description: "Child task runtime policy inheritance fixture",
      status: "active",
    }).company;

    const project = createProject({
      companyId: company.id,
      name: `Child Policy ${Date.now()}`,
      description: "Child task runtime policy inheritance fixture",
      color: "#0ea5e9",
      emoji: "P",
      status: "active",
    }).project;

  await test("API-created child task inherits parent execution engine and model lane when omitted", async () => {
    const parent = createTask({
      projectId: project.id,
      title: "Parent policy fixture",
      description: "Parent owns the runtime policy",
      priority: "P1",
      type: "directive",
      status: "in-progress",
      labels: [],
      executionEngine: "symphony",
      modelLane: "deep",
      createdBy: "test",
    }).task;

    const response = await createTaskRoute(
      makeJsonRequest("http://localhost/api/orchestration/tasks", {
        company: company.slug,
        projectId: project.id,
        parentTaskId: parent.id,
        title: "Child inherits policy",
        description: "No child policy fields are present in the request.",
        priority: "P2",
        type: "feature",
        status: "backlog",
        labels: ["inheritance"],
        createdBy: "test",
      }) as never,
    );
    assert.equal(response.status, 201);
    const payload = (await response.json()) as {
      task: { id: string; parentTaskId?: string; executionEngine?: string; modelLane?: string };
    };

    assert.equal(payload.task.parentTaskId, parent.id);
    assert.equal(payload.task.executionEngine, "symphony");
    assert.equal(payload.task.modelLane, "deep");

    const reloaded = getTask(payload.task.id).task;
    assert.equal(reloaded.executionEngine, "symphony");
    assert.equal(reloaded.modelLane, "deep");
  });

  await test("API-created child task keeps explicit runtime policy overrides", async () => {
    const parent = createTask({
      projectId: project.id,
      title: "Parent policy override fixture",
      description: "Parent policy should not win over explicit child overrides",
      priority: "P1",
      type: "directive",
      status: "in-progress",
      labels: [],
      executionEngine: "symphony",
      modelLane: "deep",
      createdBy: "test",
    }).task;

    const response = await createTaskRoute(
      makeJsonRequest("http://localhost/api/orchestration/tasks", {
        company: company.slug,
        projectId: project.id,
        parentTaskId: parent.id,
        title: "Child overrides policy",
        description: "Child request explicitly chooses a different policy.",
        priority: "P2",
        type: "feature",
        status: "backlog",
        labels: ["override"],
        executionEngine: "manual",
        modelLane: "fast",
        createdBy: "test",
      }) as never,
    );
    assert.equal(response.status, 201);
    const payload = (await response.json()) as {
      task: { id: string; parentTaskId?: string; executionEngine?: string; modelLane?: string };
    };

    assert.equal(payload.task.parentTaskId, parent.id);
    assert.equal(payload.task.executionEngine, "manual");
    assert.equal(payload.task.modelLane, "fast");

    const reloaded = getTask(payload.task.id).task;
    assert.equal(reloaded.executionEngine, "manual");
    assert.equal(reloaded.modelLane, "fast");
  });

  await test("UI create payload omits inherited policy fields unless explicitly overridden", () => {
    const inheritedPayload = buildCreateTaskModalInput({
      companySlug: company.slug,
      projectId: project.id,
      parentTaskId: "parent-task-id",
      title: "  UI child inherits  ",
      description: "  payload fixture  ",
      priority: "P2",
      status: "backlog",
      tags: ["ui"],
      executionEngine: null,
      modelLaneOverride: null,
    });
    assert.equal("executionEngine" in inheritedPayload, false);
    assert.equal("modelLane" in inheritedPayload, false);
    assert.equal(inheritedPayload.parentTaskId, "parent-task-id");
    assert.equal(inheritedPayload.title, "UI child inherits");
    assert.equal(inheritedPayload.description, "payload fixture");

    const overridePayload = buildCreateTaskModalInput({
      companySlug: company.slug,
      projectId: project.id,
      parentTaskId: "parent-task-id",
      title: "UI child overrides",
      description: "payload fixture",
      priority: "P2",
      status: "backlog",
      tags: ["ui"],
      executionEngine: "manual",
      modelLaneOverride: "mini",
    });
    assert.equal(overridePayload.executionEngine, "manual");
    assert.equal(overridePayload.modelLane, "mini");
  });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    workspaceIsolation.dispose();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
