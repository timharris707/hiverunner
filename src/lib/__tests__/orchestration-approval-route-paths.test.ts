import assert from "node:assert";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { buildApprovalDetailPath } from "@/lib/orchestration/route-paths";

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

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
