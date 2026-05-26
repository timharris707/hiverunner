import assert from "node:assert";

import { buildCreateTaskModalInput } from "../../components/orchestration/create-task-modal-input.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  pass ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  fail ${name}`);
    console.error(`    ${message}`);
  }
}

console.log("\nCreate Task Modal Input Tests\n");

test("subtask create payload omits inherited policy fields", () => {
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

test("subtask create payload includes explicit policy overrides", () => {
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

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n${passed} passed`);
