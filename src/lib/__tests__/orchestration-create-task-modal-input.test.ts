import assert from "node:assert";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { buildCreateTaskModalInput } from "../../components/orchestration/create-task-modal-input.ts";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

async function run() {
  console.log("\nCreate Task Modal Input Tests\n");

  await test("subtask create payload omits inherited policy fields", () => {
    const payload = buildCreateTaskModalInput({
      companySlug: "insight",
      projectId: "project-1",
      title: "  Child task  ",
      description: "  inherits parent policy  ",
      priority: "P1",
      status: "to-do",
      assignee: "",
      dueDate: "",
      tags: ["inheritance"],
      executionEngine: null,
      modelLaneOverride: null,
      parentTaskId: "parent-1",
    });

    assert.equal(payload.title, "Child task");
    assert.equal(payload.description, "inherits parent policy");
    assert.equal(payload.parentTaskId, "parent-1");
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, "executionEngine"));
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, "modelLane"));
  });

  await test("subtask create payload includes explicit policy overrides", () => {
    const payload = buildCreateTaskModalInput({
      companySlug: "insight",
      projectId: "project-1",
      title: "Child task",
      description: "",
      priority: "P2",
      status: "in-progress",
      assignee: "Corey",
      dueDate: "2026-05-09",
      tags: [],
      executionEngine: "symphony",
      modelLaneOverride: "default",
      parentTaskId: "parent-1",
    });

    assert.equal(payload.executionEngine, "symphony");
    assert.equal(payload.modelLane, "default");
    assert.equal(payload.assignee, "Corey");
    assert.equal(payload.dueDate, "2026-05-09");
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
