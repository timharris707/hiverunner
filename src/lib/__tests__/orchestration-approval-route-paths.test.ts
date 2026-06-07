import assert from "node:assert";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  buildApprovalDetailPath,
  buildCanonicalImprovePath,
  buildCanonicalRunTracePath,
  buildCanonicalTaskRunTracePath,
  buildRunTracePath,
  buildTaskRunTracePath,
} from "@/lib/orchestration/route-paths";

const { finish, test } = createTestRunner();

async function run() {
  console.log("\nOrchestration Approval Route Path Tests\n");

  await test("approval detail links use the approval UUID when a task key is also present", () => {
    const path = buildApprovalDetailPath({
      companyCode: "INS",
      companySlug: "insight",
      approvalId: "approval-uuid-123",
      linkedTaskKey: "INS-1",
    });

    assert.strictEqual(path, "/INS/approvals/approval-uuid-123");
  });

  await test("legacy company slug links also use the approval UUID", () => {
    const path = buildApprovalDetailPath({
      companySlug: "insight",
      approvalId: "approval-uuid-456",
      linkedTaskKey: "INS-1",
    });

    assert.strictEqual(path, "/companies/insight/approvals/approval-uuid-456");
  });

  await test("task-contextual run trace links use short company-code canonical routes", () => {
    assert.strictEqual(
      buildCanonicalTaskRunTracePath("INS", "INS-209", "run/id with spaces"),
      "/INS/tasks/INS-209/runs/run%2Fid%20with%20spaces"
    );
  });

  await test("run-global trace links use short company-code fallback routes", () => {
    assert.strictEqual(
      buildCanonicalRunTracePath("INS", "run/id with spaces"),
      "/INS/runs/run%2Fid%20with%20spaces"
    );
  });

  await test("improve links preserve contextual surface filters", () => {
    assert.strictEqual(
      buildCanonicalImprovePath("INS", {
        surface: "task",
        taskKey: "INS-251",
        empty: "",
        skipped: null,
      }),
      "/INS/improve?surface=task&taskKey=INS-251"
    );
  });

  await test("run trace helpers fall back to company slug implementation routes without a code", () => {
    assert.strictEqual(
      buildTaskRunTracePath({
        companySlug: "insight",
        taskKey: "INS-209",
        runId: "run-123",
      }),
      "/companies/insight/tasks/INS-209/runs/run-123"
    );

    assert.strictEqual(
      buildRunTracePath({
        companySlug: "insight",
        runId: "run-123",
      }),
      "/companies/insight/runs/run-123"
    );
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
